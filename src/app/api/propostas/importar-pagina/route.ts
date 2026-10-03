import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propostas } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import {
  casarProposta,
  extrairUasg,
  montarNumeroDispensa,
  normalizarItensDaPagina,
  somenteDigitos,
  type IdentificacaoPagina,
} from "@/lib/proposta-match";
import { executarConsultaLinhas } from "@/lib/db-result";

/**
 * Importa para o sistema os itens lidos na página do ComprasNet pela extensão.
 *
 * POST /api/propostas/importar-pagina
 * {
 *   "identificacao": { "uasg": "170162", "numeroCompra": "...", "objeto": "...", "dataLimite": "...", "url": "..." },
 *   "itens": [ { "numeroItem": 1, "descricao": "...", "quantidade": "1", "unidade": "UNIDADE", "valorEstimado": "37553,33" } ],
 *   "confirmarSubstituicao": true
 * }
 *
 * Comportamento: localiza a proposta pela identificação da página (ou cria uma
 * nova) e SUBSTITUI os itens dela pelos itens lidos — é uma operação destrutiva
 * e por isso exige `confirmarSubstituicao: true` e nunca aceita lista vazia.
 *
 * Substituição atômica: um único statement (CTE com DELETE + INSERT) garante
 * que, se algo falhar, os itens antigos continuam intactos. Isso é necessário
 * porque o driver HTTP do Neon não suporta `db.transaction()`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400, headers: CORS });
    }

    const entrada = body as {
      identificacao?: IdentificacaoPagina;
      itens?: unknown;
      confirmarSubstituicao?: unknown;
    };

    // Trava de segurança: substituir itens é destrutivo e precisa ser explícito.
    if (entrada.confirmarSubstituicao !== true) {
      return NextResponse.json(
        {
          error:
            "Substituição não confirmada. Envie `confirmarSubstituicao: true` ciente de que os itens atuais da proposta serão substituídos pelos itens lidos na página.",
        },
        { status: 400, headers: CORS },
      );
    }

    const identificacao: IdentificacaoPagina = entrada.identificacao ?? {};
    const { itens, ignorados, duplicados, avisos } = normalizarItensDaPagina(entrada.itens);

    if (itens.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhum item legível foi recebido. Nada foi alterado (a proposta existente continua intacta). Expanda os itens na página e tente ler novamente.",
          ignorados,
          avisos,
        },
        { status: 400, headers: CORS },
      );
    }

    // ── 1) Localiza a proposta (mesma regra da rota /localizar) ──────────────
    const uasg = extrairUasg(identificacao.uasg) || somenteDigitos(identificacao.uasg);
    const candidatas = await db
      .select({
        id: propostas.id,
        numeroDispensa: propostas.numeroDispensa,
        uasg: propostas.uasg,
        objeto: propostas.objeto,
        dataLimite: propostas.dataLimite,
        updatedAt: propostas.updatedAt,
      })
      .from(propostas)
      .where(uasg ? sql`regexp_replace(coalesce(${propostas.uasg}, ''), '[^0-9]', '', 'g') = ${uasg}` : sql`true`)
      .orderBy(desc(propostas.updatedAt))
      .limit(200);

    const { proposta: encontrada, motivo } = casarProposta(candidatas, identificacao);

    // Quantos itens serão substituídos (informativo, e usado pela extensão).
    let itensAnteriores = 0;
    if (encontrada) {
      const [linha] = await executarConsultaLinhas<{ total: number }>(
        sql`SELECT COUNT(*)::int AS total FROM itens WHERE proposta_id = ${encontrada.id}`,
      );
      itensAnteriores = Number(linha?.total ?? 0);
    }

    // ── 2) Substituição atômica (cria a proposta se necessário) ──────────────
    // O JSON usa chaves em snake_case para casar com o AS x(...) abaixo.
    const payload = JSON.stringify(
      itens.map((item) => ({
        numero_item: item.numeroItem,
        descricao: item.descricao,
        descricao_detalhada: item.descricaoDetalhada,
        quantidade: item.quantidade,
        unidade: item.unidade,
        valor_estimado: item.valorEstimado,
        valor_unitario: item.valorUnitario,
        marca_fabricante: item.marcaFabricante,
        modelo_versao: item.modeloVersao,
      })),
    );

    const numeroDispensa = encontrada?.numeroDispensa ?? montarNumeroDispensa(identificacao);

    const inseridos = await executarConsultaLinhas<{ proposta_id: number; numero_item: number }>(sql`
      WITH proposta_existente AS (
        SELECT id FROM propostas WHERE id = ${encontrada?.id ?? null}::int
      ), proposta_nova AS (
        INSERT INTO propostas (numero_dispensa, uasg, objeto, data_limite, status)
        SELECT ${numeroDispensa}::text,
               ${identificacao.uasg ?? null}::text,
               ${identificacao.objeto ?? null}::text,
               ${identificacao.dataLimite ?? null}::text,
               'rascunho'
        WHERE ${encontrada?.id ?? null}::int IS NULL
        RETURNING id
      ), alvo AS (
        SELECT id FROM proposta_existente
        UNION ALL
        SELECT id FROM proposta_nova
      ), removidos AS (
        DELETE FROM itens WHERE proposta_id = (SELECT id FROM alvo) RETURNING numero_item, valor_minimo
      )
      INSERT INTO itens (
        proposta_id, numero_item, descricao, descricao_detalhada, quantidade, unidade,
        valor_estimado, valor_unitario, valor_minimo, marca_fabricante, modelo_versao, enviado
      )
      SELECT (SELECT id FROM alvo), x.numero_item, x.descricao, x.descricao_detalhada,
             x.quantidade, x.unidade, x.valor_estimado, x.valor_unitario, removidos.valor_minimo,
             x.marca_fabricante, x.modelo_versao, false
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        numero_item integer,
        descricao text,
        descricao_detalhada text,
        quantidade numeric,
        unidade text,
        valor_estimado numeric,
        valor_unitario numeric,
        marca_fabricante text,
        modelo_versao text
      )
      LEFT JOIN removidos ON removidos.numero_item = x.numero_item
      RETURNING proposta_id, numero_item
    `);

    const propostaId = Number(inseridos[0]?.proposta_id ?? encontrada?.id ?? 0);
    if (!Number.isSafeInteger(propostaId) || propostaId <= 0) {
      return NextResponse.json({ error: "Não foi possível determinar a proposta de destino" }, { status: 500, headers: CORS });
    }

    const [destino] = await db
      .select({
        id: propostas.id,
        numeroDispensa: propostas.numeroDispensa,
        uasg: propostas.uasg,
        objeto: propostas.objeto,
        dataLimite: propostas.dataLimite,
      })
      .from(propostas)
      .where(eq(propostas.id, propostaId));

    return NextResponse.json(
      {
        ok: true,
        criada: !encontrada,
        motivo,
        proposta: destino,
        itensInseridos: inseridos.length,
        itensSubstituidos: itensAnteriores,
        itensIgnorados: ignorados,
        duplicados,
        avisos,
      },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          "Erro ao importar os itens. Nada foi substituído — se o problema persistir, confira a conexão do banco (DATABASE_URL).",
      },
      { status: 500, headers: CORS },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
