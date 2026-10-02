# 🤖 ComprasNet Bot — Preenchedor de Propostas

Sistema web para preenchimento automático de propostas de licitação no portal ComprasNet (compras.gov.br).

## Stack

- **Next.js 16** (App Router) — frontend e API
- **Neon PostgreSQL** (serverless) — banco de dados
- **Drizzle ORM** — acesso ao banco
- **Vercel** — hosting gratuito
- **Extensão Chrome** — automação no navegador do usuário

## Deploy Gratuito

1. **GitHub** → suba este repositório
2. **Neon** → crie um projeto em [neon.tech](https://neon.tech) e copie a `DATABASE_URL`
3. **Vercel** → importe o repositório do GitHub e adicione `DATABASE_URL` nas env vars

## Fluxo de publicação sem PR (direto no `main`)

Este projeto já vem preparado para publicar **sem pull request**.

### Passo 1 — Configurar 1 vez
Crie estes secrets no GitHub Repository → **Settings → Secrets and variables → Actions**:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Depois disso, o workflow `.github/workflows/deploy-main.yml` passa a publicar automaticamente no Vercel a cada push no `main`.

### Passo 2 — Atualizar para sempre
Sempre que quiser publicar uma alteração, rode direto:

```bash
git add .
git commit -m "sua atualização"
git push origin main
```

Ou use o script incluso:

```bash
bash scripts/publish-main.sh "sua atualização"
```

Pronto: **sem PR, sem merge, sem branch intermediária**.

## Variáveis de Ambiente

```env
DATABASE_URL=postgresql://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require
```

## Desenvolvimento Local

```bash
npm install
# Copie .env.example para .env e preencha DATABASE_URL
npx drizzle-kit push
npm run dev
```

## Extensão Chrome

Baixe o ZIP em `/extension.zip` ou acesse `/extensao` no sistema.

## Como usar

1. Crie uma proposta e importe a planilha Excel com os itens
2. Preencha Valor Unitário, Marca/Fabricante e Modelo/Versão
3. Instale a extensão Chrome
4. Acesse o ComprasNet → Cadastrar Propostas
5. Abra a extensão → selecione a proposta → clique Executar Bot!
