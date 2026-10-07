# Catálogo e instalação de versões da extensão

- O atualizador (`Config → Atualizar`) permite selecionar uma versão exata. A seleção apenas consulta o pacote: não grava arquivos nem inicia o bot.
- A instalação exige confirmação, valida SHA-256, versão/nome do manifesto, arquivos e caminhos. Faz backup antes da escrita, grava o manifesto por último e restaura a cópia anterior se algo falhar.
- A versão recomendada de produção permanece 1.7.20, configurada em `config/extension-policy.json`. A fonte 1.8.14 fica listada como BETA e nunca é selecionada automaticamente por ter número maior. Ela associa Melhor valor e Meu valor no CNET apenas quando cada rótulo tem um preço explícito na mesma linha visual, dentro do cartão identificado; se a geometria for ausente ou ambígua, bloqueia. A 1.8.13 e as BETAs anteriores continuam no catálogo histórico. Versões de Disputa exibem aviso sobre lances reais ainda não validados.
- A página `/extensao` permite baixar o ZIP de qualquer versão disponível. Esse catálogo permanece acessível quando se instala uma versão antiga que não tem o seletor no próprio atualizador.
- Pare toda automação antes de trocar. Depois confirme a versão, recarregue a extensão se necessário e dê F5 nas páginas do portal.

## Publicação e preservação de versões

Os pacotes não são versionados no Git. `scripts/build-extension.mjs` gera os aliases estáveis `public/extension.zip` e `public/extension-files.json` a partir da recomendada, além de `public/extension-versions.json` e os pacotes completos em `public/extension-releases/`, no prebuild/pretest. O manifesto-fonte pode ser BETA; não altere a recomendada até a validação em ambiente real.

`config/extension-releases.json` define as revisões históricas imutáveis. Ao publicar outra versão, adicione a publicação atual a esse arquivo com SHA completo, descrição e classificação correta. Não substitua o SHA de uma versão arquivada por código diferente.

O CI usa histórico completo. Em clones rasos (como os da Vercel), o build recupera os arquivos faltantes apenas de URLs públicas de `raw.githubusercontent.com/marcossilva023l20/comprasnet-bot/<SHA>/public/extension/`. O repositório é público; não é necessário token de GitHub. Se um arquivo faltar ou seu manifesto não corresponder à versão declarada, o build falha em vez de publicar um pacote incompleto.

A API de verificação antiga continua indicando apenas a versão recomendada, para manter compatibilidade com clientes anteriores. O catálogo independente é `/extension-versions.json`, com hashes e links por versão.

A 1.7.20 mantém conteúdo, background, popup e ícones da 1.7.19; só modifica atualizador e manifesto. O Modo Disputa permanece sem envio automático nessa recomendada.
