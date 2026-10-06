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

export const VERSAO_EXTENSAO = "1.7.20";

export type NovidadeExtensao = {
  versao: string;
  itens: string[];
};

/** Mais recente primeiro — a extensão mostra só o que é mais novo que ela. */
export const NOVIDADES_EXTENSAO: NovidadeExtensao[] = [
  {
    versao: "1.7.20",
    itens: [
      "Permite escolher a versão exata no atualizador, inclusive voltar para uma anterior; a escolha só é instalada após confirmação",
      "Disponibiliza pacotes históricos completos e identifica versões experimentais; mantém a base 1.7.19, sem ativar lances automáticos",
    ],
  },
  {
    versao: "1.7.19",
    itens: [
      "Corrige a leitura do Radar PNCP quando o contador dos itens fica colado ao título no DOM (ex.: “Itens da contratação43”)",
    ],
  },
  {
    versao: "1.7.18",
    itens: [
      "Lê UASG sob o rótulo Nº UASG (Unidade Compradora) no modal real do Radar PNCP",
      "Prioriza o Nº da compra/ano visível (ex.: 80/2026) para identificar o destino da importação",
    ],
  },
  {
    versao: "1.7.17",
    itens: [
      "Ajusta a leitura do CNET Mobile para os cartões sanfonados com Qtde solicitada, como na tela Acompanhar Contratação",
      "Corrige a leitura do Radar PNCP quando o título Itens da contratação inclui um contador e reconhece o controle PNCP do modal",
    ],
  },
  {
    versao: "1.7.16",
    itens: [
      "Permite ler itens do CNET Mobile/Compras.gov.br após abrir Acompanhar compra e do Radar de Licitações PNCP após abrir Ver detalhes",
      "Importa número, descrição, quantidade, unidade e valor estimado da tabela de itens; pode abrir Mostrar detalhes do item para capturar a descrição completa",
    ],
  },
  {
    versao: "1.7.15",
    itens: [
      "Adiciona o campo Valor Mínimo (R$) no sistema e na planilha, com edição por item, tabela, inclusão manual e importação/exportação",
      "Cria a estrutura inicial do Modo Disputa e uma janela flutuante com a mesma velocidade configurada no Modo Proposta",
      "Monitoramento dos concorrentes e envio automático de lances permanecem desativados até a validação com uma licitação ativa",
    ],
  },
  {
    versao: "1.7.14",
    itens: [
      "Corrige a troca de página durante o preenchimento: espera os itens da próxima página aparecerem e estabilizarem antes de continuar, evitando pular o primeiro item",
      "Ao localizar um item em uma página conhecida, aguarda o item estar presente no DOM antes de começar a preencher",
      "Continua os itens na ordem crescente, passando da última linha de uma página para o primeiro item da seguinte",
    ],
  },
  {
    versao: "1.7.13",
    itens: [
      "Corrige a escala observada em produção (67,4100 → 674.100,0000): os prefixos intermediários são convertidos para a escala decimal antes do evento input, evitando que 674100 seja lido como reais inteiros",
      "Detecta máscaras que recebem a vírgula como separador decimal (primeiro dígito exibido como 6,0000) e só envia keypress quando keydown não aceitou a tecla",
      "Valores com duas casas, como 61,41, mantêm o mesmo preço e são exibidos com quatro casas no portal (61,4100); o bot não salva se a conferência do preço falhar",
    ],
  },
  {
    versao: "1.7.12",
    itens: [
      "Evita que o mesmo dígito seja consumido duas vezes: espera a resposta assíncrona de keydown antes de emitir keypress e não manda os dois eventos quando a máscara já aceitou a tecla",
      "Entradas com duas casas, como 61,41, mantêm o mesmo número e são normalizadas para quatro casas no portal (61,4100), sem duplicar os zeros iniciais de 0,0000",
      "Mantém marca/modelo e só salva se o preço exibido continuar exatamente igual ao solicitado",
    ],
  },
  {
    versao: "1.7.11",
    itens: [
      "Corrige o preenchimento em máscaras que exibem 6,0000 no primeiro dígito: os caracteres seguintes usam apenas o prefixo numérico, sem reaproveitar os zeros da tela (evita 674.100,0000)",
      "Não envia Backspace extra quando a máscara já reagiu ao keydown; o preço só chega a Salvar se continuar exatamente igual ao valor informado",
      "Encontra o botão Salvar do portal pelo nome acessível (texto, aria-label ou aria-labelledby), inclusive o botão br-button",
    ],
  },
  {
    versao: "1.7.10",
    itens: [
      "Corrige a máscara que formata o primeiro dígito como 6,0000: o bot continua digitando os demais caracteres e confere o preço completo antes de salvar",
      "A tecla usada para registrar o valor no portal é enviada com segurança; se ela alterar o preço, o bot não salva um valor incorreto e continua marca/modelo para diagnóstico",
      "Mantém as quatro casas decimais e confirma o clique em Salvar; se houver confirmação, escolhe Sim, nunca Não",
    ],
  },
  {
    versao: "1.7.9",
    itens: [
      "O valor unitário não é mais alterado pela cutucada do formulário: o bot mantém e confere exatamente o preço informado (ex.: 67,4100) antes de salvar",
      "Se uma máscara mudar o preço ao registrar o campo, o item não é salvo com valor incorreto; o preenchimento continua nos campos de marca e modelo para diagnóstico",
      "A confirmação do ComprasNet é reconhecida mesmo sem role/ARIA/classe conhecida; o bot clica em Sim e nunca em Não",
    ],
  },
  {
    versao: "1.7.8",
    itens: [
      "Correção da escala do valor unitário: a máscara recebe só os dígitos e mantém 4 casas (1,0000 · 10,0000 · 100,0000 · 1000,0000), sem deslocar ou duplicar números",
      "O valor é lançado uma única vez; se a máscara não confirmar o número, o item não é salvo com valor errado",
      "Depois do valor unitário, o preenchimento continua normalmente para marca/fabricante e modelo/versão",
    ],
  },
  {
    versao: "1.7.7",
    itens: [
      "O valor unitário é lançado UMA vez só: o bot parou de limpar e reescrever o campo depois de preenchido — antes, quando o portal não 'acordava' com o valor, o bot lançava de novo e o valor aparecia duas vezes",
      "O valor agora fica sempre com 4 casas decimais no portal (ex.: 1.232,8000): o bot digita o texto completo, espera a máscara e só corrige a escala quando o campo realmente ficou com outro número",
      "O bot confere primeiro se o campo já está com o valor certo: se estiver, ele não escreve nada — nada de relançar por cima do que já foi lançado (inclusive ao rodar a mesma proposta de novo)",
      "Ao cutucar o campo (Backspace + redigitar) para o portal contabilizar, se o valor for apagado pela máscara, o bot devolve o mesmo texto por atribuição direta, sem redigitar dígito por dígito",
      "Zeros à esquerda não contam mais como dígito extra em máscaras de centavos (o campo '0,01' não é lido mais como dígito a mais)",
    ],
  },
  {
    versao: "1.7.6",
    itens: [
      "Correção do valor unitário com uma casa a mais (1.232,8000 virava 12.328,0000): a máscara do portal reage DEPOIS da tecla e, em velocidade alta, o bot escrevia o dígito antes dela — o dígito entrava duas vezes",
      "Agora o bot espera a máscara reagir antes de escrever e confere os dígitos a cada tecla; se o dígito entrar duas vezes, o campo é corrigido na hora",
      "A verificação vale para qualquer velocidade, inclusive 0,001s",
    ],
  },
  {
    versao: "1.7.5",
    itens: [
      "Velocidade máxima agora é 0,001s (1 milissegundo — o limite do próprio navegador): preset 🏎️ 0,001s no popup e campo aceitando de 0,001s a 5s",
      "No máximo o piso das pausas também cai, então TUDO acelera junto: digitação, esperas e conferência de cada item",
      "Correção: no turbo o bot não pula mais item de painel lento — o prazo para esperar o painel do item abrir continua fixo (só o intervalo entre as tentativas acelera)",
    ],
  },
  {
    versao: "1.7.4",
    itens: [
      "Velocidade configurável de 0,01s a 5s: digite o valor em segundos ou use os presets (🚀 0,03s) — a velocidade vale para a digitação, as esperas e a conferência de cada item, não só para a pausa entre itens",
      "O painel na página usa a mesma velocidade escolhida no popup",
    ],
  },
  {
    versao: "1.7.3",
    itens: [
      "O valor unitário é lançado UMA vez só: o bot escreve no formato do portal e só corrige se a máscara do site realmente ler errado (não fica mais relançando o valor)",
      "Rodar de novo em item já preenchido não relança o valor (não mexe no que já está certo)",
      "Preenchimento na ordem do Item: 1, 2, 3... mesmo que a planilha chegue fora de ordem",
      "Não pula mais item: o bot espera o painel do item terminar de abrir e a página parar de redesenhar antes de desistir",
    ],
  },
  {
    versao: "1.7.2",
    itens: [
      "Extensão e painel na página agora usam o roxo do sistema (mesma identidade visual)",
      "Sistema: opção \"🗑️ Excluir todas\" as propostas com confirmação digitada",
    ],
  },
  {
    versao: "1.7.1",
    itens: [
      "Correção: o valor unitário não duplica mais os dígitos (11.223.322,088000 → 1.232,8000)",
      "Correção do painel: \"Proposta a preencher\" carrega as propostas do sistema mesmo com a página aberta (não dá mais \"Failed to fetch\")",
      "A lista de propostas já seleciona a primeira que tem itens preenchidos",
    ],
  },
  {
    versao: "1.7.0",
    itens: [
      "O valor unitário agora é contabilizado pelo portal: o bot dá um Backspace real e redigita (era preciso apertar Backspace na mão para o total sair de 0,0000)",
      "Painel na página com \"📋 Proposta a preencher\": escolha a proposta do sistema e clique em ▶ Iniciar",
      "Painel com ▶ Iniciar · ⏸ Pausar/Continuar · ⏹ Parar; ao terminar, marca no sistema os itens realmente salvos",
    ],
  },
  {
    versao: "1.6.0",
    itens: [
      "Paginação: lê e preenche os itens de TODAS as páginas (10 por página), navegando sozinho",
      "Painel flutuante na própria página, com Pausar/Continuar e Parar — não fecha quando você clica fora",
      "O popup ganhou Pausar/Parar, \"📌 Painel na página\" e \"🗗 Janela flutuante\" (não fecha ao clicar fora)",
      "Quando o site recusa (ex.: \"O campo Valor unitário é obrigatório\"), o bot não marca como salvo e diz o motivo",
      "Reforço do preenchimento para formulários do portal (Angular): o site registra o valor e o campo para de acusar obrigatório",
    ],
  },
  {
    versao: "1.5.5",
    itens: [
      "Valor unitário no formato do portal: 4 casas decimais (44,0000) — era 44,00 e a máscara do site virava 0,4400",
      "O bot confere o que ficou no campo e ajusta o formato sozinho se a máscara usar outras casas (ex.: 44,00)",
      "Planilha e sistema também mostram os valores com 4 casas (44,0000)",
    ],
  },
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
