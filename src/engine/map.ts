// Heksagonalna mapa — pointy-top axial coords (q, r)
// researchProgress (0–1) je kontinuirano stanje. Vidnost je izpeljana:
//   < 0.25 → unknown   (red)
//   < 0.50 → unknown   (still red, but lighter)
//   < 1.00 → partial   (gray, raziskan)
//   = 1.00 → revealed  (blue, domač)

import type { HexTile, Visibility, OtherClan } from './types.js';
import { tileId } from './types.js';
import { rngInt, createRNG } from './rng.js';
import type { RNGState } from './rng.js';

export const MAP_COLS = 6;
export const MAP_ROWS = 5;

const CLAN_POS = { q: 0, r: MAP_ROWS - 1 };
const CORE_POS = { q: MAP_COLS - 1, r: 0 };

/** Fisher-Yates shuffle s seedanim RNG. */
function shufflePositions(arr: Array<{q:number,r:number}>, rng: RNGState): [Array<{q:number,r:number}>, RNGState] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    let idx: number;
    [idx, rng] = rngInt(rng, 0, i + 1);
    [a[i], a[idx]] = [a[idx], a[i]];
  }
  return [a, rng];
}

/** Generiraj naključne pozicije za šibke točke in klane (en klic na novo igro). */
export function randomizePlacements(rngSeed: number): {
  wpPositions: Record<string, {q:number, r:number}>;
  clanDefs: OtherClan[];
} {
  // Vsi veljavni heksi razen kampa, AI jedra in neposrednih sosedov kampa
  const candidates: Array<{q:number,r:number}> = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let q = 0; q < MAP_COLS; q++) {
      if (q === CLAN_POS.q && r === CLAN_POS.r) continue;  // kamp
      if (q === CORE_POS.q && r === CORE_POS.r) continue;  // AI jedro
      if (hexDistance({q,r}, CLAN_POS) < 2) continue;       // preblizu kampa
      candidates.push({q, r});
    }
  }

  let rng = createRNG(rngSeed);
  let shuffled: Array<{q:number,r:number}>;
  [shuffled, rng] = shufflePositions(candidates, rng);

  // Prvih 3 = šibke točke, naslednjih 3 = klani
  const [wp0, wp1, wp2, cl0, cl1, cl2] = shuffled;

  const wpPositions: Record<string, {q:number,r:number}> = {
    wp_power: wp0,
    wp_comm:  wp1,
    wp_core:  wp2,
  };

  const clanDefs: OtherClan[] = [
    { id: 'clan_north', label: 'Severni klan',  q: cl0.q, r: cl0.r, discovered: false, allied: false, specialty: 'people' },
    { id: 'clan_east',  label: 'Vzhodni klan',  q: cl1.q, r: cl1.r, discovered: false, allied: false, specialty: 'material' },
    { id: 'clan_mid',   label: 'Dolinski klan', q: cl2.q, r: cl2.r, discovered: false, allied: false, specialty: 'food' },
  ];

  return { wpPositions, clanDefs };
}

/** Sveže kopije klanov — za backward compat (brez randomizacije). */
export function generateOtherClans(): OtherClan[] {
  return [
    { id: 'clan_north', label: 'Severni klan',  q: 1, r: 0, discovered: false, allied: false, specialty: 'people' },
    { id: 'clan_east',  label: 'Vzhodni klan',  q: 4, r: 3, discovered: false, allied: false, specialty: 'material' },
    { id: 'clan_mid',   label: 'Dolinski klan', q: 2, r: 1, discovered: false, allied: false, specialty: 'food' },
  ];
}

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

/** Generiraj heks mapo. Sprejme pozicije šibkih točk in klanov (ali uporabi privzete fiksne). */
export function generateMap(
  wpPositions?: Record<string, {q:number,r:number}>,
  clanDefs?: OtherClan[],
): HexTile[] {
  const maxDist = hexDistance(CLAN_POS, CORE_POS);

  const wpAssign: Record<string, { q: number; r: number }> = wpPositions ?? {
    wp_power: { q: 2, r: 3 },
    wp_comm:  { q: 3, r: 2 },
    wp_core:  { q: 4, r: 1 },
  };

  const clansToUse = clanDefs ?? generateOtherClans();
  const clanTileMap: Record<string, string> = {};
  for (const c of clansToUse) clanTileMap[`${c.q},${c.r}`] = c.id;

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
        otherClanId: clanTileMap[`${q},${r}`],
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
