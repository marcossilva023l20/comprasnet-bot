/**
 * Regras (puras) de casamento entre a página do ComprasNet e as propostas do
 * sistema, além da normalização dos itens lidos pela extensão.
 *
 * Este módulo não fala com o banco: existe para poder ser testado e para ser
 * compartilhado entre as rotas /api/propostas/localizar e
 * /api/propostas/importar-pagina.
 */
import { parseLocalizedNumber, isBlankNumericValue } from "./numbers";

export type IdentificacaoPagina = {
  /** UASG exibida na página (ex.: "170162"). */
  uasg?: string | null;
  /** Número da compra/processo (ex.: "17016205900012025"). */
  numeroCompra?: string | null;
  /** Alternativa ao número da compra quando a página mostra uma dispensa. */
  numeroDispensa?: string | null;
  objeto?: string | null;
  dataLimite?: string | null;
  url?: string | null;
};

export type PropostaResumo = {
  id: number;
  numeroDispensa: string;
  uasg: string | null;
  objeto?: string | null;
  dataLimite?: string | null;
  updatedAt?: Date | string | null;
};

export type ItemLidoNaPagina = {
  numeroItem?: unknown;
  descricao?: unknown;
  descricaoDetalhada?: unknown;
  quantidade?: unknown;
  unidade?: unknown;
  valorEstimado?: unknown;
  valorUnitario?: unknown;
  marcaFabricante?: unknown;
  modeloVersao?: unknown;
};

export type ItemNormalizado = {
  numeroItem: number;
  descricao: string;
  descricaoDetalhada: string | null;
  quantidade: string;
  unidade: string;
  valorEstimado: string | null;
  valorUnitario: string | null;
  marcaFabricante: string | null;
  modeloVersao: string | null;
};

export const MAX_ITENS_PAGINA = 500;

