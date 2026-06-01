#!/usr/bin/env bash
# Varni deploy za AI vs Humanity (game.inteligent.si)
# Uporaba:
#   ./deploy.sh            # frontend + backend
#   ./deploy.sh frontend   # samo frontend
#   ./deploy.sh backend    # samo backend
set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-all}"
WEBROOT="/var/www/ai-vs-humanity"
PM2_APP="ai-vs-humanity"

echo "==> Deploy target: $TARGET"

# 1) Opozori, če so necommitane spremembe (git = edina varnostna kopija)
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠  Necommitane spremembe! Git je edina varnostna kopija."
  echo "   Commitaj in pushaj pred deployem (git add -p && git commit && git push origin main)."
  read -r -p "   Vseeno nadaljujem z deployem? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Prekinjeno."; exit 1; }
fi

# 2) Opozori, če lokalna veja ni potisnjena
if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  if [ -n "$(git log @{u}.. --oneline)" ]; then
    echo "⚠  Lokalni commiti niso potisnjeni na GitHub (backup manjka)."
    read -r -p "   Naj zdaj pushnem (git push)? [Y/n] " p
    if [ "$p" != "n" ] && [ "$p" != "N" ]; then git push; fi
  fi
else
  echo "⚠  Veja nima upstream-a — ni backupa na GitHub."
fi

# 3) Build + deploy
if [ "$TARGET" = "all" ] || [ "$TARGET" = "frontend" ]; then
  echo "==> Build frontend..."
  ( cd client && npm run build )
  echo "==> Kopiram v $WEBROOT ..."
  cp -r client/dist/. "$WEBROOT/"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "backend" ]; then
  echo "==> Build backend (tsc)..."
  npx tsc
  echo "==> Restart PM2 ($PM2_APP)..."
  pm2 restart "$PM2_APP" --update-env
fi

echo "✅ Deploy končan. Preveri: https://game.inteligent.si"
