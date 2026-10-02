import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas, itens } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [proposta] = await db.select().from(propostas).where(eq(propostas.id, +id));
    if (!proposta) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const itensList = await db.select().from(itens).where(eq(itens.propostaId, +id)).orderBy(asc(itens.numeroItem));
    return NextResponse.json({ ...proposta, itens: itensList });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const [updated] = await db
      .update(propostas)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(propostas.id, +id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(itens).where(eq(itens.propostaId, +id));
    await db.delete(propostas).where(eq(propostas.id, +id));
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
