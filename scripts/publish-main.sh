#!/usr/bin/env bash
set -euo pipefail

MESSAGE="${1:-update: publicação direta no main}"

printf "\n🚀 Publicando direto no main...\n"

git add .
git commit -m "$MESSAGE" || echo "ℹ️ Nada novo para commitar"
git push origin main

printf "\n✅ Push enviado para main. O GitHub Actions vai validar e publicar no Vercel automaticamente.\n\n"
