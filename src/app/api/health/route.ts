import { db, describeDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * `db.execute` devolve formatos diferentes conforme o driver:
 *  - neon-http  → array de linhas
 *  - node-postgres → { rows: [...] }
 */
async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return ((result as unknown as { rows?: T[] }).rows ?? []) as T[];
}

export async function GET() {
  const info = describeDb();

  if (!info.configured) {
    return Response.json(
      {
        ok: false,
        driver: null,
        host: null,
        tables: null,
        error: "DATABASE_URL não está definida neste ambiente.",
        hint: "Vercel → Settings → Environment Variables → DATABASE_URL (string de conexão do Neon) e faça um Redeploy.",
      },
      { status: 500 },
    );
  }

  try {
    await db.execute(sql`select 1`);

    const [tables] = await rows<{ propostas: string | null; itens: string | null }>(
      sql`select to_regclass('public.propostas')::text as propostas,
                 to_regclass('public.itens')::text as itens`,
    );

    const ok = Boolean(tables?.propostas && tables?.itens);

    return Response.json(
      {
        ok,
        driver: info.driver,
        host: info.host,
        tables: { propostas: Boolean(tables?.propostas), itens: Boolean(tables?.itens) },
        ...(ok
          ? {}
          : {
              error: "As tabelas ainda não existem no banco.",
              hint: "Rode `npm run db:migrate` localmente ou deixe o build da Vercel aplicar as migrações automáticas.",
            }),
      },
      { status: ok ? 200 : 500 },
    );
  } catch (e) {
    return Response.json(
      {
        ok: false,
        driver: info.driver,
        host: info.host,
        tables: null,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
