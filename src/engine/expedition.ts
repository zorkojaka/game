// Odprave (Expedition): scout in mission s potjo
// Vsak mesec se vsaka aktivna odprava premakne za TILES_PER_MONTH polj po poti.
// Za vsako vstopljeno polje:
//   - doda se researchProgress (visit)
//   - sproži se encounter roll (z multiplikatorjem terena)
//   - ob srečanju lahko izgubimo nekaj članov

import type { Expedition, HexTile, GameState, Assignment, AIWeakPoint } from './types.js';
import type { RNGState } from './rng.js';
import { rngNext, rngInt } from './rng.js';
import { tileId } from './types.js';
import {
  visibilityFromProgress, tileEncounterMultiplier, researchPerVisit, hexDistance,
} from './map.js';
import {
  SCOUT_CAPTURE_BASE, SCOUT_CAPTURE_PER_SCOUT, SCOUT_AI_KNOWLEDGE_BONUS,
  SCOUT_CAPTURED_LOSS_MIN, SCOUT_CAPTURED_LOSS_MAX,
  ENCOUNTER_SCOUT_REFERENCE, ENCOUNTER_MIN_FACTOR,
} from './constants.js';

export const TILES_PER_MONTH = 1;  // en korak = en mesec

const CLAN_POS = { q: 0, r: 4 };

/**
 * Faktor srečanj glede na število izvidniških enot AI.
 * Manj izvidnikov (manj robotov) → manjša verjetnost srečanja. Pri polnem številu = 1.
 */
export function encounterScoutFactor(aiScouts: number): number {
  const f = ENCOUNTER_MIN_FACTOR + (1 - ENCOUNTER_MIN_FACTOR) * Math.min(1, Math.max(0, aiScouts) / ENCOUNTER_SCOUT_REFERENCE);
  return Math.max(0, Math.min(1, f));
}

/** Verjetnost srečanja na enem polju, glede na opremo izvidnikov + teren + AI izvidniške enote. */
export function tileEncounterProbability(tile: HexTile, assigned: number, aiKnowledge: number, aiScouts: number = ENCOUNTER_SCOUT_REFERENCE): number {
  const distFromCamp = hexDistance({ q: tile.q, r: tile.r }, CLAN_POS);
  const base = SCOUT_CAPTURE_BASE
    + SCOUT_CAPTURE_PER_SCOUT * assigned
    + SCOUT_AI_KNOWLEDGE_BONUS * aiKnowledge;
  const p = base * tileEncounterMultiplier(tile.researchProgress, distFromCamp) * encounterScoutFactor(aiScouts);
  return Math.max(0, Math.min(0.85, p));
}

/** Kumulativna verjetnost srečanja na celotni poti — za UI prikaz vnaprej. */
export function pathEncounterProbability(
  path: Array<{ q: number; r: number }>,
  tiles: HexTile[],
  assigned: number,
  aiKnowledge: number,
  aiScouts: number = ENCOUNTER_SCOUT_REFERENCE,
): number {
  let pNo = 1;
  for (const step of path.slice(1)) {  // izpusti startno polje (kamp)
    const tile = tiles.find(t => t.q === step.q && t.r === step.r);
    if (!tile) continue;
    const pTile = tileEncounterProbability(tile, assigned, aiKnowledge, aiScouts);
    pNo *= (1 - pTile);
  }
  return 1 - pNo;
}

/** Mesecev potrebnih za izvedbo poti (one-way). */
export function pathMonths(path: Array<{ q: number; r: number }>): number {
  const steps = Math.max(0, path.length - 1);  // brez kampa
  return Math.ceil(steps / TILES_PER_MONTH);
}

// Verjetnosti najdb na neraziskanem polju
export const FIND_MATERIAL_CHANCE = 0.12;  // mala možnost — 12 %
export const FIND_WEAPON_CHANCE   = 0.025; // zelo redko — 2.5 %
export const FIND_ARTIFACT_CHANCE = 0.005; // minimalna — 0.5 %

export interface ExpeditionFinds { material: number; weapons: number; artifacts: number; }

