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

Deploy automático a cada push no `main` já vem pronto em `.github/workflows/deploy-main.yml`
(cadastre os secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` no GitHub).

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
| `npm run typecheck` / `npm run lint` | validação |

## Extensão Chrome

Baixe o ZIP em `/extension.zip` ou acesse `/extensao` no sistema. Depois, na extensão:
**⚙️ Config → cole a URL do app** (ex.: `https://SEU-APP.vercel.app`).

## Como usar

1. Crie uma proposta e importe a planilha Excel com os itens
2. Preencha Valor Unitário, Marca/Fabricante e Modelo/Versão
3. Instale a extensão Chrome
4. Acesse o ComprasNet → Cadastrar Propostas
5. Abra a extensão → selecione a proposta → clique Executar Bot!
