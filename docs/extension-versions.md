# Catálogo e instalação de versões da extensão

- O atualizador (`Config → Atualizar`) permite selecionar uma versão exata. A seleção apenas consulta o pacote: não grava arquivos nem inicia o bot.
- A instalação exige confirmação, valida SHA-256, versão/nome do manifesto, arquivos e caminhos. Faz backup antes da escrita, grava o manifesto por último e restaura a cópia anterior se algo falhar.
- A versão recomendada é a publicação atual. As versões 1.8.x arquivadas são experimentais, com avisos explícitos sobre lances reais não validados. Nunca são selecionadas automaticamente por terem número maior.
- A página `/extensao` permite baixar o ZIP de qualquer versão disponível. Esse catálogo permanece acessível quando se instala uma versão antiga que não tem o seletor no próprio atualizador.
- Pare toda automação antes de trocar. Depois confirme a versão, recarregue a extensão se necessário e dê F5 nas páginas do portal.

## Publicação e preservação de versões

Os pacotes não são versionados no Git. `scripts/build-extension.mjs` gera `public/extension.zip`, `public/extension-files.json`, `public/extension-versions.json` e `public/extension-releases/` no prebuild/pretest.

`config/extension-releases.json` define as revisões históricas imutáveis. Ao publicar outra versão, adicione a publicação atual a esse arquivo com SHA completo, descrição e classificação correta. Não substitua o SHA de uma versão arquivada por código diferente.

O CI usa histórico completo. Em clones rasos (como os da Vercel), o build recupera os arquivos faltantes apenas de URLs públicas de `raw.githubusercontent.com/marcossilva023l20/comprasnet-bot/<SHA>/public/extension/`. O repositório é público; não é necessário token de GitHub. Se um arquivo faltar ou seu manifesto não corresponder à versão declarada, o build falha em vez de publicar um pacote incompleto.

A API de verificação antiga continua indicando apenas a versão recomendada, para manter compatibilidade com clientes anteriores. O catálogo independente é `/extension-versions.json`, com hashes e links por versão.

A 1.7.20 mantém conteúdo, background, popup e ícones da 1.7.19; só modifica atualizador e manifesto. O Modo Disputa permanece sem envio automático nessa recomendada.
