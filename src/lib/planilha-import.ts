/**
 * Leitura das linhas de uma planilha de itens da proposta.
 *
 * A planilha exportada pelo sistema (📤 Exportar Planilha) tem, entre outras, as
 * colunas `Item`, `Quantidade`, `Valor Unitário (R$)`... Ao importar de volta:
 *
 *   - **a coluna `Item` manda**: números que já existem na proposta são
 *     atualizados (sem duplicar) e números novos viram itens novos;
 *   - **só as colunas presentes na planilha são alteradas** — apagar uma coluna
 *     (ou não incluí-la) preserva o que está no sistema;
 *   - **célula em branco numa coluna presente vale como "apagar"** (é assim que
 *     se limpa um valor pelo Excel); para `Quantidade`/`Unidade`, que são
 *     obrigatórias, o branco mantém o valor atual;
 *   - sem nenhuma linha numerada, a planilha é *somada* à proposta: os itens
 *     entram depois do último número existente (nada é sobrescrito).
 */
import {
  isBlankNumericValue,
  normalizeSpreadsheetHeader,
  parseLocalizedNumber,
} from "@/lib/numbers";

export type LinhaDaPlanilha = {
  numeroItem: number;
  descricao: string;
  descricaoDetalhada: string | null;
  quantidade: string | null;
  unidade: string | null;
  valorEstimado: string | null;
  valorUnitario: string | null;
  marcaFabricante: string | null;
  modeloVersao: string | null;
  /** Colunas presentes na planilha — só elas são alteradas ao atualizar. */
  colunas: {
    descricaoDetalhada: boolean;
    quantidade: boolean;
    unidade: boolean;
    valorEstimado: boolean;
    valorUnitario: boolean;
    marcaFabricante: boolean;
    modeloVersao: boolean;
  };
};

export type ResultadoLeituraPlanilha = {
  linhas: LinhaDaPlanilha[];
  /** "atualizar" quando há linhas numeradas; senão "adicionar". */
  modo: "atualizar" | "adicionar";
  ignoradasSemDescricao: number;
  /** Números repetidos na própria planilha (a importação deve ser recusada). */
  duplicados: number[];
  /** Problemas por linha, no formato "linha 3: valor unitário". */
  invalidos: string[];
};

type LinhaBruta = Record<string, unknown>;

const COLUNAS = {
  descricao: ["descrição", "descricao", "desc", "descrição do item", "descricao do item", "item"],
  numeroItem: ["nº", "n°", "num", "número item", "numero item", "número", "numero", "item"],
  descricaoDetalhada: ["descrição detalhada", "descricao detalhada", "desc detalhada"],
  quantidade: ["quantidade", "qtd", "qtde"],
  unidade: ["unidade", "und", "un", "unid"],
  valorEstimado: ["valor estimado (r$)", "valor estimado", "val estimado"],
  valorUnitario: [
    "valor unitário (r$)",
    "valor unitario (r$)",
    "valor unitário",
    "valor unitario",
    "valor",
    "preço",
    "preco",
  ],
  marcaFabricante: ["marca/fabricante", "marca", "fabricante"],
  modeloVersao: ["modelo/versão", "modelo/versao", "modelo", "versão", "versao"],
} as const;

const toText = (value: unknown) => (value == null ? "" : String(value).trim());

function celulasDaLinha(row: LinhaBruta): Map<string, unknown> {
  return new Map(Object.entries(row).map(([chave, valor]) => [normalizeSpreadsheetHeader(chave), valor]));
}

function lerColuna(celulas: Map<string, unknown>, aliases: readonly string[]): { presente: boolean; valor: unknown } {
  for (const alias of aliases) {
    const chave = normalizeSpreadsheetHeader(alias);
    if (celulas.has(chave)) return { presente: true, valor: celulas.get(chave) };
  }
  return { presente: false, valor: "" };
}

function parseItemNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const normalized = parseLocalizedNumber(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function lerLinhasDaPlanilha(
  rows: LinhaBruta[],
  { numeroBase = 0 }: { numeroBase?: number } = {},
): ResultadoLeituraPlanilha {
  const invalidos: string[] = [];
  const duplicados: number[] = [];
  const numerosVistos = new Map<number, number>();
  const preparadas: {
    linha: Omit<LinhaDaPlanilha, "numeroItem">;
    numeroLido: number | null;
  }[] = [];
  let ignoradasSemDescricao = 0;

  for (const [index, row] of rows.entries()) {
    const celulas = celulasDaLinha(row);

    const descricao = toText(lerColuna(celulas, COLUNAS.descricao).valor);
    if (!descricao) {
      ignoradasSemDescricao += 1;
      continue;
    }

    const colunaNumero = lerColuna(celulas, COLUNAS.numeroItem);
    let numeroLido: number | null = null;
    if (colunaNumero.presente && !isBlankNumericValue(colunaNumero.valor)) {
      numeroLido = parseItemNumber(colunaNumero.valor);
      if (numeroLido === null) {
        invalidos.push(`linha ${index + 2}: número do item`);
        continue;
      }
      const anterior = numerosVistos.get(numeroLido);
      if (anterior !== undefined) {
        duplicados.push(numeroLido);
        invalidos.push(`linha ${index + 2}: item ${numeroLido} repetido (já aparece na linha ${anterior})`);
        continue;
      }
      numerosVistos.set(numeroLido, index + 2);
    }

    const colunasPresentes = {
      descricaoDetalhada: false,
      quantidade: false,
      unidade: false,
      valorEstimado: false,
      valorUnitario: false,
      marcaFabricante: false,
      modeloVersao: false,
    };

    const lerColunaNumerica = (aliases: readonly string[], rotulo: string, nome: keyof typeof colunasPresentes) => {
      const { presente, valor } = lerColuna(celulas, aliases);
      if (!presente) return null;
      colunasPresentes[nome] = true;
      if (isBlankNumericValue(valor)) return null;
      const numero = parseLocalizedNumber(valor);
      if (numero === null) {
        invalidos.push(`linha ${index + 2}: ${rotulo}`);
        return undefined; // sinaliza erro
      }
      return numero;
    };

    const quantidade = lerColunaNumerica(COLUNAS.quantidade, "quantidade", "quantidade");
    if (quantidade === undefined) continue;
    const valorEstimado = lerColunaNumerica(COLUNAS.valorEstimado, "valor estimado", "valorEstimado");
    if (valorEstimado === undefined) continue;
    const valorUnitario = lerColunaNumerica(COLUNAS.valorUnitario, "valor unitário", "valorUnitario");
    if (valorUnitario === undefined) continue;

    const lerColunaTexto = (aliases: readonly string[], nome: keyof typeof colunasPresentes) => {
      const { presente, valor } = lerColuna(celulas, aliases);
      if (!presente) return null;
      colunasPresentes[nome] = true;
      const texto = toText(valor);
      return texto || null;
    };

    preparadas.push({
      numeroLido,
      linha: {
        descricao,
        descricaoDetalhada: lerColunaTexto(COLUNAS.descricaoDetalhada, "descricaoDetalhada"),
        quantidade,
        unidade: lerColunaTexto(COLUNAS.unidade, "unidade"),
        valorEstimado,
        valorUnitario,
        marcaFabricante: lerColunaTexto(COLUNAS.marcaFabricante, "marcaFabricante"),
        modeloVersao: lerColunaTexto(COLUNAS.modeloVersao, "modeloVersao"),
        colunas: colunasPresentes,
      },
    });
  }

  const modo: "atualizar" | "adicionar" = preparadas.some((linha) => linha.numeroLido !== null)
    ? "atualizar"
    : "adicionar";

  if (duplicados.length > 0) {
    return { linhas: [], modo, ignoradasSemDescricao, duplicados: [...new Set(duplicados)].sort((a, b) => a - b), invalidos };
  }

  // Números explícitos primeiro; quem não tem número entra depois do último.
  let proximo = Math.max(
    Number.isSafeInteger(numeroBase) && numeroBase > 0 ? numeroBase : 0,
    ...preparadas.map((linha) => linha.numeroLido ?? 0),
  );
  const usados = new Set(preparadas.map((linha) => linha.numeroLido).filter((n): n is number => n !== null));

  const linhas: LinhaDaPlanilha[] = preparadas.map(({ linha, numeroLido }) => {
    let numeroItem = numeroLido;
    if (numeroItem === null) {
      proximo += 1;
      while (usados.has(proximo)) proximo += 1;
      usados.add(proximo);
      numeroItem = proximo;
    }
    return { numeroItem, ...linha };
  });

  return { linhas, modo, ignoradasSemDescricao, duplicados: [], invalidos };
}

/** Payload enviado ao Postgres (jsonb_to_recordset) — chaves em snake_case. */
export function montarPayloadImportacao(linhas: LinhaDaPlanilha[]) {
  return linhas.map((linha) => ({
    numero_item: linha.numeroItem,
    descricao: linha.descricao,
    descricao_detalhada: linha.descricaoDetalhada,
    quantidade: linha.quantidade,
    unidade: linha.unidade,
    valor_estimado: linha.valorEstimado,
    valor_unitario: linha.valorUnitario,
    marca_fabricante: linha.marcaFabricante,
    modelo_versao: linha.modeloVersao,
    set_descricao_detalhada: linha.colunas.descricaoDetalhada,
    set_quantidade: linha.colunas.quantidade,
    set_unidade: linha.colunas.unidade,
    set_valor_estimado: linha.colunas.valorEstimado,
    set_valor_unitario: linha.colunas.valorUnitario,
    set_marca_fabricante: linha.colunas.marcaFabricante,
    set_modelo_versao: linha.colunas.modeloVersao,
  }));
}
