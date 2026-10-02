import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas, itens } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

/**
 * A extensão (e o painel na página do ComprasNet) lê esta lista de fora do
 * domínio do app — precisa liberar CORS.
 */
const CABECALHOS_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CABECALHOS_CORS });
}

export async function GET() {
  try {
    const rows = await db
      .select({
        id: propostas.id,
        numeroDispensa: propostas.numeroDispensa,
        uasg: propostas.uasg,
        objeto: propostas.objeto,
        dataLimite: propostas.dataLimite,
        status: propostas.status,
        createdAt: propostas.createdAt,
        updatedAt: propostas.updatedAt,
        totalItens: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id})`,
        itensPreenchidos: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id} AND itens.valor_unitario IS NOT NULL AND itens.marca_fabricante IS NOT NULL AND itens.marca_fabricante <> '')`,
        itensEnviados: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id} AND itens.enviado = true)`,
      })
      .from(propostas)
      .orderBy(desc(propostas.createdAt));
    return NextResponse.json(rows, { headers: CABECALHOS_CORS });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500, headers: CABECALHOS_CORS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { numeroDispensa, uasg, objeto, dataLimite } = await req.json();
    if (!numeroDispensa?.trim()) {
      return NextResponse.json({ error: "Número da dispensa é obrigatório" }, { status: 400 });
    }
    const [nova] = await db
      .insert(propostas)
      .values({ numeroDispensa: numeroDispensa.trim(), uasg, objeto, dataLimite })
      .returning();
    return NextResponse.json(nova, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao criar proposta" }, { status: 500 });
  }
}
