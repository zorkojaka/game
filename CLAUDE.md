# CLAUDE.md

Glej **[AGENTS.md](./AGENTS.md)** — enotna navodila za vse AI agente (arhitektura, okolje, deploy, varnostna pravila).

Hitri povzetek:
- Ta stroj JE produkcija. Igra v živo: https://game.inteligent.si
- Backend port 4000 (PM2 app `ai-vs-humanity`), frontend Vite 4001.
- Engine = čiste funkcije v `src/engine/`. Balansiranje → `src/engine/constants.ts`.
- **Workflow:** commit → `git push origin main` (backup) → `./deploy.sh`.
- Nikoli ne commitaj `.env`.
