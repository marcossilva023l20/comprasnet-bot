import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas, itens } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { formatarValorBR } from "@/lib/numbers";

// Returns the items in a format ready for the Chrome Extension to consume
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [proposta] = await db.select().from(propostas).where(eq(propostas.id, +id));
    if (!proposta) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const rows = await db
      .select()
      .from(itens)
      .where(eq(itens.propostaId, +id))
      .orderBy(asc(itens.numeroItem));

    const payload = rows
      .filter((i) => i.valorUnitario && i.marcaFabricante)
      .map((i) => ({
        id: i.id,
        item: i.numeroItem,
        // 4 casas como no portal: 44,0000 (2 casas a máscara do site lê errado)
        valorUnitario: formatarValorBR(i.valorUnitario),
        valorMinimo: i.valorMinimo === null ? null : formatarValorBR(i.valorMinimo),
        marcaFabricante: i.marcaFabricante!,
        modeloVersao: i.modeloVersao || "",
      }));

    return NextResponse.json({
      proposta: {
        id: proposta.id,
        numeroDispensa: proposta.numeroDispensa,
        uasg: proposta.uasg,
      },
      totalItens: payload.length,
      itens: payload,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      }
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
