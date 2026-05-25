// Heksagonalna mapa — pointy-top axial coords (q, r)
// Klan v levem dol kotu, AI jedro v desnem zgornjem.
// Šibke točke razporejene proporcionalno k oddaljenosti.

import type { HexTile, Visibility } from './types.js';
import { tileId } from './types.js';
import { INTEL_TO_PARTIAL, INTEL_TO_REVEALED } from './constants.js';

export const MAP_COLS = 6;  // q ∈ [0, MAP_COLS-1]
export const MAP_ROWS = 5;  // r ∈ [0, MAP_ROWS-1]

const CLAN_POS  = { q: 0, r: MAP_ROWS - 1 };
const CORE_POS  = { q: MAP_COLS - 1, r: 0 };

// Axial razdalja med dvema heksima
export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const aq = a.q, ar = a.r, as_ = -aq - ar;
  const bq = b.q, br = b.r, bs_ = -bq - br;
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(as_ - bs_)) / 2;
}

export function neighbors(t: { q: number; r: number }): Array<{ q: number; r: number }> {
  // Pointy-top axial sosedje
  const dirs = [
    { q: +1, r:  0 }, { q: +1, r: -1 }, { q:  0, r: -1 },
    { q: -1, r:  0 }, { q: -1, r: +1 }, { q:  0, r: +1 },
  ];
  return dirs.map(d => ({ q: t.q + d.q, r: t.r + d.r }));
}

function inBounds(q: number, r: number): boolean {
  return q >= 0 && q < MAP_COLS && r >= 0 && r < MAP_ROWS;
}

/** Generiraj heks mapo. Klan = revealed, sosednji = partial, ostali = unknown. */
export function generateMap(): HexTile[] {
  const maxDist = hexDistance(CLAN_POS, CORE_POS);

  // Razporedi šibke točke po oddaljenosti od jedra (informativno):
  // wp_power blizu klana (faza 1), wp_comm srednje, wp_core blizu jedra (faza 3)
  const wpAssign: Record<string, { q: number; r: number }> = {
    wp_power: { q: 2, r: 3 },          // bližje klanu
    wp_comm:  { q: 3, r: 2 },          // sredina mape
    wp_core:  { q: 4, r: 1 },          // bližje AI jedru
  };

  const tiles: HexTile[] = [];
  const clanNeighbors = new Set(neighbors(CLAN_POS).map(n => tileId(n)));

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLS; q++) {
      const dist = hexDistance({ q, r }, CORE_POS);
      const fogDensity = Math.max(0, Math.min(1, dist === maxDist ? 0 : 1 - dist / maxDist));
      // Note: fogDensity = high near core, low near clan. Definicija: 1 - dist/max ko je v jedru = 1, klan = 0.
      // Popravim: pri klanu (dist=maxDist) → fog=0; pri jedru (dist=0) → fog=1.
      const fog = 1 - dist / maxDist;

      const isClan = q === CLAN_POS.q && r === CLAN_POS.r;
      const isCore = q === CORE_POS.q && r === CORE_POS.r;

      let visibility: Visibility = 'unknown';
      if (isClan) visibility = 'revealed';
      else if (clanNeighbors.has(`${q},${r}`)) visibility = 'partial';

      let hidesWeakPointId: string | undefined;
      for (const [wpId, pos] of Object.entries(wpAssign)) {
        if (pos.q === q && pos.r === r) { hidesWeakPointId = wpId; break; }
      }

      tiles.push({
        q, r,
        visibility,
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

// ─── Razkrivanje heksov z izvidniki ───────────────────────────────────────
// Strošek razkritja heksa odvisen od fogDensity in trenutne visibility.
// unknown → partial: base 25 × (1 + 1.5 × fog)
// partial → revealed: base 60 × (1 + 1.5 × fog)
export function tileRevealCost(tile: HexTile, to: 'partial' | 'revealed'): number {
  const base = to === 'partial' ? 25 : 60;
  return Math.round(base * (1 + 1.5 * tile.fogDensity));
}

/** Aplikira budget izvidniške moči na izbrane targetTileIds — vrne nova vozlišča in razkrite ID-je. */
export function spendScoutsOnMap(
  tiles: HexTile[],
  targetIds: string[],
  budget: number,
): { tiles: HexTile[]; revealed: string[]; budgetUsed: number } {
  let remaining = budget;
  const out = [...tiles];
  const revealed: string[] = [];

  // Sortiraj po fogDensity — najprej najlažji
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
    out[idx] = { ...t, visibility: target };
    revealed.push(id);
  }

  return { tiles: out, revealed, budgetUsed: budget - remaining };
}
