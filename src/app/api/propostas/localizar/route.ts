import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { casarProposta, extrairUasg, somenteDigitos, type IdentificacaoPagina } from "@/lib/proposta-match";

/**
 * Descobre, sem gravar nada, qual proposta do sistema corresponde a uma página
 * do ComprasNet. Usado pela extensão para mostrar o destino antes de enviar.
 *
 * GET /api/propostas/localizar?uasg=170162&numeroCompra=17016205900012025
 */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const identificacao: IdentificacaoPagina = {
      uasg: params.get("uasg"),
      numeroCompra: params.get("numeroCompra"),
      numeroDispensa: params.get("numeroDispensa"),
    };

    const uasg = extrairUasg(identificacao.uasg) || somenteDigitos(identificacao.uasg);

    const candidatas = await db
      .select({
        id: propostas.id,
        numeroDispensa: propostas.numeroDispensa,
        uasg: propostas.uasg,
        objeto: propostas.objeto,
        dataLimite: propostas.dataLimite,
        updatedAt: propostas.updatedAt,
        totalItens: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id})`,
        itensPreenchidos: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id} AND itens.valor_unitario IS NOT NULL AND itens.marca_fabricante IS NOT NULL AND itens.marca_fabricante <> '')`,
      })
      .from(propostas)
      // A UASG é digitada com textos variados ("170162 - ALFÂNDEGA..."), então
      // o filtro é por dígitos; sem UASG, consideramos as mais recentes.
      .where(uasg ? sql`regexp_replace(coalesce(${propostas.uasg}, ''), '[^0-9]', '', 'g') = ${uasg}` : sql`true`)
      .orderBy(desc(propostas.updatedAt))
      .limit(200);

    const { proposta, motivo } = casarProposta(candidatas, identificacao);

    return NextResponse.json(
      {
        encontrada: Boolean(proposta),
        motivo,
        proposta: proposta ?? null,
        identificacao: {
          uasg: uasg || null,
          numeroCompra: somenteDigitos(identificacao.numeroCompra) || null,
        },
      },
      { headers: CORS },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
