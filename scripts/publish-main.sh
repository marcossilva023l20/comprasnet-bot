#!/usr/bin/env bash
set -euo pipefail

MESSAGE="${1:-update: publicação direta no main}"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "main" ]]; then
  printf '❌ Este script só publica a branch local main (branch atual: %s).\n' "${CURRENT_BRANCH:-detached HEAD}" >&2
  exit 1
fi

printf "\n🚀 Preparando publicação da branch main...\n"

git add -A
if git diff --cached --quiet; then
  printf "ℹ️ Nenhuma alteração para commitar.\n"
else
  git commit -m "$MESSAGE"
fi

git push origin main
printf "\n✅ Push enviado para origin/main. Se a integração Git do Vercel estiver ativa, ela iniciará o deploy automaticamente.\n\n"
