/**
 * `db.execute` devolve formatos diferentes conforme o driver:
 *   - neon-http     → array de linhas
 *   - node-postgres → { rows: [...] }
 *
 * Este helper esconde a diferença para quem só quer as linhas.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function executarConsultaLinhas<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const resultado = await db.execute(query);
  if (Array.isArray(resultado)) return resultado as T[];
  return ((resultado as unknown as { rows?: T[] }).rows ?? []) as T[];
}
