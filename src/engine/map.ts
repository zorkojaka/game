// Heksagonalna mapa — pointy-top axial coords (q, r)
// researchProgress (0–1) je kontinuirano stanje. Vidnost je izpeljana:
//   < 0.25 → unknown   (red)
//   < 0.50 → unknown   (still red, but lighter)
//   < 1.00 → partial   (gray, raziskan)
//   = 1.00 → revealed  (blue, domač)

import type { HexTile, Visibility } from './types.js';
import { tileId } from './types.js';

export const MAP_COLS = 6;
export const MAP_ROWS = 5;

const CLAN_POS = { q: 0, r: MAP_ROWS - 1 };
const CORE_POS = { q: MAP_COLS - 1, r: 0 };

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const aq = a.q, ar = a.r, as_ = -aq - ar;
  const bq = b.q, br = b.r, bs_ = -bq - br;
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(as_ - bs_)) / 2;
}

export function neighbors(t: { q: number; r: number }): Array<{ q: number; r: number }> {
  const dirs = [
    { q: +1, r:  0 }, { q: +1, r: -1 }, { q:  0, r: -1 },
    { q: -1, r:  0 }, { q: -1, r: +1 }, { q:  0, r: +1 },
  ];
  return dirs.map(d => ({ q: t.q + d.q, r: t.r + d.r }));
}

/** Vidnost izpeljana iz researchProgress. */
export function visibilityFromProgress(p: number): Visibility {
  if (p < 0.50) return 'unknown';
  if (p < 1.00) return 'partial';
  return 'revealed';
}

/** Generiraj heks mapo. Klan: progress=1. Sosednji klanu: progress=0.40 (delno znano). Ostali: 0. */
export function generateMap(): HexTile[] {
  const maxDist = hexDistance(CLAN_POS, CORE_POS);

  const wpAssign: Record<string, { q: number; r: number }> = {
    wp_power: { q: 2, r: 3 },
    wp_comm:  { q: 3, r: 2 },
    wp_core:  { q: 4, r: 1 },
  };

  const tiles: HexTile[] = [];
  const clanNeighbors = new Set(neighbors(CLAN_POS).map(n => tileId(n)));

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLS; q++) {
      const dist = hexDistance({ q, r }, CORE_POS);
      const fog = 1 - dist / maxDist;

      const isClan = q === CLAN_POS.q && r === CLAN_POS.r;
      const isCore = q === CORE_POS.q && r === CORE_POS.r;

      let progress = 0;
      if (isClan) progress = 1.0;
      else if (clanNeighbors.has(`${q},${r}`)) progress = 0.40;

      let hidesWeakPointId: string | undefined;
      for (const [wpId, pos] of Object.entries(wpAssign)) {
        if (pos.q === q && pos.r === r) { hidesWeakPointId = wpId; break; }
      }

      tiles.push({
        q, r,
        researchProgress: progress,
        visibility: visibilityFromProgress(progress),
        fogDensity: Math.max(0, Math.min(1, fog)),
        distanceToCore: dist,
        isClanCamp: isClan,
        isAICore:   isCore,
        hidesWeakPointId,
      });
    }
  }
  return tiles;
}

// ─── Modulacija srečanja po raziskanosti ───────────────────────────────────
/** Multiplikator verjetnosti srečanja AI glede na researchProgress. */
export function tileEncounterMultiplier(progress: number, distanceFromCamp: number): number {
  // Manj kot je raziskano, večja verjetnost srečanja
  let mult: number;
  if (progress < 0.25) mult = 1.5;        // rdeč: zelo nevarno
  else if (progress < 0.50) mult = 1.2;   // svetlo rdeč
  else if (progress < 1.0)  mult = 0.7;   // siv/moder: znani teren
  else mult = 0.3;                         // popolnoma domač
  // Blizu kampa: dodaten faktor varnega zaledja
  if (distanceFromCamp <= 1) mult *= 0.5;
  else if (distanceFromCamp <= 2) mult *= 0.8;
  return mult;
}

// ─── Razkrivanje skozi obisk ─────────────────────────────────────────────
/** Koliko researchProgress doda en obisk z N izvidniki. */
export function researchPerVisit(assigned: number): number {
  // Bazno 0.30 + 0.025 na osebo, cap 0.55. Z 5 osebami: 0.42. Z 15: 0.55.
  return Math.min(0.55, 0.30 + 0.025 * assigned);
}

// ─── Stare funkcije (backward compat) ────────────────────────────────────
// Stari spendIntelOnFog/spendScoutsOnMap se zdaj uporabljajo le, če newExpeditions ni podan.
export function tileRevealCost(tile: HexTile, to: 'partial' | 'revealed'): number {
  const base = to === 'partial' ? 25 : 60;
  return Math.round(base * (1 + 1.5 * tile.fogDensity));
}

export function spendScoutsOnMap(
  tiles: HexTile[],
  targetIds: string[],
  budget: number,
): { tiles: HexTile[]; revealed: string[]; budgetUsed: number } {
  let remaining = budget;
  const out = [...tiles];
  const revealed: string[] = [];

  const order = [...targetIds].sort((a, b) => {
    const ta = out.find(t => tileId(t) === a);
    const tb = out.find(t => tileId(t) === b);
    return (ta?.fogDensity ?? 1) - (tb?.fogDensity ?? 1);
  });

  for (const id of order) {
    if (remaining <= 0) break;
    const idx = out.findIndex(t => tileId(t) === id);
    if (idx < 0) continue;
    const t = out[idx];
    if (t.visibility === 'revealed') continue;
    const target: 'partial' | 'revealed' = t.visibility === 'unknown' ? 'partial' : 'revealed';
    const cost = tileRevealCost(t, target);
    if (remaining < cost) continue;
    remaining -= cost;
    const newProgress = target === 'partial' ? 0.50 : 1.0;
    out[idx] = { ...t, visibility: target, researchProgress: Math.max(t.researchProgress, newProgress) };
    revealed.push(id);
  }

  return { tiles: out, revealed, budgetUsed: budget - remaining };
}
