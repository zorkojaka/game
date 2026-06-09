#!/usr/bin/env bash
set -Eeuo pipefail

# ⚠ VERZIONIRANA KOPIJA za backup. ŽIVA skripta, ki jo požene CI, je
#   /home/jaka/deploy-ai-vs-humanity.sh — ob spremembi posodobi OBE.
# Modeled on /home/jaka/deploy-aintel.sh (proven pattern), adapted for ai-vs-humanity.
# IMPORTANT: never touches .env. `git reset --hard` only affects tracked files;
# .env is gitignored + untracked, so it is preserved across deploys.

APP_DIR="/home/jaka/apps/ai-vs-humanity"
BRANCH="main"
PM2_APP="ai-vs-humanity"
WEB_ROOT="/var/www/ai-vs-humanity"

# ── Serializiraj deploye (CI + ročni) ────────────────────────────────────────
# Prepreči, da bi se dva deploya prekrivala na istem koraku (git reset / kopiranje
# webroota). Drugi deploy POČAKA na prvega, namesto da bi ga povozil.
LOCK_FILE="/tmp/deploy-ai-vs-humanity.lock"
exec 9>"$LOCK_FILE"
if ! flock -w 600 9; then
  echo "!! Drug deploy še teče (lock zaseden > 600 s). Prekinjam."
  exit 1
fi

echo "== DEPLOY AI-VS-HUMANITY START (lock pridobljen) =="

cd "$APP_DIR"

echo "1. Fetch from git"
git fetch origin

echo "2. Reset to origin/$BRANCH (tracked files only; .env untouched)"
git reset --hard "origin/$BRANCH"

echo "3. Install dependencies (root + client)"
npm ci
npm ci --prefix client

echo "4. Build (server tsc + client vite build)"
npm run build

DIST="$APP_DIR/client/dist"
# Varovalo: brez veljavne zgradnje se webroota NE dotaknemo (prepreči 403/prazno stran).
[ -f "$DIST/index.html" ] || { echo "!! Build ni ustvaril $DIST/index.html — prekinjam pred deployem."; exit 1; }

echo "5. Deploy frontend ATOMARNO (brez okna brez index.html)"
# 5a. Najprej dodaj NOVE (hashtagirane) assete POLEG obstoječih. Stari ostanejo,
#     da morebitni hkratni nalagalci stare strani ne dobijo 404.
sudo mkdir -p "$WEB_ROOT/assets"
sudo cp -r "$DIST/assets/." "$WEB_ROOT/assets/"
# 5b. Druge korenske datoteke (favicon, ikone …) razen index.html — additivno.
sudo find "$DIST" -maxdepth 1 -type f ! -name index.html -exec cp -f {} "$WEB_ROOT/" \;
# 5c. ATOMARNA zamenjava index.html (zapis v začasno + rename na istem FS = atomarno).
#     nginx vedno vidi celoten star ALI celoten nov index.html, nikoli praznega.
sudo cp "$DIST/index.html" "$WEB_ROOT/.index.html.new"
sudo mv -f "$WEB_ROOT/.index.html.new" "$WEB_ROOT/index.html"
# 5d. Po preklopu varno počisti zastarele assete (novi index.html jih ne potrebuje več).
sudo find "$WEB_ROOT/assets" -maxdepth 1 -type f -print0 | while IFS= read -r -d '' f; do
  base="$(basename "$f")"
  [ -e "$DIST/assets/$base" ] || sudo rm -f "$f"
done

echo "6. Restart app"
pm2 restart "$PM2_APP" --update-env

echo "7. PM2 status"
pm2 list

echo "== DEPLOY DONE =="
