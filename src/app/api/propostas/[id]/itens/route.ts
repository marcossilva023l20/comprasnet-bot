import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await db.select().from(itens).where(eq(itens.propostaId, +id)).orderBy(asc(itens.numeroItem));
    return NextResponse.json(rows);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const arr = Array.isArray(body) ? body : [body];
    const inserted = [];
    for (const item of arr) {
      const [novo] = await db.insert(itens).values({
        propostaId: +id,
        numeroItem: Number(item.numeroItem) || 0,
        descricao: item.descricao || "Sem descrição",
        descricaoDetalhada: item.descricaoDetalhada || null,
        quantidade: String(parseFloat(String(item.quantidade)) || 1),
        unidade: item.unidade || "Unidade",
        valorEstimado: item.valorEstimado ? String(parseFloat(String(item.valorEstimado))) : null,
        valorUnitario: item.valorUnitario ? String(parseFloat(String(item.valorUnitario))) : null,
        marcaFabricante: item.marcaFabricante || null,
        modeloVersao: item.modeloVersao || null,
        enviado: false,
      }).returning();
      inserted.push(novo);
    }
    return NextResponse.json(inserted, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao criar itens" }, { status: 500 });
  }
}
