# 🤖 ComprasNet Bot — Preenchedor de Propostas

Sistema web para preenchimento automático de propostas de licitação no portal ComprasNet (compras.gov.br).

## Stack

- **Next.js 16** (App Router) — frontend e API
- **Neon PostgreSQL** (serverless) — banco de dados
- **Drizzle ORM** — acesso ao banco (+ migrações SQL versionadas em `drizzle/`)
- **Vercel** — hosting gratuito
- **Extensão Chrome** — automação no navegador do usuário

---

## 🚀 Deploy na Vercel com Neon (passo a passo)

### 1. Banco no Neon

1. Crie um projeto em [neon.tech](https://neon.tech) (região **South America / sa-east-1**).
2. Em **Connection details**, escolha **Pooled connection** e copie a string.

Tanto a string *pooled* quanto a direta funcionam: em hosts `*.neon.tech` o app usa o driver HTTP do
Neon (`@neondatabase/serverless`), que é stateless e não estoura o limite de conexões em funções
serverless. O `channel_binding=require` que o Neon costuma adicionar é aceito sem problemas.

### 2. Variável de ambiente na Vercel

No projeto da Vercel: **Settings → Environment Variables**

| Nome | Valor |
| --- | --- |
| `DATABASE_URL` | `postgresql://usuario:senha@ep-xxxx-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require` |

Marque **Production**, **Preview** e **Development**. A variável precisa existir **antes** do
primeiro deploy, porque o build cria as tabelas.

Opcionais:

| Nome | Valor | Para que serve |
| --- | --- | --- |
| `DATABASE_DRIVER` | `pg` | força o driver `node-postgres` em vez do HTTP do Neon |
| `SKIP_DB_MIGRATIONS` | `1` | pula a migração automática do build |
| `PGPOOL_MAX` | número | tamanho do pool (padrão: 1 na Vercel, 10 local) |

### 3. Deploy

- **Vercel → Add New → Project → importe o repositório do GitHub → Deploy.**
- Não é preciso mudar nada em *Build Command*: o `npm run build` deste projeto
  1. gera `public/extension.zip` (download da extensão),
  2. aplica as migrações SQL (`npm run db:migrate`),
  3. roda o `next build`.

### Deploy automático (Arena → `main` → Vercel)

O deploy de produção é automático e **sem pull request**:

1. cada push numa branch `arena/**` dispara o workflow
   [`.github/workflows/arena-publish.yml`](.github/workflows/arena-publish.yml), que roda
   **lint, typecheck, testes e build**;
2. se tudo passar, a **mesma revisão** (o mesmo commit validado) é publicada em `main` por
   *fast-forward* — sem commit novo, sem force-push, sem sobrescrever nada;
3. o push em `main` dispara o **deploy de produção na Vercel** pela integração Git do projeto
   (Project Settings → Git, branch de produção `main`). Nenhum token da Vercel é necessário no
   GitHub.

As publicações são **serializadas** (uma de cada vez). Se `main` tiver divergido, se o `git push`
for recusado ou se qualquer verificação falhar, **nada é publicado** e o resumo do job explica o
motivo. Conflitos de histórico exigem decisão humana: o workflow nunca resolve conflitos sozinho.

#### O que o CI nunca faz (configuração segura)

- **Não conecta no banco de produção**: `DATABASE_URL` não é definida em lugar nenhum do CI e o
  build roda com `SKIP_DB_MIGRATIONS=1`, então **nenhuma migração é aplicada**. As migrações
  continuam rodando apenas no build da Vercel, como sempre (`npm run build` → `db:migrate`).
- Há uma **guarda** que falha o workflow se algum dia o secret `DATABASE_URL` ficar visível ao CI.
- `GITHUB_TOKEN` com o mínimo necessário: `contents: read` em todo o workflow e
  `contents: write` **apenas** no job de publicação. Nenhum outro escopo é pedido.
- Nenhum token, senha ou credencial fica no código ou é solicitado por aqui.

#### Configuração necessária no GitHub (uma vez)

| Onde | Ajuste | Por quê |
| --- | --- | --- |
| Settings → Actions → General → **Workflow permissions** | **Read and write permissions** | O workflow pede `contents: write` explicitamente no job de publicação (o que já costuma bastar), mas manter essa opção garante o `git push` do `GITHUB_TOKEN`. |
| Settings → Actions → General → **Actions permissions** | permitir `actions/checkout` e `actions/setup-node` | Se o repositório bloquear ações de terceiros, o workflow não roda. |
| Settings → **Branches / Rulesets** (`main`) | manter `main` **sem exigir PR**; se houver proteção, incluir **GitHub Actions** nas exceções (bypass) | Um push de bot em branch protegida sem bypass é recusado — e aí o fluxo para sem publicar. |

O token `GITHUB_TOKEN` é criado automaticamente pelo GitHub a cada execução. Nada precisa ser
cadastrado em *Secrets* para o fluxo básico.

#### Opcional: garantir o deploy com um Deploy Hook

A Vercel pode recusar deploys de commits cujo autor não seja o dono da conta
(*"Git author must have access to the project on Vercel"*). Como a publicação vem dos commits da
sessão da Arena (autor = seu usuário do GitHub), isso normalmente não acontece. Se acontecer:

1. Vercel → Project → **Settings → Git → Deploy Hooks → Create Hook** (branch `main`);
2. copie a URL e cadastre em GitHub → Settings → Secrets and variables → Actions →
   **New repository secret**, com o nome `VERCEL_DEPLOY_HOOK`;
3. pronto — o workflow passa a disparar o deploy explicitamente depois de publicar em `main`,
   sem nenhuma credencial no código.

#### Como verificar que a publicação automática funcionou

1. **GitHub → Actions** → execução do workflow da branch `arena/**`: os jobs *Verificações* e
   *Publicar em main* devem ficar verdes. O **Summary** do job mostra a revisão publicada e o
   estado de `main`.
2. **GitHub → `main`**: o topo de `main` deve ser exatamente o commit da branch, por exemplo
   `git fetch origin main && git rev-parse origin/main`.
3. **Vercel → Deployments**: deve existir um deploy de **Production** (`Ready`) para esse mesmo
   commit. Se `main` avançou e a Vercel não mostrou deploy, veja a seção do Deploy Hook acima.
4. **Produção**: `https://SEU-APP.vercel.app/api/health` deve responder
   `{"ok":true,...}` (ver seção 4 abaixo).

### 4. Verificação

Abra `https://SEU-APP.vercel.app/api/health`. Resposta esperada:

```json
{ "ok": true, "driver": "neon-http", "host": "ep-...-pooler.sa-east-1.aws.neon.tech", "tables": { "propostas": true, "itens": true } }
```

Se aparecer `ok: false`, a própria home do sistema mostra um painel com o erro e o que fazer.

---

## Variáveis de Ambiente

```env
DATABASE_URL=postgresql://usuario:senha@ep-xxxx-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require
```

Copie `.env.example` para `.env` para desenvolvimento local.

## Desenvolvimento Local

```bash
npm install
cp .env.example .env        # preencha DATABASE_URL
npm run db:migrate          # cria as tabelas
npm run dev                 # http://localhost:3000
```

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | sobe o servidor de desenvolvimento |
| `npm run build` | gera o ZIP da extensão + migra o banco + build de produção |
| `npm run db:migrate` | aplica as migrações de `drizzle/` no banco (idempotente) |
| `npm run db:generate` | gera uma nova migração a partir de `src/db/schema.ts` |
| `npm run db:push` | envia o schema direto (atalho, sem arquivo de migração) |
| `npm run db:studio` | abre o Drizzle Studio |
| `npm run typecheck` / `npm run lint` / `npm test` | validações e testes automatizados |
| `scripts/publish-main.sh` | publicação manual (legado) — só funciona com a branch local `main`. O fluxo normal é o workflow `arena/**` → `main` descrito acima |

## Extensão Chrome

Baixe o ZIP em `/extension.zip` ou acesse `/extensao` no sistema. Depois, na extensão:
**⚙️ Config → cole a URL do app** (ex.: `https://SEU-APP.vercel.app`).

### Importar os itens da página (extensão → sistema)

Além de preencher o ComprasNet, a extensão lê a lista de itens publicada na página
e envia para o sistema — assim os itens deixam de ser digitados/planilhados à mão:

1. abra a página de cadastro de propostas do ComprasNet com os itens visíveis;
2. no popup, clique em **📥 Ler itens da página** (a extensão pode expandir cada
   item — "mostrar detalhes" — para trazer a descrição completa);
3. confira os itens lidos e o destino detectado (UASG / número da compra);
4. marque a confirmação e clique em **⬆️ Enviar para o sistema**.

Como o destino é decidido (endpoint `GET /api/propostas/localizar`):

| Situação | O que acontece |
| --- | --- |
| Já existe proposta com o mesmo número de compra | Os itens são gravados nela |
| Não existe | Uma proposta nova é criada com UASG, objeto e data limite da página |
| Várias propostas com a mesma UASG e sem número de compra | Usa a atualizada mais recentemente e avisa na tela |

O envio (`POST /api/propostas/importar-pagina`) **substitui** os itens da proposta
pelos itens lidos — nada é duplicado e nada é apagado sem confirmação: a API exige
`confirmarSubstituicao: true` e recusa lista vazia. A troca é feita em **uma única
instrução SQL** (DELETE + INSERT na mesma query), então uma falha no meio deixa os
itens anteriores intactos (o driver HTTP do Neon não suporta transações, e esta
solução não depende delas). Linhas que o ComprasNet não mostra (valor unitário,
marca e modelo) ficam em branco, prontas para o preenchimento pelo bot.

## Como usar

1. Crie uma proposta e importe a planilha Excel com os itens
2. Preencha Valor Unitário, Marca/Fabricante e Modelo/Versão
3. Instale a extensão Chrome
4. Acesse o ComprasNet → Cadastrar Propostas e expanda os itens
5. Abra a extensão, selecione a proposta e clique **Ler página** para mapear os campos
6. Confira os campos encontrados e clique **Executar Bot!**
