import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const body = await req.json();
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ("valorUnitario" in body)
      update.valorUnitario = body.valorUnitario ? String(parseFloat(String(body.valorUnitario).replace(",", "."))) : null;
    if ("marcaFabricante" in body) update.marcaFabricante = body.marcaFabricante || null;
    if ("modeloVersao" in body) update.modeloVersao = body.modeloVersao || null;
    if ("descricao" in body) update.descricao = body.descricao;
    if ("descricaoDetalhada" in body) update.descricaoDetalhada = body.descricaoDetalhada || null;
    if ("quantidade" in body) update.quantidade = String(parseFloat(String(body.quantidade)) || 1);
    if ("unidade" in body) update.unidade = body.unidade;
    if ("valorEstimado" in body)
      update.valorEstimado = body.valorEstimado ? String(parseFloat(String(body.valorEstimado).replace(",", "."))) : null;
    if ("numeroItem" in body) update.numeroItem = Number(body.numeroItem);
    if ("enviado" in body) update.enviado = Boolean(body.enviado);

    const [updated] = await db.update(itens).set(update).where(eq(itens.id, +itemId)).returning();
    if (!updated) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { itemId } = await params;
    await db.delete(itens).where(eq(itens.id, +itemId));
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao excluir" }, { status: 500 });
  }
}