/** Somente dígitos. Útil para comparar UASG/compra sem depender de formatação. */
export function somenteDigitos(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

/** Texto comparável: sem acentos, minúsculo, espaços colapsados. */
export function textoComparavel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai a UASG (5 ou 6 dígitos) de um texto como "170162 - ALFÂNDEGA...". */
export function extrairUasg(value: unknown): string {
  const texto = String(value ?? "");
  const direto = texto.match(/^\s*(\d{5,6})\b/);
  if (direto) return direto[1];
  const rotulado = texto.match(/uasg\s*:?\s*(\d{5,6})\b/i);
  return rotulado ? rotulado[1] : "";
}

/**
 * Número que representa a compra para efeito de casamento.
 * `numeroCompra` é o mais forte; na falta dele usamos `numeroDispensa`.
 */
export function numeroChave(ident: IdentificacaoPagina): string {
  return somenteDigitos(ident.numeroCompra) || somenteDigitos(ident.numeroDispensa);
}

/** Valor a gravar em `numero_dispensa` quando a proposta precisa ser criada. */
export function montarNumeroDispensa(ident: IdentificacaoPagina): string {
  const compra = String(ident.numeroCompra ?? "").trim();
  if (compra) return compra;

  const dispensa = String(ident.numeroDispensa ?? "").trim();
  if (dispensa) return dispensa;

  const uasg = extrairUasg(ident.uasg) || somenteDigitos(ident.uasg);
  if (uasg) return `UASG ${uasg} (importado da página)`;

  return "Importado da página do ComprasNet";
}

function dataDeAtualizacao(proposta: PropostaResumo): number {
  if (!proposta.updatedAt) return 0;
  const valor = proposta.updatedAt instanceof Date ? proposta.updatedAt.getTime() : Date.parse(String(proposta.updatedAt));
  return Number.isFinite(valor) ? valor : 0;
}

function maisRecente(propostas: PropostaResumo[]): PropostaResumo {
  return [...propostas].sort((a, b) => dataDeAtualizacao(b) - dataDeAtualizacao(a))[0];
}

export type ResultadoCasamento = {
  proposta: PropostaResumo | null;
  motivo: string;
};

/**
 * Decide qual proposta existente corresponde à página lida.
 *
 * Ordem (da mais forte para a mais fraca):
 *   1. número da compra idêntico ao `numero_dispensa` da proposta;
 *   2. número da compra contido em `numero_dispensa` (ou vice-versa);
 *   3. mesma UASG (somente quando não há número de compra utilizável).
 *
 * Sem número de compra e com mais de uma proposta na mesma UASG, escolhe a
 * atualizada mais recentemente — e diz isso em `motivo` para a extensão exibir.
 */
export function casarProposta(
  candidatas: PropostaResumo[],
  ident: IdentificacaoPagina,
): ResultadoCasamento {
  const chave = numeroChave(ident);
  const uasg = extrairUasg(ident.uasg) || somenteDigitos(ident.uasg);

  if (chave.length >= 6) {
    const exatas = candidatas.filter((p) => somenteDigitos(p.numeroDispensa) === chave);
    if (exatas.length === 1) return { proposta: exatas[0], motivo: "número da compra idêntico" };
    if (exatas.length > 1) return { proposta: maisRecente(exatas), motivo: "número da compra idêntico (mais recente)" };
  }

  if (chave.length >= 6) {
    const contidas = candidatas.filter((p) => {
      const alvo = somenteDigitos(p.numeroDispensa);
      if (alvo.length < 6) return false;
      return alvo.includes(chave) || chave.includes(alvo);
    });
    if (contidas.length === 1) return { proposta: contidas[0], motivo: "número da compra parcialmente igual" };
    if (contidas.length > 1) {
      const mesmaUasg = uasg ? contidas.filter((p) => somenteDigitos(p.uasg) === uasg) : [];
      if (mesmaUasg.length) return { proposta: maisRecente(mesmaUasg), motivo: "número da compra + UASG (mais recente)" };
      return { proposta: maisRecente(contidas), motivo: "número da compra parcialmente igual (mais recente)" };
    }
  }

  if (uasg) {
    const porUasg = candidatas.filter((p) => somenteDigitos(p.uasg) === uasg);
    if (porUasg.length === 1) return { proposta: porUasg[0], motivo: "mesma UASG" };
    if (porUasg.length > 1) {
      return {
        proposta: maisRecente(porUasg),
        motivo: "mesma UASG — havia várias; usei a atualizada mais recentemente (confira antes de enviar)",
      };
    }
  }

  return { proposta: null, motivo: "nenhuma proposta correspondente — uma nova será criada" };
}

function textoOuNulo(value: unknown, limite = 4000): string | null {
  if (typeof value !== "string") return null;
  const texto = value.trim();
  if (!texto) return null;
  return texto.length > limite ? texto.slice(0, limite) : texto;
}

/**
 * Converte os itens crus lidos pela extensão no formato aceito pelo banco.
 *
 * É tolerante de propósito: uma página real traz ruído. Valores numéricos
 * inválidos viram `null` (com aviso) em vez de derrubar a importação inteira, e
 * itens sem número utilizável são ignorados.
 */
export function normalizarItensDaPagina(raw: unknown): {
  itens: ItemNormalizado[];
  ignorados: { indice: number; motivo: string }[];
  duplicados: number;
  avisos: string[];
} {
  const lista = Array.isArray(raw) ? raw : [];
  const itens: ItemNormalizado[] = [];
  const ignorados: { indice: number; motivo: string }[] = [];
  const avisos: string[] = [];
  const vistos = new Set<number>();
  let duplicados = 0;

  lista.slice(0, MAX_ITENS_PAGINA).forEach((entrada, indice) => {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
      ignorados.push({ indice: indice + 1, motivo: "formato inválido" });
      return;
    }

    const item = entrada as ItemLidoNaPagina;
    const numeroBruto = item.numeroItem;
    const numero =
      typeof numeroBruto === "number"
        ? numeroBruto
        : Number(somenteDigitos(numeroBruto).slice(0, 6) || NaN);

    if (!Number.isSafeInteger(numero) || numero < 0) {
      ignorados.push({ indice: indice + 1, motivo: "sem número de item legível" });
      return;
    }
    if (vistos.has(numero)) {
      duplicados += 1;
      return;
    }
    vistos.add(numero);

    const lerNumero = (valor: unknown): string | null => {
      if (isBlankNumericValue(valor)) return null;
      const parsed = parseLocalizedNumber(valor);
      return parsed === null ? null : parsed;
    };

    const valorEstimado = lerNumero(item.valorEstimado);
    if (valorEstimado === null && !isBlankNumericValue(item.valorEstimado)) {
      avisos.push(`Item ${numero}: valor estimado não reconhecido ("${String(item.valorEstimado).slice(0, 40)}") — gravado em branco.`);
    }

    const valorUnitario = lerNumero(item.valorUnitario);
    if (valorUnitario === null && !isBlankNumericValue(item.valorUnitario)) {
      avisos.push(`Item ${numero}: valor unitário não reconhecido ("${String(item.valorUnitario).slice(0, 40)}") — gravado em branco.`);
    }

    let quantidade = lerNumero(item.quantidade);
    if (quantidade === null) {
      quantidade = "1";
      if (!isBlankNumericValue(item.quantidade)) {
        avisos.push(`Item ${numero}: quantidade não reconhecida — usando 1.`);
      }
    }

    const descricao = textoOuNulo(item.descricao, 2000) ?? "Sem descrição";

    itens.push({
      numeroItem: numero,
      descricao,
      descricaoDetalhada: textoOuNulo(item.descricaoDetalhada),
      quantidade,
      unidade: textoOuNulo(item.unidade, 50) ?? "Unidade",
      valorEstimado,
      valorUnitario,
      marcaFabricante: textoOuNulo(item.marcaFabricante, 255),
      modeloVersao: textoOuNulo(item.modeloVersao, 255),
    });
  });

  if (lista.length > MAX_ITENS_PAGINA) {
    avisos.push(`A página tinha mais de ${MAX_ITENS_PAGINA} itens; apenas os ${MAX_ITENS_PAGINA} primeiros foram considerados.`);
  }
  if (duplicados > 0) {
    avisos.push(`${duplicados} item(ns) repetido(s) na leitura foram ignorados.`);
  }

  return { itens, ignorados, duplicados, avisos };
}
