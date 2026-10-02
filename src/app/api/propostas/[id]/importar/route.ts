import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import * as XLSX from "xlsx";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    if (!rows.length) return NextResponse.json({ error: "Planilha vazia" }, { status: 400 });

    const pick = (row: Record<string, unknown>, keys: string[]): string => {
      for (const k of keys) {
        for (const rk of Object.keys(row)) {
          if (rk.toLowerCase().trim() === k.toLowerCase()) {
            const v = row[rk];
            return v != null ? String(v).trim() : "";
          }
        }
      }
      return "";
    };

    const parseNum = (s: string) => {
      if (!s) return null;
      const n = parseFloat(s.replace(/[^\d,.-]/g, "").replace(",", "."));
      return isNaN(n) ? null : String(n);
    };

    const inserted = [];
    for (const row of rows) {
      const desc = pick(row, ["descrição", "descricao", "desc", "descrição do item", "item"]);
      if (!desc) continue;

      const [novo] = await db.insert(itens).values({
        propostaId: +id,
        numeroItem: parseInt(pick(row, ["nº", "n°", "num", "item", "número item", "numero", "numero item"])) || 0,
        descricao: desc,
        descricaoDetalhada: pick(row, ["descrição detalhada", "descricao detalhada", "desc detalhada"]) || null,
        quantidade: parseNum(pick(row, ["quantidade", "qtd", "qtde"])) || "1",
        unidade: pick(row, ["unidade", "und", "un", "unid"]) || "Unidade",
        valorEstimado: parseNum(pick(row, ["valor estimado (r$)", "valor estimado", "val estimado"])),
        valorUnitario: parseNum(pick(row, ["valor unitário (r$)", "valor unitario (r$)", "valor unitário", "valor unitario", "valor", "preço", "preco"])),
        marcaFabricante: pick(row, ["marca/fabricante", "marca", "fabricante"]) || null,
        modeloVersao: pick(row, ["modelo/versão", "modelo/versao", "modelo", "versão"]) || null,
        enviado: false,
      }).returning();
      inserted.push(novo);
    }

    return NextResponse.json({ message: `${inserted.length} itens importados com sucesso`, itens: inserted }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}
