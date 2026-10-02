/**
 * Versão publicada da extensão e histórico de novidades.
 *
 * A versão "de verdade" fica em `public/extension/manifest.json` (é ela que vai
 * no ZIP); a constante abaixo é o que o app informa à extensão. Um teste
 * (`tests/extensao.test.ts`) garante que as duas nunca divirjam.
 *
 * Ao publicar uma nova versão da extensão: suba `VERSAO_EXTENSAO`, o
 * `version` do manifest e acrescente uma entrada em `NOVIDADES_EXTENSAO`.
 */

export const VERSAO_EXTENSAO = "1.5.4";

export type NovidadeExtensao = {
  versao: string;
  itens: string[];
};

/** Mais recente primeiro — a extensão mostra só o que é mais novo que ela. */
export const NOVIDADES_EXTENSAO: NovidadeExtensao[] = [
  {
    versao: "1.5.4",
    itens: [
      "Botão \"📋 Copiar relatório\" no popup: envie o relatório do salvamento para o suporte",
      "Relatório do salvamento mostra o valor que ficou em cada campo da página",
    ],
  },
  {
    versao: "1.5.3",
    itens: [
      "Preenche digitando tecla a tecla (máscaras de R$ só aceitam assim) e confirma o valor com o site antes de salvar",
      "Se o site não reage ao primeiro Salvar, tenta de novo (e informa as 2 tentativas)",
      "Confirma também na janela do site quando ele pede \"Confirmar\" depois de Salvar",
      "Diário do que aconteceu no popup: botão escolhido (id/classe), mensagens que o site mostrou e campos ainda vazios no painel",
    ],
  },
  {
    versao: "1.5.2",
    itens: [
      "Correção do Salvar: o botão é procurado no rodapé do item, em shadow DOM e pelo id/classe — não só pelo texto",
      "Espera o botão Salvar habilitar e confirma no site se o item foi gravado",
      "Relatório item a item no popup: salvo, sem confirmação ou não salvo (com o motivo)",
      "Só marca como enviado no sistema o item que foi realmente salvo na página",
      "Preenchimento dispara a sequência completa de eventos (beforeinput/input/change) e detecta valor recusado por máscara",
      "Ao usar o Salvar de um formulário, envia uma única vez (nunca salva em dobro)",
    ],
  },
  {
    versao: "1.5.1",
    itens: [
      "Correção: a descrição do item não pega mais o texto de botões (\"Adicionar aos favoritos\")",
      "Descrição lida da célula ao lado do número do item",
      "Quantidade, unidade e valor estimado lidos mesmo quando o rótulo e o valor ficam em áreas separadas",
    ],
  },
  {
    versao: "1.5.0",
    itens: [
      "Ler itens da página agora clica na seta “mostrar detalhes” — nunca mais em Favoritos",
      "Lista escondida atrás de “Mostrar todos os itens” é aberta automaticamente",
      "Descrição e descrição detalhada lidas corretamente (o painel expandido não vira a descrição principal)",
      "Preenchimento item a item, salvando cada item no seu próprio botão Salvar",
    ],
  },
  {
    versao: "1.4.0",
    itens: [
      "Verificar atualização direto na extensão (aba ⚙️ Config)",
      "Atualizar em um clique: a extensão grava os arquivos novos na própria pasta e recarrega",
      "Aviso de nova versão no ícone do navegador e ao abrir o popup",
    ],
  },
  {
    versao: "1.3.0",
    itens: [
      "Ler os itens da página do ComprasNet e enviar para o sistema",
      "Prévia dos itens, destino detectado e confirmação antes de substituir",
    ],
  },
];

/** Nome exibido no aviso de atualização. */
export const NOME_EXTENSAO = "ComprasNet - Preenchedor de Propostas";

/**
 * Compara duas versões no formato "1.2.3".
 * Devolve -1 se `a` for mais antiga, 0 se iguais e 1 se `a` for mais nova.
 * Partes não numéricas são ignoradas ("1.4.0-beta" == "1.4.0") e partes
 * ausentes valem zero ("1.4" == "1.4.0").
 */
export function compararVersoes(a: string | null | undefined, b: string | null | undefined): number {
  const partes = (valor: string | null | undefined): number[] =>
    String(valor ?? "")
      .split(".")
      .map((parte) => {
        const numero = parseInt(parte.replace(/[^0-9].*$/, ""), 10);
        return Number.isFinite(numero) ? numero : 0;
      });

  const pa = partes(a);
  const pb = partes(b);
  const tamanho = Math.max(pa.length, pb.length);

  for (let i = 0; i < tamanho; i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Formatos aceitos como versão de extensão do Chrome (1 a 4 partes numéricas). */
export function versaoValida(valor: unknown): boolean {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return /^\d{1,4}(\.\d{1,4}){0,3}$/.test(texto);
}

/**
 * Novidades publicadas depois da versão instalada.
 * Sem versão instalada (ou versão inválida), devolve tudo — quem chama decide
 * o que exibir nesse caso.
 */
export function novidadesDesde(instalada: string | null | undefined): NovidadeExtensao[] {
  const base = versaoValida(instalada) ? (instalada as string) : null;
  if (!base) return [...NOVIDADES_EXTENSAO];

  return NOVIDADES_EXTENSAO.filter((entrada) => compararVersoes(entrada.versao, base) > 0).sort(
    (a, b) => compararVersoes(b.versao, a.versao),
  );
}

export type EstadoAtualizacao = {
  /** Versão publicada pelo app. */
  versao: string;
  /** Versão que a extensão informou estar usando (null quando não informou). */
  instalada: string | null;
  /** true quando existe versão mais nova que a instalada. */
  precisaAtualizar: boolean;
  /** true quando a extensão está em versão mais nova que a publicada (dev local). */
  adiantada: boolean;
  novidades: NovidadeExtensao[];
  zip: { url: string; nome: string };
  /** JSON com o conteúdo dos arquivos, usado pela atualização em um clique. */
  arquivosUrl: string;
};

export function montarEstadoAtualizacao(instalada: string | null): EstadoAtualizacao {
  const valida = versaoValida(instalada) ? (instalada as string) : null;
  const comparacao = valida ? compararVersoes(VERSAO_EXTENSAO, valida) : 1;

  return {
    versao: VERSAO_EXTENSAO,
    instalada: valida,
    precisaAtualizar: comparacao > 0,
    adiantada: comparacao < 0,
    novidades: novidadesDesde(valida),
    zip: { url: "/extension.zip", nome: `comprasnet-bot-extensao-${VERSAO_EXTENSAO}.zip` },
    arquivosUrl: "/extension-files.json",
  };
}
