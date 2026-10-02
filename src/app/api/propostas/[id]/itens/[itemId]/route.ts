import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isBlankNumericValue, parseLocalizedNumber } from "@/lib/numbers";

function parseRouteId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const propostaId = parseRouteId(id);
    const itemIdNumber = parseRouteId(itemId);
    if (!propostaId || !itemIdNumber) {
      return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
    }

    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    for (const field of ["valorUnitario", "valorEstimado"] as const) {
      if (!(field in fields)) continue;
      const raw = fields[field];
      const parsed = parseLocalizedNumber(raw);
      if (!isBlankNumericValue(raw) && parsed === null) {
        return NextResponse.json({ error: `Valor inválido no campo ${field}` }, { status: 400 });
      }
      update[field] = parsed;
    }

    if ("quantidade" in fields) {
      const raw = fields.quantidade;
      const parsed = parseLocalizedNumber(raw);
      if (!isBlankNumericValue(raw) && parsed === null) {
        return NextResponse.json({ error: "Valor inválido no campo quantidade" }, { status: 400 });
      }
      update.quantidade = isBlankNumericValue(raw) ? "1" : parsed;
    }

    for (const field of ["marcaFabricante", "modeloVersao", "descricaoDetalhada"] as const) {
      if (field in fields) {
        const value = fields[field];
        if (value != null && typeof value !== "string") {
          return NextResponse.json({ error: `Valor inválido no campo ${field}` }, { status: 400 });
        }
        update[field] = typeof value === "string" && value.trim() ? value.trim() : null;
      }
    }

    for (const field of ["descricao", "unidade"] as const) {
      if (field in fields) {
        const value = fields[field];
        if (typeof value !== "string" || !value.trim()) {
          return NextResponse.json({ error: `O campo ${field} é obrigatório` }, { status: 400 });
        }
        update[field] = value.trim();
      }
    }

    if ("numeroItem" in fields) {
      const numeroItem = Number(fields.numeroItem);
      if (!Number.isSafeInteger(numeroItem) || numeroItem < 0) {
        return NextResponse.json({ error: "Número do item inválido" }, { status: 400 });
      }
      update.numeroItem = numeroItem;
    }

    if ("enviado" in fields) {
      if (typeof fields.enviado !== "boolean") {
        return NextResponse.json({ error: "O campo enviado precisa ser booleano" }, { status: 400 });
      }
      update.enviado = fields.enviado;
    }

    const [updated] = await db
      .update(itens)
      .set(update)
      .where(and(eq(itens.id, itemIdNumber), eq(itens.propostaId, propostaId)))
      .returning();
    if (!updated) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const propostaId = parseRouteId(id);
    const itemIdNumber = parseRouteId(itemId);
    if (!propostaId || !itemIdNumber) {
      return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(itens)
      .where(and(eq(itens.id, itemIdNumber), eq(itens.propostaId, propostaId)))
      .returning({ id: itens.id });
    if (!deleted) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao excluir" }, { status: 500 });
  }
}
