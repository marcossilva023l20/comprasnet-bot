#!/usr/bin/env node
/**
 * Aplica as migrações SQL da pasta ./drizzle no banco (Neon, Postgres local, etc).
 *
 * Pensado para rodar DENTRO do build da Vercel (`npm run build` → `npm run db:migrate`),
 * então:
 *   - é idempotente (controla o que já foi aplicado na tabela __drizzle_migrations);
 *   - usa advisory lock para não conflitar com builds simultâneos;
 *   - se DATABASE_URL não existir, avisa e sai com 0 (não quebra o build);
 *   - aceita SKIP_DB_MIGRATIONS=1 para pular de propósito.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const META_DIR = path.join(MIGRATIONS_DIR, "meta");
const LOCK_KEY = 728_331_001; // hash fixo do projeto

function log(msg) {
  console.log(`[db:migrate] ${msg}`);
}

function resolveUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  );
}

/** Monta a config de SSL aceitando tanto `sslmode=require` quanto hosts Neon. */
function buildConfig(url) {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname);
  const needsSsl = !isLocal || sslmode === "require";

  return {
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 20_000,
  };
}

async function listMigrations() {
  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
  if (files.length === 0) return [];

  // Prefere a ordem do journal do drizzle-kit, se existir
  try {
    const journal = JSON.parse(await readFile(path.join(META_DIR, "_journal.json"), "utf8"));
    const ordered = journal.entries
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((e) => `${e.tag}.sql`)
      .filter((f) => files.includes(f));
    const missing = files.filter((f) => !ordered.includes(f));
    return [...ordered, ...missing];
  } catch {
    return files;
  }
}

function splitStatements(sql) {
  return sql
    .split(/--> statement-breakpoint/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const url = resolveUrl();

  if (process.env.SKIP_DB_MIGRATIONS === "1") {
    log("SKIP_DB_MIGRATIONS=1 — migrações ignoradas.");
    return;
  }

  if (!url) {
    log("⚠️  DATABASE_URL não definida — pulando migrações.");
    log("   No Vercel: Settings → Environment Variables → DATABASE_URL (string do Neon).");
    log("   As tabelas precisam existir: rode `npm run db:migrate` ou `npm run db:push`.");
    return;
  }

  const migrations = await listMigrations();
  if (migrations.length === 0) {
    log("Nenhuma migration encontrada em ./drizzle — nada a fazer.");
    return;
  }

  let host = "(desconhecido)";
  try {
    host = new URL(url).hostname;
  } catch {
    log(`⚠️  DATABASE_URL inválida (não é uma URL) — pulando migrações.`);
    return;
  }

  const client = new pg.Client(buildConfig(url));
  await client.connect();
  log(`conectado em ${host}`);

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
         "id" text PRIMARY KEY,
         "applied_at" timestamptz NOT NULL DEFAULT now()
       )`,
    );

    for (const file of migrations) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitStatements(sql);

      // advisory lock: evita dois builds aplicando a mesma migration ao mesmo tempo
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);

        const { rows } = await client.query(
          'SELECT 1 FROM "__drizzle_migrations" WHERE "id" = $1',
          [file],
        );
        if (rows.length > 0) {
          await client.query("ROLLBACK");
          log(`✓ ${file} (já aplicada)`);
          continue;
        }

        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query('INSERT INTO "__drizzle_migrations" ("id") VALUES ($1)', [file]);
        await client.query("COMMIT");
        log(`✅ ${file} aplicada (${statements.length} statement(s))`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  log("banco atualizado.");
}

main().catch((err) => {
  console.error(`[db:migrate] ❌ falha ao aplicar migrações: ${err?.message ?? err}`);
  if (process.env.VERCEL) {
    console.error(
      "[db:migrate] Dica: confira se DATABASE_URL está nas Environment Variables do projeto na Vercel e se o projeto Neon está ativo.",
    );
  }
  process.exit(1);
});
