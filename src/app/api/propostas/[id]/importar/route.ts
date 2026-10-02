import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { isBlankNumericValue, normalizeSpreadsheetHeader, parseLocalizedNumber } from "@/lib/numbers";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 1_000;
const ACCEPTED_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

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

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    }
    if (!ACCEPTED_EXTENSIONS.test(file.name)) {
      return NextResponse.json({ error: "Formato inválido. Envie um arquivo XLSX, XLS ou CSV." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "O arquivo está vazio" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "O arquivo excede o limite de 10 MB" }, { status: 413 });
    }

    let workbook: XLSX.WorkBook;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      workbook = XLSX.read(buffer, { type: "buffer" });
    } catch {
      return NextResponse.json({ error: "Não foi possível ler a planilha. Verifique o arquivo e tente novamente." }, { status: 400 });
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
    if (!sheet) {
      return NextResponse.json({ error: "A planilha não contém uma aba para importar" }, { status: 400 });
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) {
      return NextResponse.json({ error: "Planilha vazia" }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `A planilha ultrapassa o limite de ${MAX_ROWS} linhas` }, { status: 413 });
    }

    const pick = (row: Record<string, unknown>, aliases: string[]): unknown => {
      const cells = new Map(
        Object.entries(row).map(([key, value]) => [normalizeSpreadsheetHeader(key), value]),
      );
      for (const alias of aliases) {
        const value = cells.get(normalizeSpreadsheetHeader(alias));
        if (value !== undefined && value !== null) return value;
      }
      return "";
    };
    const toText = (value: unknown) => (value == null ? "" : String(value).trim());
    const parseItemNumber = (value: unknown): number | null => {
      if (typeof value === "number") {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
      }
      const normalized = parseLocalizedNumber(value);
      if (normalized === null) return null;
      const number = Number(normalized);
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };

    const values = [];
    const invalidRows: string[] = [];
    for (const [index, row] of rows.entries()) {
      const descricao = toText(pick(row, [
        "descrição",
        "descricao",
        "desc",
        "descrição do item",
        "descricao do item",
        "item",
      ]));
      if (!descricao) continue;

      const numeroItem = parseItemNumber(pick(row, [
        "nº",
        "n°",
        "num",
        "número item",
        "numero item",
        "número",
        "numero",
        "item",
      ]));
      const quantidadeValue = pick(row, ["quantidade", "qtd", "qtde"]);
      const valorEstimadoValue = pick(row, ["valor estimado (r$)", "valor estimado", "val estimado"]);
      const valorUnitarioValue = pick(row, [
        "valor unitário (r$)",
        "valor unitario (r$)",
        "valor unitário",
        "valor unitario",
        "valor",
        "preço",
        "preco",
      ]);
      const quantidade = parseLocalizedNumber(quantidadeValue);
      const valorEstimado = isBlankNumericValue(valorEstimadoValue) ? null : parseLocalizedNumber(valorEstimadoValue);
      const valorUnitario = isBlankNumericValue(valorUnitarioValue) ? null : parseLocalizedNumber(valorUnitarioValue);
      const invalidFields = [
        ...(!isBlankNumericValue(quantidadeValue) && quantidade === null ? ["quantidade"] : []),
        (!isBlankNumericValue(valorEstimadoValue) && valorEstimado === null ? "valor estimado" : null),
        (!isBlankNumericValue(valorUnitarioValue) && valorUnitario === null ? "valor unitário" : null),
      ].filter((field): field is string => field !== null);
      if (invalidFields.length) {
        invalidRows.push(`linha ${index + 2}: ${invalidFields.join(", ")}`);
        continue;
      }

      values.push({
        propostaId,
        numeroItem: numeroItem ?? index + 1,
        descricao,
        descricaoDetalhada: toText(pick(row, ["descrição detalhada", "descricao detalhada", "desc detalhada"])) || null,
        quantidade: quantidade ?? "1",
        unidade: toText(pick(row, ["unidade", "und", "un", "unid"])) || "Unidade",
        valorEstimado,
        valorUnitario,
        marcaFabricante: toText(pick(row, ["marca/fabricante", "marca", "fabricante"])) || null,
        modeloVersao: toText(pick(row, ["modelo/versão", "modelo/versao", "modelo", "versão", "versao"])) || null,
        enviado: false,
      });
    }

    if (invalidRows.length) {
      return NextResponse.json({ error: `Valores numéricos inválidos: ${invalidRows.slice(0, 10).join("; ")}${invalidRows.length > 10 ? `; e mais ${invalidRows.length - 10} linha(s)` : ""}` }, { status: 400 });
    }

    if (!values.length) {
      return NextResponse.json({ error: "Nenhum item com descrição foi encontrado na planilha" }, { status: 400 });
    }

    const inserted = await db.insert(itens).values(values).returning();
    return NextResponse.json(
      { message: `${inserted.length} itens importados com sucesso`, itens: inserted },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}
