/**
 * Planilha exportada pelo sistema (📤 Exportar Planilha).
 *
 * As colunas abaixo são um contrato: é esta planilha que o usuário edita no
 * Excel e devolve pelo 📥 Importar Planilha. O teste de ida-e-volta
 * (`tests/planilha-import.test.ts`) garante que exportar → editar → importar
 * devolve exatamente os mesmos itens (a coluna `Item` é a chave da atualização).
 */

export type ItemParaExportar = {
  numeroItem: number;
  descricao: string;
  descricaoDetalhada: string | null;
  quantidade: string;
  unidade: string;
  valorEstimado: string | null;
  valorUnitario: string | null;
  valorMinimo: string | null;
  marcaFabricante: string | null;
  modeloVersao: string | null;
  enviado: boolean | null;
};

/** Cabeçalhos na ordem em que aparecem na planilha. */
export const COLUNAS_EXPORTACAO = [
  "Item",
  "Descrição",
  "Descrição Detalhada",
  "Quantidade",
  "Unidade",
  "Valor Estimado (R$)",
  "Valor Unitário (R$)",
  "Valor Mínimo (R$)",
  "Marca/Fabricante",
  "Modelo/Versão",
  "Enviado",
] as const;

/** Larguras (em caracteres) de cada coluna, casadas com COLUNAS_EXPORTACAO. */
export const LARGURAS_EXPORTACAO = [6, 35, 50, 12, 12, 18, 18, 18, 25, 25, 10];

const numero = (valor: string | null) => (valor === null || valor === "" ? "" : parseFloat(valor));

/** Colunas de valores: o portal usa 4 casas decimais ("44,0000"). */
export const COLUNAS_QUATRO_CASAS = ["Valor Estimado (R$)", "Valor Unitário (R$)", "Valor Mínimo (R$)"] as const;

/** Formato de célula para o Excel mostrar "44,0000" (e não "44"). */
export const FORMATO_QUATRO_CASAS = "0.0000";

type CelulaDaPlanilha = { v?: unknown; z?: string };

/**
 * Aplica o formato de 4 casas às células de valor (linha 1 = cabeçalho),
 * para que a planilha aberta no Excel mostre 44,0000 como no portal.
 */
export function aplicarFormatoValores(
  ws: Record<string, CelulaDaPlanilha | undefined>,
  linhas: number,
): void {
  for (const coluna of COLUNAS_QUATRO_CASAS) {
    const indice = COLUNAS_EXPORTACAO.indexOf(coluna);
    if (indice < 0 || indice > 25) continue;
    const letra = String.fromCharCode(65 + indice);

    for (let linha = 0; linha < linhas; linha += 1) {
      const celula = ws[`${letra}${linha + 2}`];
      if (celula && typeof celula.v === "number") celula.z = FORMATO_QUATRO_CASAS;
    }
  }
}

export function montarLinhasExportacao(itens: ItemParaExportar[]): Record<string, unknown>[] {
  return itens.map((item) => ({
    Item: item.numeroItem,
    "Descrição": item.descricao,
    "Descrição Detalhada": item.descricaoDetalhada || "",
    Quantidade: numero(item.quantidade),
    Unidade: item.unidade,
    "Valor Estimado (R$)": numero(item.valorEstimado),
    "Valor Unitário (R$)": numero(item.valorUnitario),
    "Valor Mínimo (R$)": numero(item.valorMinimo),
    "Marca/Fabricante": item.marcaFabricante || "",
    "Modelo/Versão": item.modeloVersao || "",
    Enviado: item.enviado ? "Sim" : "Não",
  }));
}
