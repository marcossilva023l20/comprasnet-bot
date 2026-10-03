import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { parseLocalizedNumber, isBlankNumericValue } from "@/lib/numbers";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propostaId = Number(id);
    if (!Number.isSafeInteger(propostaId) || propostaId <= 0) {
      return NextResponse.json({ error: "Identificador de proposta inválido" }, { status: 400 });
    }

    const rows = await db.select().from(itens).where(eq(itens.propostaId, propostaId)).orderBy(asc(itens.numeroItem));
    return NextResponse.json(rows);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propostaId = Number(id);
    if (!Number.isSafeInteger(propostaId) || propostaId <= 0) {
      return NextResponse.json({ error: "Identificador de proposta inválido" }, { status: 400 });
    }

    const body: unknown = await req.json();
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0 || rows.length > 1_000) {
      return NextResponse.json({ error: "Envie entre 1 e 1000 itens por requisição" }, { status: 400 });
    }

    const values = [];
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return NextResponse.json({ error: `Item ${index + 1} inválido` }, { status: 400 });
      }
      const item = row as Record<string, unknown>;
      const valorEstimado = parseLocalizedNumber(item.valorEstimado);
      const valorUnitario = parseLocalizedNumber(item.valorUnitario);
      const valorMinimo = parseLocalizedNumber(item.valorMinimo);
      const quantidade = parseLocalizedNumber(item.quantidade);

      for (const [field, raw, parsed] of [
        ["valor estimado", item.valorEstimado, valorEstimado],
        ["valor unitário", item.valorUnitario, valorUnitario],
        ["valor mínimo", item.valorMinimo, valorMinimo],
        ["quantidade", item.quantidade, quantidade],
      ] as const) {
        if (!isBlankNumericValue(raw) && parsed === null) {
          return NextResponse.json({ error: `Valor inválido no campo ${field} do item ${index + 1}` }, { status: 400 });
        }
      }

      const numeroItem = item.numeroItem == null || item.numeroItem === "" ? index + 1 : Number(item.numeroItem);
      if (!Number.isSafeInteger(numeroItem) || numeroItem < 0) {
        return NextResponse.json({ error: `Número inválido no item ${index + 1}` }, { status: 400 });
      }

      values.push({
        propostaId,
        numeroItem,
        descricao: typeof item.descricao === "string" && item.descricao.trim() ? item.descricao.trim() : "Sem descrição",
        descricaoDetalhada: typeof item.descricaoDetalhada === "string" && item.descricaoDetalhada.trim() ? item.descricaoDetalhada.trim() : null,
        quantidade: isBlankNumericValue(item.quantidade) ? "1" : quantidade!,
        unidade: typeof item.unidade === "string" && item.unidade.trim() ? item.unidade.trim() : "Unidade",
        valorEstimado,
        valorUnitario,
        valorMinimo,
        marcaFabricante: typeof item.marcaFabricante === "string" && item.marcaFabricante.trim() ? item.marcaFabricante.trim() : null,
        modeloVersao: typeof item.modeloVersao === "string" && item.modeloVersao.trim() ? item.modeloVersao.trim() : null,
        enviado: false,
      });
    }

    const inserted = await db.insert(itens).values(values).returning();
    return NextResponse.json(inserted, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao criar itens" }, { status: 500 });
  }
}