/** Premakni eno odpravo za en mesec. Vrne posodobljeno + nova stanja heksov + RNG. */
export function tickExpedition(
  exp: Expedition,
  tiles: HexTile[],
  aiKnowledge: number,
  rng: RNGState,
  aiScouts: number = ENCOUNTER_SCOUT_REFERENCE,
): { exp: Expedition; tiles: HexTile[]; rng: RNGState; populationDelta: number; events: string[]; finds: ExpeditionFinds } {
  if (exp.status !== 'traveling') return { exp, tiles, rng, populationDelta: 0, events: [], finds: { material: 0, weapons: 0, artifacts: 0 } };

  let newTiles = [...tiles];
  let popLoss = 0;
  let lostAll = false;
  const events: string[] = [];
  const finds: ExpeditionFinds = { material: 0, weapons: 0, artifacts: 0 };
  let curIdx = exp.currentIndex;
  let assignedNow = exp.assigned;
  // Način skrivanja: napredujemo 2× v 3 mesecih (trajanje +50 %). Preskočimo vsak 3. mesec.
  const stealth = !!exp.stealth;
  const skipThisMonth = stealth && (exp.monthsElapsed % 3 === 2);

  for (let stepsThisMonth = 0; stepsThisMonth < TILES_PER_MONTH; stepsThisMonth++) {
    if (skipThisMonth) {
      events.push(`🌙 Skrivanje — počitek/obhod (mesec preskočen).`);
      break;
    }
    if (curIdx >= exp.path.length - 1) break;
    const nextStep = exp.path[curIdx + 1];
    const tIdx = newTiles.findIndex(t => t.q === nextStep.q && t.r === nextStep.r);
    if (tIdx < 0) break;
    const tile = newTiles[tIdx];
    const wasUnresearched = tile.researchProgress < 1;

    curIdx++;

    const addProg = researchPerVisit(assignedNow);
    const newProg = Math.min(1, tile.researchProgress + addProg);
    newTiles[tIdx] = { ...tile, researchProgress: newProg, visibility: visibilityFromProgress(newProg) };

    // Srečanje — skrivanje razpolovi verjetnost
    const pEncBase = tileEncounterProbability(newTiles[tIdx], assignedNow, aiKnowledge, aiScouts);
    const pEnc = stealth ? pEncBase * 0.5 : pEncBase;
    const [encRoll, rng2] = rngNext(rng); rng = rng2;
    if (encRoll < pEnc) {
      const [pctRoll, rng3] = rngInt(rng, SCOUT_CAPTURED_LOSS_MIN * 100, SCOUT_CAPTURED_LOSS_MAX * 100);
      rng = rng3;
      const lost = Math.max(1, Math.floor(assignedNow * pctRoll / 100));
      assignedNow = Math.max(0, assignedNow - lost);
      popLoss += lost;
      events.push(`Srečanje na (${tile.q},${tile.r}): ${lost} izgub`);
      if (assignedNow < 1) {
        lostAll = true;
        break;
      }
    }

    // Najdbe — samo na poljih, ki še niso bila popolnoma raziskana
    if (wasUnresearched) {
      const [findRoll, rngF] = rngNext(rng); rng = rngF;
      // Sestavi prag po prioriteti: prva najdba ki preseže prag
      if (findRoll < FIND_ARTIFACT_CHANCE) {
        finds.artifacts += 1;
        events.push(`💎 Artefakt najden na (${tile.q},${tile.r})!`);
      } else if (findRoll < FIND_ARTIFACT_CHANCE + FIND_WEAPON_CHANCE) {
        const [w, rngW] = rngInt(rng, 1, 3); rng = rngW;
        finds.weapons += w;
        events.push(`⚔ ${w} orožja najdenega na (${tile.q},${tile.r}).`);
      } else if (findRoll < FIND_ARTIFACT_CHANCE + FIND_WEAPON_CHANCE + FIND_MATERIAL_CHANCE) {
        const [m, rngM] = rngInt(rng, 1, 4); rng = rngM;
        finds.material += m;
        events.push(`⚙ ${m} materiala najdenega na (${tile.q},${tile.r}).`);
      }
    }
  }

  let newStatus: Expedition['status'] = exp.status;
  if (lostAll) newStatus = 'lost';
  else if (curIdx >= exp.path.length - 1) newStatus = 'completed';

  return {
    exp: {
      ...exp,
      currentIndex: curIdx,
      assigned: assignedNow,
      monthsElapsed: exp.monthsElapsed + 1,
      status: newStatus,
      encountersLog: [...exp.encountersLog, ...events],
    },
    tiles: newTiles,
    rng,
    populationDelta: -popLoss,
    events,
    finds,
  };
}
