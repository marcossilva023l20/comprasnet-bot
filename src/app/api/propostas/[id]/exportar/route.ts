import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas, itens } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { COLUNAS_EXPORTACAO, LARGURAS_EXPORTACAO, montarLinhasExportacao } from "@/lib/planilha-export";
import * as XLSX from "xlsx";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [proposta] = await db.select().from(propostas).where(eq(propostas.id, +id));
    if (!proposta) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const rows = await db.select().from(itens).where(eq(itens.propostaId, +id)).orderBy(asc(itens.numeroItem));

    const data = montarLinhasExportacao(rows);

    const ws = XLSX.utils.json_to_sheet(data, { header: [...COLUNAS_EXPORTACAO] });
    ws["!cols"] = LARGURAS_EXPORTACAO.map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Itens");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const name = `proposta_${proposta.numeroDispensa.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao exportar" }, { status: 500 });
  }
}
