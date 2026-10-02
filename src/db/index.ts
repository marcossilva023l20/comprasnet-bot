import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Conexão com o banco preparada para Vercel (serverless) + Neon.
 *
 * Pontos importantes:
 * - A conexão é criada de forma PREGUICOSA (lazy): o módulo pode ser importado
 *   durante o `next build` mesmo sem DATABASE_URL definida, sem quebrar o build.
 * - Neon (host *.neon.tech) usa o driver HTTP do Neon (@neondatabase/serverless),
 *   que é stateless e não estoura o limite de conexões em funções serverless.
 *   (Ele converte o host para https://api.<região>.aws.neon.tech/sql, então
 *   funciona tanto com a string pooled quanto com a direta.)
 * - Postgres local/self-hosted usa node-postgres (pg) com pool pequeno.
 */

/**
 * Ambos os drivers expõem exatamente a mesma API do Drizzle; o tipo do
 * node-postgres é usado apenas para manter a inferência (select/insert/etc.).
 */
export type DbInstance = NodePgDatabase<typeof schema>;

type Driver = "neon-http" | "node-postgres";
type Connection = { db: DbInstance; driver: Driver };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "db", "postgres"]);

function resolveDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    undefined
  );
}

function isNeonHost(url: string): boolean {
  try {
    const { hostname, searchParams } = new URL(url);
    // Permite forçar o driver HTTP do Neon mesmo com URL customizada
    if (searchParams.get("neon_http") === "1") return true;
    return /(^|\.)neon\.tech$/.test(hostname) || hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

function isLocalHost(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Remove parâmetros que o node-postgres (pg) não entende.
 * Ex.: o Neon entrega `channel_binding=require` na string de conexão; o
 * driver `pg` não implementa channel binding e pode rejeitar a URL.
 */
function sanitizeForPg(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("channel_binding");
    if (!parsed.searchParams.has("sslmode") && !isLocalHost(url)) {
      parsed.searchParams.set("sslmode", "require");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function createDb(url: string): Connection {
  const useNeonHttp = isNeonHost(url) && process.env.DATABASE_DRIVER !== "pg";

  if (useNeonHttp) {
    const sql = neon(url);
    return { db: drizzleNeonHttp(sql, { schema }) as unknown as DbInstance, driver: "neon-http" };
  }

  const pool = new Pool({
    connectionString: sanitizeForPg(url),
    max: Number(process.env.PGPOOL_MAX ?? (process.env.VERCEL ? 1 : 10)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });
  return { db: drizzleNodePg(pool, { schema }), driver: "node-postgres" };
}

let cached: { url: string; connection: Connection } | null = null;

function getConnection(): Connection {
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL não está definida. No Vercel: Settings → Environment Variables → DATABASE_URL (string de conexão do Neon).",
    );
  }
  if (!cached || cached.url !== url) {
    cached = { url, connection: createDb(url) };
  }
  return cached.connection;
}

/** Instância do Drizzle. Só conecta de verdade na primeira consulta. */
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    const { db: instance } = getConnection();
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Acesso explícito (útil em scripts e no /api/health). */
export function getDb(): Connection {
  return getConnection();
}

export function describeDb() {
  const url = resolveDatabaseUrl();
  if (!url) return { configured: false as const, driver: null, host: null };
  try {
    const { hostname } = new URL(url);
    return {
      configured: true as const,
      driver: (isNeonHost(url) && process.env.DATABASE_DRIVER !== "pg"
        ? "neon-http"
        : "node-postgres") as Driver,
      host: hostname,
    };
  } catch {
    return { configured: true as const, driver: "url-inválida" as Driver, host: null };
  }
}

export * from "./schema";
