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
  "Marca/Fabricante",
  "Modelo/Versão",
  "Enviado",
] as const;

/** Larguras (em caracteres) de cada coluna, casadas com COLUNAS_EXPORTACAO. */
export const LARGURAS_EXPORTACAO = [6, 35, 50, 12, 12, 18, 18, 25, 25, 10];

const numero = (valor: string | null) => (valor === null || valor === "" ? "" : parseFloat(valor));

export function montarLinhasExportacao(itens: ItemParaExportar[]): Record<string, unknown>[] {
  return itens.map((item) => ({
    Item: item.numeroItem,
    "Descrição": item.descricao,
    "Descrição Detalhada": item.descricaoDetalhada || "",
    Quantidade: numero(item.quantidade),
    Unidade: item.unidade,
    "Valor Estimado (R$)": numero(item.valorEstimado),
    "Valor Unitário (R$)": numero(item.valorUnitario),
    "Marca/Fabricante": item.marcaFabricante || "",
    "Modelo/Versão": item.modeloVersao || "",
    Enviado: item.enviado ? "Sim" : "Não",
  }));
}
