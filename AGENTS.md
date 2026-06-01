# AGENTS.md — AI vs Humanity

Navodila za AI agente (Codex, Claude) ki delajo na tem projektu.
Ta datoteka je vir resnice o projektu, arhitekturi, deployu in pravilih dela.

## Kaj je projekt

Poteza-strateška igra: AI (protagonist) proti človeški klanu (igralec).
MVP = enoigralec, determinističen engine. Multiplayer in evolucija AI sta po-MVP.

## Okolje (POMEMBNO)

- **Ta stroj JE produkcijski strežnik.** Hetzner `ubuntu-4gb-nbg1-2`, uporabnik `jaka`, IP `178.104.24.47`.
- **Igra je v živo:** https://game.inteligent.si (SSL aktiven, nginx + PM2).
- Delaš neposredno na produkciji — bodi previden. Vedno commitaj in pushaj pred deployem.

## Tech stack

- **Backend:** TypeScript + Express, port **4000** (`npm run dev` → `tsx watch src/server/index.ts`)
- **Frontend:** React + Vite, dev port **4001** (`cd client && npm run dev`)
- **DB:** MongoDB Atlas, db `ai-vs-humanity`, kolekciji `gamesessions`, `completedruns`. Poverilnice v `.env` (NI v gitu).
- **Process manager:** PM2, app `ai-vs-humanity` (port 4000, `dist/server/index.js`)
- **nginx:** `/etc/nginx/sites-available/game.inteligent.si` (enabled). `/api/` → 127.0.0.1:4000, ostalo SPA fallback.

## Arhitektura — 3 sloji (NE krši)

- `src/engine/` — **čiste funkcije** `(state, action) → new state`, determinističen seedan RNG (mulberry32). Brez stranskih učinkov, brez I/O.
- `src/server/` — Express REST API.
- `client/src/` — React UI, samo renderira stanje iz `GameState`.

### Engine fajli
- `types.ts` — vsi tipi (GameState, AIPhase, HumanAxis, Expedition, Assignment, Mission, OddsPreview, RoundLog…)
- `constants.ts` — **vse nastavljive številke** (začni tu za balansiranje)
- `game.ts` — glavna zanka: `newGame()`, `processRound()`, `previewOdds()`
- `expedition.ts` — odprave (scout/mission) s potjo; stealth način
- `map.ts`, `combat.ts`, `ai-brain.ts`, `fog.ts`, `rng.ts`

### Koncepti
- 3 AI faze: find → understand → eliminate (vsaka 12 rund)
- 3 človeške osi: hiding / espionage / defense (M_os modifier)
- Megla vojne na AI drevesu (unknown/partial/revealed)
- Boj: verjetnost iz razmerja moči; plen sorazmeren marginu zmage
- Clan activity [0,1] = davek na AI robote proti nam

## Workflow — VEDNO sledi temu zaporedju

1. Naredi spremembo na veji `main` (ali feature veji).
2. `npm test` — testi morajo iti skozi.
3. `git add -p` (samo svoje spremembe), commitaj z jasnim sporočilom.
4. `git push origin main` — **backup na GitHub PRED deployem**.
5. Deploy z `./deploy.sh` (glej spodaj).

## Deploy

Uporabi pripravljeni skript iz korena repozitorija:

```bash
./deploy.sh            # frontend + backend, z varnostnimi preverbami
./deploy.sh frontend   # samo frontend (build + cp v /var/www)
./deploy.sh backend    # samo backend (build + pm2 restart)
```

Ročno (kar dela deploy.sh):
- Frontend: `npm run deploy` → build + `cp -r client/dist/. /var/www/ai-vs-humanity/`
- Backend: `npm run build` → `pm2 restart ai-vs-humanity`

## Varnostna pravila

- **NIKOLI ne commitaj `.env`** ali poverilnic (že v `.gitignore`).
- **Vedno pushaj pred deployem** — git je edina varnostna kopija.
- Ne diraj drugih aplikacij na strežniku: `aintel` (3000), `aintel-staging` (3001), `go` (3077).
- Port 4000/4001 sta rezervirana za ta projekt.
- Pred destruktivnimi git ukazi (reset --hard, force push) razmisli dvakrat — to je produkcija.

## Drugi serverji na stroju (NE diraj)
- `aintel` → port 3000
- `aintel-staging` → port 3001
- `go` → port 3077
