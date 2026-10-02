import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { itens } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { executarConsultaLinhas } from "@/lib/db-result";
import { lerLinhasDaPlanilha, montarPayloadImportacao } from "@/lib/planilha-import";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 1_000;
const ACCEPTED_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

/**
 * Importa a planilha de itens (📥 Importar Planilha).
 *
 * A coluna `Item` decide o que acontece com cada linha:
 *   - número que já existe na proposta → o item é ATUALIZADO (não duplica);
 *   - número novo → o item é criado;
 *   - planilha sem números → os itens são adicionados depois do último.
 *
 * Só as colunas presentes na planilha são alteradas (apagar uma coluna preserva
 * o que está no sistema); célula em branco numa coluna presente apaga o valor —
 * menos Quantidade/Unidade, que mantêm o valor atual por serem obrigatórias.
 *
 * Tudo roda em um único statement (CTE com UPDATE + INSERT): o driver HTTP do
 * Neon não suporta transações, e assim uma falha no meio não deixa a proposta
 * pela metade.
 */
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

    // ── Último número de item da proposta: base para linhas sem número ───────
    const [atual] = await executarConsultaLinhas<{ maximo: number | null }>(
      sql`SELECT MAX(numero_item)::int AS maximo FROM itens WHERE proposta_id = ${propostaId}`,
    );
    const numeroBase = Number(atual?.maximo ?? 0) || 0;

    const leitura = lerLinhasDaPlanilha(rows, { numeroBase });
    const { linhas, modo, ignoradasSemDescricao, duplicados, invalidos } = leitura;

    if (invalidos.length) {
      return NextResponse.json(
        {
          error: `Não importei: ${invalidos.slice(0, 10).join("; ")}${invalidos.length > 10 ? `; e mais ${invalidos.length - 10} linha(s)` : ""}`,
          duplicados,
        },
        { status: 400 },
      );
    }

    if (!linhas.length) {
      return NextResponse.json({ error: "Nenhum item com descrição foi encontrado na planilha" }, { status: 400 });
    }

    // ── Atualização (por número) + criação (números novos) num só statement ──
    const payload = JSON.stringify(montarPayloadImportacao(linhas));

    const [resultado] = await executarConsultaLinhas<{ atualizados: number; criados: number }>(sql`
      WITH dados AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          numero_item integer,
          descricao text,
          descricao_detalhada text,
          quantidade numeric,
          unidade text,
          valor_estimado numeric,
          valor_unitario numeric,
          marca_fabricante text,
          modelo_versao text,
          set_descricao_detalhada boolean,
          set_quantidade boolean,
          set_unidade boolean,
          set_valor_estimado boolean,
          set_valor_unitario boolean,
          set_marca_fabricante boolean,
          set_modelo_versao boolean
        )
      ), alvo AS (
        SELECT id FROM propostas WHERE id = ${propostaId}::int
      ), atualizados AS (
        UPDATE itens SET
          descricao = d.descricao,
          descricao_detalhada = CASE WHEN d.set_descricao_detalhada THEN d.descricao_detalhada ELSE itens.descricao_detalhada END,
          quantidade = CASE WHEN d.set_quantidade THEN COALESCE(d.quantidade, itens.quantidade) ELSE itens.quantidade END,
          unidade = CASE WHEN d.set_unidade THEN COALESCE(d.unidade, itens.unidade) ELSE itens.unidade END,
          valor_estimado = CASE WHEN d.set_valor_estimado THEN d.valor_estimado ELSE itens.valor_estimado END,
          valor_unitario = CASE WHEN d.set_valor_unitario THEN d.valor_unitario ELSE itens.valor_unitario END,
          marca_fabricante = CASE WHEN d.set_marca_fabricante THEN d.marca_fabricante ELSE itens.marca_fabricante END,
          modelo_versao = CASE WHEN d.set_modelo_versao THEN d.modelo_versao ELSE itens.modelo_versao END,
          -- Item cujo preenchimento mudou volta para a fila do bot.
          enviado = CASE
            WHEN (d.set_valor_unitario AND d.valor_unitario IS DISTINCT FROM itens.valor_unitario)
              OR (d.set_marca_fabricante AND d.marca_fabricante IS DISTINCT FROM itens.marca_fabricante)
              OR (d.set_modelo_versao AND d.modelo_versao IS DISTINCT FROM itens.modelo_versao)
            THEN false ELSE itens.enviado END,
          updated_at = now()
        FROM dados d
        WHERE itens.proposta_id = (SELECT id FROM alvo)
          AND itens.numero_item = d.numero_item
        RETURNING itens.id
      ), criados AS (
        INSERT INTO itens (
          proposta_id, numero_item, descricao, descricao_detalhada, quantidade, unidade,
          valor_estimado, valor_unitario, marca_fabricante, modelo_versao, enviado
        )
        SELECT (SELECT id FROM alvo), d.numero_item, d.descricao, d.descricao_detalhada,
               COALESCE(d.quantidade, 1), COALESCE(d.unidade, 'Unidade'), d.valor_estimado,
               d.valor_unitario, d.marca_fabricante, d.modelo_versao, false
        FROM dados d
        WHERE NOT EXISTS (
          SELECT 1 FROM itens i
          WHERE i.proposta_id = (SELECT id FROM alvo) AND i.numero_item = d.numero_item
        )
        RETURNING id
      )
      SELECT (SELECT count(*) FROM atualizados)::int AS atualizados,
             (SELECT count(*) FROM criados)::int AS criados
    `);

    const atualizados = Number(resultado?.atualizados ?? 0);
    const criados = Number(resultado?.criados ?? 0);

    if (atualizados + criados === 0) {
      return NextResponse.json(
        { error: "Nenhum item foi importado. Confira a planilha (colunas Item e Descrição) e tente novamente." },
        { status: 400 },
      );
    }

    const listaAtual = await db
      .select()
      .from(itens)
      .where(eq(itens.propostaId, propostaId))
      .orderBy(asc(itens.numeroItem));

    const partes = [
      atualizados ? `${atualizados} item(ns) atualizado(s)` : "",
      criados ? `${criados} item(ns) novo(s)` : "",
    ].filter(Boolean);

    return NextResponse.json(
      {
        message: `${partes.join(" e ")}${ignoradasSemDescricao ? ` · ${ignoradasSemDescricao} linha(s) sem descrição ignorada(s)` : ""}`,
        modo,
        atualizados,
        criados,
        ignoradasSemDescricao,
        itens: listaAtual,
      },
      { status: atualizados ? 200 : 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erro ao importar planilha" }, { status: 500 });
  }
}
