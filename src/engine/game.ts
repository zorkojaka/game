// Glavni game engine — čiste funkcije (state, action) → new state
// Brez side effectov, brez IO

import type { GameState, PlayerAction, RoundLog, Assignment, AIPhase, RaidResult, ScoutResult, HumanAxis, Mission, AIUnits, AIWeakPoint, AIAction, ResearchObjective, CampArea } from './types.js';
import type { RNGState } from './rng.js';
import { rngInt, rngNext, seedFromString } from './rng.js';
import { resolveCombat } from './combat.js';
import { revealTreeByInsight, revealNodeRetroactive } from './fog.js';
import { generateMap, generateOtherClans, randomizePlacements, isCampHex } from './map.js';
import { tickExpedition, pathMonths, returnMonths, pathFoodMonths, returnFoodMonths, pathToCamp } from './expedition.js';
import { difficultyProfile, weaponEffectMult, type DifficultyId } from './difficulty.js';
import type { Expedition } from './types.js';
import { hexLabel } from './types.js';
import { calcAISurveillanceGain, generateAITree, generateAIWeakPoints, DEFAULT_GENOME } from './ai-brain.js';
import {
  INITIAL_POPULATION, INITIAL_SURVIVAL, INITIAL_COMBAT, INITIAL_INTELLIGENCE, INITIAL_MATERIAL,
  INITIAL_AI_KNOWLEDGE,
  AI_KNOWLEDGE_EXPOSE_HIDDEN,
  MIN_CLAN_AT_PHASE_END,
  AI_ENERGY_CORE_WEAKPOINT, AI_ENERGY_START, AI_ENERGY_CORE_DESTROYED_MULT,
  AI_ENERGY_PER_LEVEL, AI_UNIT_ENERGY_COST, AI_ENERGY_LEVEL_COST, AI_ENERGY_LEVEL_MAX,
  SEARCH_KNOWLEDGE_PER_ROBOT, PATROL_ENCOUNTER_MAX_MULT,
  AI_TEAM_ROBOTS, PATROL_ENCOUNTER_PER_TEAM, AI_TEAM_WIPE_REF,
  AI_LAB_LEVEL_COST, AI_LAB_LEVEL_MAX, aiLabMult, AI_LAB_WEAKPOINT, AI_COMMAND_WEAKPOINT, AI_COMMAND_DISRUPTED_MULT,
  AI_SCOUTS_INITIAL, AI_ATTACKERS_PHASE2, AI_PEOPLEKILLERS_PHASE3, PEOPLEKILLER_LETHALITY_PER_UNIT,
  AI_UNIT_DEFS, aiAttackPower, aiDefensePower,
  ROUNDS_PER_PHASE, SURVIVAL_PER_PERSON_PER_ROUND, FORAGER_YIELD,
  SCOUT_INTEL_YIELD,
  RATIONS_LEVELS, DEFAULT_RATIONS,
  WEAPON_WORKER_MONTHS, WALL_WORKER_MONTHS, ARTIFACT_WORKER_MONTHS,
  WEAPON_MATERIAL_COST, WALL_MATERIAL_COST, ARTIFACT_MATERIAL_COST,
  RESEARCH_LEVEL_WORKER_MONTHS, researchMult,
  INITIAL_AI_INSIGHT, AI_INSIGHT_PER_RESEARCHER, NON_ROBOT_RESEARCH_INSIGHT_FACTOR, INSIGHT_PHASE_CAP,
  LOGICAL_WEAKNESS_RAID_DEFENSE_BONUS, LOGICAL_WEAKNESS_ENCOUNTER_REDUCTION, LOGICAL_WEAKNESS_LETHALITY_REDUCTION,
  RAID_AI_FORCE_PCT, DEFENDER_EQUIPMENT_MULT, wpGarrisonUnits,
  RAID_COUNT_BY_PHASE, ASSAULT_RAIDS_PER_YEAR,
  RAID_BREACH_AREAS, RAID_FRONT_LOSS_MULT, RAID_AREA_LOSS_MULT, RAID_AREA_LOSS_ANNIHILATION,
  RAID_DESTROY_FOOD_PCT, RAID_DESTROY_WEAPONS_PCT, RAID_DESTROY_MATERIAL_PCT, RAID_DESTROY_WALL_LEVELS,
  SCOUT_BASE_SUCCESS, SCOUT_INTEL_BONUS_PER_100, SCOUT_ESPIONAGE_BONUS,
  SCOUT_CAPTURE_BASE, SCOUT_CAPTURE_PER_SCOUT, SCOUT_AI_KNOWLEDGE_BONUS,
  COMBAT_BASE_HUMAN_MULTIPLIER,
  STARVATION_LOSS_PCT_1ST, STARVATION_LOSS_PCT_2ND, STARVATION_LOSS_PCT_NTH,
  INTEL_COMBAT_BONUS_PER_100, INTEL_COMBAT_BONUS_MAX,
  WEAPON_DESTROY_MIN_PCT, WEAPON_DESTROY_MAX_PCT,
  MISSION_DURATION_MONTHS, MISSION_ENCOUNTER_BASE, MISSION_ENCOUNTER_PER_PERSON,
  MISSION_ENCOUNTER_AI_KNOW, MISSION_WP_DIFFICULTY, MISSION_MIN_TEAM,
} from './constants.js';
import { calcHumanStrength, calcAIStrength, calcSuccessProbability, rollOutcome, tacticalRoll, logicalWeaknessBonus, logicalWeaknessByRobot } from './combat.js';

// ─── Pomožne funkcije za nove mehanike ───────────────────────────────────────

/** Intel bonus na vse boje (od 0 do INTEL_COMBAT_BONUS_MAX). */
export function intelCombatBonus(state: GameState): number {
  return Math.min(INTEL_COMBAT_BONUS_MAX, INTEL_COMBAT_BONUS_PER_100 * (state.resources.intelligence / 100));
}

/** Kapaciteta orožja — največ ljudi, ki se lahko bojujejo (napad + obramba) */
export function weaponCap(state: GameState): number {
  return Math.floor(state.resources.combat);
}

/** Os je zdaj določena iz Človekovega drevesa — uporabimo dominantno odločitev */
export function currentAxis(state: GameState): HumanAxis {
  const h = state.axisHistory ?? { obzidje: 0, orozje: 0, roboti: 0 };
  // Os, v katero smo največ vlagali, je trenutna "preferenca"
  const max = Math.max(h.obzidje ?? 0, h.orozje ?? 0, h.roboti ?? 0);
  if ((h.obzidje ?? 0) === max) return 'obzidje';
  if ((h.orozje ?? 0) === max) return 'orozje';
  return 'roboti';
}

function researchedAIUnitLabel(level: number): string {
  if (level <= 1) return 'izvidniških enot';
  if (level === 2) return 'napadalnih enot';
  return 'people-killer enot';
}

/** Vsota vseh AI enot = skupno robotov. */
export function totalAIRobots(u: AIUnits): number {
  return (u?.scouts ?? 0) + (u?.attackers ?? 0) + (u?.peopleKillers ?? 0);
}

/** Normaliziraj aiUnits iz stanja (migracija starih iger: vse v scouts). */
export function readAIUnits(state: GameState): AIUnits {
  if (state.aiUnits) return {
    scouts: state.aiUnits.scouts ?? 0,
    attackers: state.aiUnits.attackers ?? 0,
    peopleKillers: state.aiUnits.peopleKillers ?? 0,
  };
  return { scouts: state.aiRobots ?? 0, attackers: 0, peopleKillers: 0 };
}

const ROBOT_TECH_LEVEL: Record<keyof AIUnits, number> = {
  scouts: 1,
  attackers: 2,
  peopleKillers: 3,
};

/** Najvišja odklenjena tech stopnja iz razkritih MEHANSKIH šibkosti AI drevesa. */
export function mechanicalTechUnlockLevel(state: Pick<GameState, 'aiTree'>): number {
  let level = 0;
  for (const n of state.aiTree ?? []) {
    if (n.role !== 'mechanical' || n.visibility !== 'revealed') continue;
    level = Math.max(level, ROBOT_TECH_LEVEL[n.robot] ?? 0);
  }
  return level;
}

/** AI raid moč po pasivnih logičnih bonusih igralca. */
export function effectiveRaidAttackPower(state: GameState): number {
  const units = readAIUnits(state);
  const logical = logicalWeaknessByRobot(state);
  const reduce = (robot: keyof AIUnits) => Math.max(0, 1 - (logical[robot] ? LOGICAL_WEAKNESS_RAID_DEFENSE_BONUS : 0));
  const raw = units.scouts * AI_UNIT_DEFS.scouts.attack * reduce('scouts')
    + units.attackers * AI_UNIT_DEFS.attackers.attack * reduce('attackers')
    + units.peopleKillers * AI_UNIT_DEFS.peopleKillers.attack * reduce('peopleKillers');
  // Laboratorij (wp_comm uničen → nadgradnje napada odpadejo) × Poveljstvo (wp_core uničen → oslabljen napad)
  const wp = (id: string) => !!state.aiWeakPoints?.find(w => w.id === id && w.exploited);
  const labMult = wp(AI_LAB_WEAKPOINT) ? 1 : aiLabMult(state.aiAttackLevel ?? 0);
  const cmdMult = wp(AI_COMMAND_WEAKPOINT) ? AI_COMMAND_DISRUPTED_MULT : 1;
  return raw * labMult * cmdMult;
}

/**
 * Uniči `count` robotov, porazdeljeno po tipih enot, uteženo z 1/hp
 * (šibkejše enote — nižji hp — padejo prej; people-killerji preživijo dlje).
 */
export function destroyAIUnits(units: AIUnits, count: number): AIUnits {
  const total = totalAIRobots(units);
  if (count <= 0 || total <= 0) return { ...units };
  const c = Math.min(count, total);
  const w = {
    scouts: units.scouts / AI_UNIT_DEFS.scouts.hp,
    attackers: units.attackers / AI_UNIT_DEFS.attackers.hp,
    peopleKillers: units.peopleKillers / AI_UNIT_DEFS.peopleKillers.hp,
  };
  const wSum = w.scouts + w.attackers + w.peopleKillers;
  const res: AIUnits = { ...units };
  let removed = 0;
  if (wSum > 0) {
    const dS = Math.min(units.scouts, Math.floor(c * w.scouts / wSum));
    const dA = Math.min(units.attackers, Math.floor(c * w.attackers / wSum));
    const dK = Math.min(units.peopleKillers, Math.floor(c * w.peopleKillers / wSum));
    res.scouts -= dS; res.attackers -= dA; res.peopleKillers -= dK;
    removed = dS + dA + dK;
  }
  let remainder = c - removed;
  const order: (keyof AIUnits)[] = ['scouts', 'attackers', 'peopleKillers']; // ostanek: najprej najšibkejši
  for (const k of order) { if (remainder <= 0) break; const take = Math.min(res[k], remainder); res[k] -= take; remainder -= take; }
  return res;
}

/** Je energijsko jedro (šibka točka wp_power) uničeno? */
export function aiCoreDestroyed(state: { aiWeakPoints: AIWeakPoint[] }): boolean {
  return !!state.aiWeakPoints.find(w => w.id === AI_ENERGY_CORE_WEAKPOINT && w.exploited);
}

/** Pritok energije AI na mesec (iz jedra; uničeno jedro → strmo pade; +nadgradnja). */
export function aiEnergyInflow(state: GameState): number {
  const lvl = state.aiEnergyLevel ?? 0;
  const coreMult = aiCoreDestroyed(state) ? AI_ENERGY_CORE_DESTROYED_MULT : 1;
  return difficultyProfile(state.difficulty).aiEnergyInflow * coreMult * (1 + lvl * AI_ENERGY_PER_LEVEL);
}

/** Ciljna velikost vojske za dani mesec (enote, ki so do zdaj prispele). */
export function aiTargetArmy(state: GameState, totalRounds: number): AIUnits {
  const p = difficultyProfile(state.difficulty);
  return {
    scouts: p.aiScouts,
    attackers: totalRounds > 12 ? p.aiAttackers : 0,
    peopleKillers: totalRounds > 24 ? p.aiPeopleKillers : 0,
  };
}

/** AI ob PREHODU FAZE izbere SESTAVO pošiljke iz danega proračuna (energija).
 *  v1 skripta: kupi signaturno enoto faze (reproducira sedanji lok). Kasneje:
 *  genom iz self-improvement loopa → človeški drugi igralec (2-player). */
export function aiChoosePhaseShipment(phase: AIPhase, budgetEnergy: number): AIUnits {
  const add: AIUnits = { scouts: 0, attackers: 0, peopleKillers: 0 };
  if (phase === 'understand') add.attackers = Math.floor(budgetEnergy / AI_UNIT_ENERGY_COST.attackers);
  else if (phase === 'eliminate') add.peopleKillers = Math.floor(budgetEnergy / AI_UNIT_ENERGY_COST.peopleKillers);
  return add;
}

/** POLITIKA AI: iz danega stanja izpelje odločitve (akcijski prostor). Skripta —
 *  kasneje genom / igralec 2. Nadgrajuje obstoječe: privzeto ohrani balans,
 *  prva aktivna nova odločitev je vlaganje presežka energije v nivo. */
export function decideAIAction(state: GameState): AIAction {
  const units = readAIUnits(state);
  const total = Math.max(1, totalAIRobots(units));
  const target = aiTargetArmy(state, state.totalRounds + 1);
  const energy = state.aiEnergy ?? 0;
  const level = state.aiEnergyLevel ?? 0;
  // Produkcija: nadomesti primanjkljaj do cilja (drage enote prej), znotraj energije.
  const built = aiReinforce(units, energy, target);
  const production: AIUnits = {
    scouts: built.units.scouts - units.scouts,
    attackers: built.units.attackers - units.attackers,
    peopleKillers: built.units.peopleKillers - units.peopleKillers,
  };
  // Nadgradnja: vloži presežek (po nadomeščanju) v dvig pritoka, če ostane dovolj.
  const upgrade = level < AI_ENERGY_LEVEL_MAX && built.energy >= AI_ENERGY_LEVEL_COST;
  // Razporeditev robotov po vlogah. Patrulja/iskanje nežno naraščata po fazah
  // (zgodaj pusti igralcu prostor, pozneje aktivno lovi in išče kamp).
  const ph = state.totalRounds > 36 ? 'assault' : state.phase;
  const patrol = ph === 'find' ? 0 : ph === 'understand' ? 0.08 : ph === 'eliminate' ? 0.12 : 0.16;
  const search = ph === 'find' ? 0 : ph === 'understand' ? 0.05 : ph === 'eliminate' ? 0.10 : 0.14;
  const garrison = wpGarrisonUnits(units) / total;
  const raid = RAID_AI_FORCE_PCT;
  const roles = { raid, garrison, patrol, search };
  // Laboratorij: zgodaj brani (ščiti šibke točke), pozneje krepi napad.
  // Če je Laboratorij (wp_comm) uničen, nadgradenj ni.
  const labDead = !!state.aiWeakPoints?.find(w => w.id === AI_LAB_WEAKPOINT && w.exploited);
  const labTarget: 'attack' | 'defense' | null = labDead ? null : (ph === 'find' || ph === 'understand') ? 'defense' : 'attack';
  // Fokus obrambe: odkrita, neuničena točka, ki je igralcu najlažja (najverjetnejši cilj).
  const focus = (state.aiWeakPoints ?? [])
    .filter(w => w.discovered && !w.exploited)
    .sort((a, b) => (MISSION_WP_DIFFICULTY[a.id] ?? 100) - (MISSION_WP_DIFFICULTY[b.id] ?? 100))[0]?.id;
  return { production, upgrade, raidForcePct: raid, roles, focusWeakPoint: focus, labTarget, teamSize: 2 };
}

/** Zgradi TOČNO želene enote (2-player: izbira igralca 2), omejeno z energijo. */
export function aiBuild(units: AIUnits, energy: number, want: AIUnits): { units: AIUnits; energy: number } {
  let e = energy;
  const out: AIUnits = { ...units };
  for (const tier of ['peopleKillers', 'attackers', 'scouts'] as (keyof AIUnits)[]) {
    const cost = AI_UNIT_ENERGY_COST[tier as 'scouts' | 'attackers' | 'peopleKillers'];
    const n = Math.min(Math.max(0, Math.floor(want[tier] ?? 0)), Math.floor(e / cost));
    out[tier] += n; e -= n * cost;
  }
  return { units: out, energy: e };
}

/** Porabi energijo za NADOMEŠČANJE izgub do ciljne vojske (drage enote prej). */
export function aiReinforce(units: AIUnits, energy: number, target: AIUnits): { units: AIUnits; energy: number } {
  let e = energy;
  const out: AIUnits = { ...units };
  for (const tier of ['peopleKillers', 'attackers', 'scouts'] as (keyof AIUnits)[]) {
    const cost = AI_UNIT_ENERGY_COST[tier as 'scouts' | 'attackers' | 'peopleKillers'];
    const deficit = Math.max(0, (target[tier] ?? 0) - (out[tier] ?? 0));
    if (deficit <= 0) continue;
    const build = Math.min(deficit, Math.floor(e / cost));
    out[tier] += build;
    e -= build * cost;
  }
  return { units: out, energy: e };
}

/** Obdobje raidov za dani mesec: meje + razpon števila napadov.
 *  Faze 1–3 (1–12, 13–24, 25–36), nato leta TOTALNEGA NAPADA (8–10/leto). */
export function raidPeriodFor(totalRounds: number): { start: number; end: number; range: [number, number]; assault: boolean } {
  if (totalRounds <= 12) return { start: 1,  end: 12, range: RAID_COUNT_BY_PHASE.find,       assault: false };
  if (totalRounds <= 24) return { start: 13, end: 24, range: RAID_COUNT_BY_PHASE.understand, assault: false };
  if (totalRounds <= 36) return { start: 25, end: 36, range: RAID_COUNT_BY_PHASE.eliminate,  assault: false };
  const start = 37 + Math.floor((totalRounds - 37) / 12) * 12;
  return { start, end: start + 11, range: ASSAULT_RAIDS_PER_YEAR, assault: true };
}

/** Verjetnost raida ta mesec — ZA PRIKAZ: preostali načrtovani napadi / preostali meseci obdobja.
 *  (Dejanski raidi so načrtovani vnaprej — glej raidPlan v processRound.) */
export function raidProbability(state: GameState): number {
  if (aiAttackPower(readAIUnits(state)) <= 0) return 0;
  const tr = state.totalRounds;
  const period = raidPeriodFor(tr);
  const plan = state.raidPlan;
  if (plan && tr >= plan.periodStart && tr <= plan.periodEnd) {
    const remaining = plan.months.filter(m => m >= tr).length;
    const monthsLeft = plan.periodEnd - tr + 1;
    return Math.max(0, Math.min(1, remaining / Math.max(1, monthsLeft)));
  }
  // Ocena pred generiranjem načrta: povprečno število napadov / dolžina obdobja
  const avg = (period.range[0] + period.range[1]) / 2;
  return Math.max(0, Math.min(1, avg / (period.end - period.start + 1)));
}

/** Verjetnost, da obramba odbije napad. Vsi branilci so v boju. */
export function raidRepelProbability(state: GameState, assignment: Assignment): number {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  if (defenders <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const intelB = intelCombatBonus(state);
  const weaponMult = weaponEffectMult(state.difficulty, state.weaponResearchLevel ?? 0);  // učinek orožja (po težavnosti)
  const wallMult = researchMult(state.wallResearchLevel ?? 0);      // raziskava obzidja ×2/level
  // vsak zid: +X % obrambne moči (X po težavnosti, × raziskava obzidja)
  const wallBonus = 1 + difficultyProfile(state.difficulty).wallDefensePct * wallMult * (state.wallsBuilt ?? 0);
  const base = defenders * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult;
  const equip = Math.min(state.resources.combat, defenders) * DEFENDER_EQUIPMENT_MULT * weaponMult;
  const defStr = (base + equip) * (1 + intelB) * wallBonus;
  // Raid izvaja vsa AI sila (vsi tipi enot napadajo) — moč po njihovem napadu
  const aiStr = effectiveRaidAttackPower(state) * RAID_AI_FORCE_PCT;
  return defStr / (defStr + Math.max(1, aiStr));
}

/** Verjetnost, da izvidniki vrnejo s polnim donosom. */
export function scoutSuccessProbability(state: GameState, assignment: Assignment): number {
  if ((assignment.scouts ?? 0) <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  let p = SCOUT_BASE_SUCCESS
    + SCOUT_INTEL_BONUS_PER_100 * (state.resources.intelligence / 100)
    + (tier.strengthMult - 1.0) * 0.5;
  return Math.max(0, Math.min(0.98, p));
}

/** Verjetnost, da AI ujame izvidnike. */
export function scoutCaptureProbability(state: GameState, assignment: Assignment): number {
  if ((assignment.scouts ?? 0) <= 0) return 0;
  let p = SCOUT_CAPTURE_BASE
    + SCOUT_CAPTURE_PER_SCOUT * (assignment.scouts ?? 0)
    + SCOUT_AI_KNOWLEDGE_BONUS * state.aiKnowledge;
  return Math.max(0, Math.min(0.80, p));
}

/** Pričakovana varnost za nabiralce. */
export function forageSafetyProbability(state: GameState, assignment: Assignment): number {
  const pRaid = raidProbability(state);
  const pRepel = raidRepelProbability(state, assignment);
  return Math.max(0, Math.min(1, 1 - pRaid * (1 - pRepel)));
}

// ─── Misije proti šibkim točkam ───────────────────────────────────────────

/** Verjetnost srečanja AI v misiji vsak mesec. */
export function missionEncounterProbability(state: GameState, assigned: number): number {
  const overflow = Math.max(0, assigned - 5);
  let p = MISSION_ENCOUNTER_BASE
    + MISSION_ENCOUNTER_PER_PERSON * overflow
    + MISSION_ENCOUNTER_AI_KNOW * state.aiKnowledge;
  return Math.max(0, Math.min(1, p));
}

/** Končna verjetnost uspeha misije — uporabi rations za moč ekipe. */
/** Efektivna straža šibke točke: bazna garnizija (po prisotnih AI enotah) − tam pobite enote. */
export function wpEffectiveGarrison(state: GameState, weakPointId: string): number {
  const wp = state.aiWeakPoints.find(w => w.id === weakPointId);
  const base = wpGarrisonUnits(readAIUnits(state));
  return Math.max(0, base - (wp?.garrisonLoss ?? 0));
}

export function missionSuccessProbability(state: GameState, weakPointId: string, assigned: number, rationsLevel: number = DEFAULT_RATIONS): number {
  if (assigned < MISSION_MIN_TEAM) return 0;
  // Garnizija: AI straži šibke točke — z novimi enotami (faza 2/3) je napad težji.
  // Vsak napad stražo oslabi (garrisonLoss) → naslednji napadi so LAŽJI.
  const diff = (MISSION_WP_DIFFICULTY[weakPointId] ?? 100) * (1 + wpEffectiveGarrison(state, weakPointId) / 20);
  const tier = RATIONS_LEVELS[rationsLevel] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const equip = Math.min(state.resources.combat, assigned);
  const wMult = weaponEffectMult(state.difficulty, state.weaponResearchLevel ?? 0);
  const teamPower = (Math.sqrt(assigned) * COMBAT_BASE_HUMAN_MULTIPLIER * 8 + equip * 1.2 * wMult) * tier.strengthMult;
  const intelB = intelCombatBonus(state);
  return (teamPower * (1 + intelB)) / (teamPower * (1 + intelB) + diff);
}

function expeditionDefeatLoss(survivors: number, fraction: number): number {
  if (survivors <= 0) return 0;
  return Math.max(1, Math.round(survivors * fraction));
}

/** Resolve raid — vsi branilci se borijo + uničenje neuporabljenega orožja. */
function resolveRaid(
  state: GameState, assignment: Assignment, rng: RNGState, campPopulation = state.population
): { result: RaidResult; rng: RNGState } {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  const p = raidRepelProbability(state, assignment);
  const { outcome, rng: rngRoll } = rollOutcome(p, rng);
  rng = rngRoll;
  const aiUnits = readAIUnits(state);
  // Število robotov, ki sodelujejo v raidu (za štetje uničenih) — vsi tipi
  const aiForce = Math.floor(totalAIRobots(aiUnits) * RAID_AI_FORCE_PCT);
  // People-killer enote (faza 3) povečajo smrtnost med ljudmi
  const logical = logicalWeaknessByRobot(state);
  const pkReduction = logical.peopleKillers ? LOGICAL_WEAKNESS_LETHALITY_REDUCTION : 0;
  const lethality = (1 + PEOPLEKILLER_LETHALITY_PER_UNIT * aiUnits.peopleKillers) * (1 - pkReduction);

  // Žrtve so ZVEZNE: skalirajo z MOČJO PREBOJA (premoč = 1 − p). Močnejša obramba
  // → manjši preboj → manj žrtev. DOMINACIJA ostane skrajna:
  //  'victory' (odločilna obramba) → uničeni VSI napadalni roboti, AI brez informacij;
  //  'annihilation' (AI dominacija) → padejo vsi branilci, AI odnese največ informacij.
  const breachPower = Math.max(0, Math.min(1, 1 - p));  // AI premoč ob preboju
  const destroyFrac: Record<typeof outcome, number> = { victory: 1.00, partial: 0.35, defeat: 0.12, annihilation: 0.03 };
  let defendersLost = outcome === 'annihilation'
    ? defenders
    : Math.floor(defenders * RAID_FRONT_LOSS_MULT[outcome] * breachPower * lethality);
  const aiRobotsDestroyed = Math.floor(aiForce * destroyFrac[outcome]);
  const domination: 'defense' | 'ai' | null =
    outcome === 'victory' ? 'defense' : outcome === 'annihilation' ? 'ai' : null;
  // Informacije, ki jih preživeli roboti odnesejo AI-ju (ob dominaciji obrambe = 0)
  const aiInfoGained = outcome === 'victory' ? 0 : outcome === 'partial' ? 0.05 : outcome === 'defeat' ? 0.10 : 0.15;

  // Uničenje orožja v skladišču (kar ni v rabi, ko napadejo)
  const weaponsInUse = defenders + assignment.combatants;
  const weaponsIdle  = Math.max(0, state.resources.combat - weaponsInUse);
  let weaponsDestroyed = 0;
  if (weaponsIdle > 0) {
    const [pctRoll, rng2] = rngInt(rng, WEAPON_DESTROY_MIN_PCT * 100, WEAPON_DESTROY_MAX_PCT * 100);
    rng = rng2;
    weaponsDestroyed = Math.floor(weaponsIdle * pctRoll / 100);
  }

  // Preboj obrambe → koliko območij kampa AI opustoši (naključno izbrana)
  const breachCount = RAID_BREACH_AREAS[outcome];
  const allAreas: CampArea[] = ['food', 'workshop', 'research', 'defense'];
  const scored = allAreas.map(a => { const [r, rn] = rngNext(rng); rng = rn; return { a, r }; });
  scored.sort((x, y) => x.r - y.r);
  const breachedAreas = scored.slice(0, breachCount).map(s => s.a);

  // Žrtve med ljudmi v prebitih območjih — zvezno z močjo preboja
  const peopleLossFrac =
    outcome === 'annihilation' ? RAID_AREA_LOSS_ANNIHILATION * lethality
    : (outcome === 'partial' || outcome === 'defeat')
      ? RAID_AREA_LOSS_MULT[outcome] * breachPower * lethality
      : 0;
  // Žrtve v coni so omejene s številom ljudi v TISTI coni (lethality je lahko > 1 v pozni igri).
  const forAssigned = assignment.foragers ?? 0;
  const wrkAssigned = assignment.workers ?? 0;
  const resAssigned = assignment.researchers ?? 0;
  const foragersLost    = breachedAreas.includes('food')     ? Math.min(forAssigned, Math.floor(forAssigned * peopleLossFrac)) : 0;
  const workersLost     = breachedAreas.includes('workshop') ? Math.min(wrkAssigned, Math.floor(wrkAssigned * peopleLossFrac)) : 0;
  const researchersLost = breachedAreas.includes('research') ? Math.min(resAssigned, Math.floor(resAssigned * peopleLossFrac)) : 0;
  const assignedInCamp = defenders + forAssigned + wrkAssigned + resAssigned;
  const hiddenAssigned = Math.max(0, campPopulation - assignedInCamp);
  const hiddenLost = state.aiKnowledge >= AI_KNOWLEDGE_EXPOSE_HIDDEN
    ? Math.min(hiddenAssigned, Math.floor(hiddenAssigned * peopleLossFrac))
    : 0;
  if (breachedAreas.includes('defense')) {
    defendersLost += Math.floor(defenders * peopleLossFrac);
  }
  defendersLost = Math.min(defenders, defendersLost);

  // Uničenje virov v prebitih območjih (na žive vrednosti se uporabi v processRound)
  return {
    result: {
      occurred: true, outcome,
      defendersLost, foragersLost, workersLost, researchersLost, hiddenLost,
      aiRobotsDestroyed, weaponsDestroyed,
      survivalDestroyed: 0, materialDestroyed: 0, wallsDestroyed: 0,
      breachedAreas,
      successProbability: p,
      aiInfoGained,
      domination,
    },
    rng,
  };
}

// ─── Inicializacija nove linije ───────────────────────────────────────────────

export function newGame(seed?: number, difficulty?: DifficultyId): GameState {
  const runId = Date.now().toString(36);
  const rngSeed = seed ?? seedFromString(runId);

  return {
    difficulty: difficultyProfile(difficulty).id,
    round: 1,
    phase: 'find',
    totalRounds: 1,
    population: difficultyProfile(difficulty).startPopulation,
    maxPopulation: difficultyProfile(difficulty).startPopulation,
    resources: {
      survival: difficultyProfile(difficulty).startFood,
      combat: difficultyProfile(difficulty).startWeapons,
      intelligence: INITIAL_INTELLIGENCE,
      material: INITIAL_MATERIAL,
      artifacts: 0,
    },
    aiPhaseProgress: 0,
    aiRobots: difficultyProfile(difficulty).aiScouts,
    aiUnits: { scouts: difficultyProfile(difficulty).aiScouts, attackers: 0, peopleKillers: 0 },
    aiKnowledge: INITIAL_AI_KNOWLEDGE,
    aiEnergy: AI_ENERGY_START,
    aiEnergyLevel: 0,
    aiAttackLevel: 0,
    aiDefenseLevel: 0,
    aiTree: generateAITree(),
    aiWeakPoints: generateAIWeakPoints(),
    clanActivity: 0,
    axisHistory: { obzidje: 0, orozje: 0, roboti: 0 },
    activeMissions: [],
    completedMissions: [],
    consecutiveStarvationMonths: 0,
    ...(() => {
      // Naključna postavitev šibkih točk in klanov (seed ločen od game RNG da ne vpliva na potek igre)
      const { wpPositions, clanDefs } = randomizePlacements(rngSeed ^ 0xdeadbeef);
      return { mapTiles: generateMap(wpPositions, clanDefs), otherClans: clanDefs };
    })(),
    expeditions: [],
    completedExpeditions: [],
    weaponWorkshopProgress: 0,
    weaponWorkshopScouts: 0,
    wallProgress: 0,
    wallsBuilt: 0,
    artifactWorkshopProgress: 0,
    robotsResearchLevel: 0,
    robotsResearchProgress: 0,
    weaponResearchLevel: 0,
    weaponResearchProgress: 0,
    wallResearchLevel: 0,
    wallResearchProgress: 0,
    aiInsight: INITIAL_AI_INSIGHT,
    rngSeed,
    rngCallCount: 0,
    lastRoundLog: null,
    status: 'active',
    runId,
  };
}

// ─── Mesečna zanka ─────────────────────────────────────────────────────────────

// aiActionOverride: v 2-player ga poda IGRALEC 2 (sicer ga izpelje decideAIAction).
// 1-player pot je nespremenjena (override je undefined).
export function processRound(state: GameState, action: PlayerAction, aiActionOverride?: AIAction): GameState {
  if (state.status !== 'active') return state;

  let rng: RNGState = { seed: state.rngSeed, calls: state.rngCallCount };
  const { assignment: rawAssignment, targetWeakPoint } = action;

  // Celotna velikost klana PRED rundo (kamp + misije + odprave) — za pravi populationDelta
  const totalClanBefore = state.population
    + (state.activeMissions ?? []).reduce((s, m) => s + m.assigned, 0)
    + (state.expeditions ?? []).reduce((s, e) => s + e.assigned, 0);
  const legacyMissionReturn = (state.activeMissions ?? []).reduce((s, m) => s + m.assigned, 0);

  // Normaliziraj — backward compat (dayGuard+nightGuard → defenders) + clamp na orožje
  const cap = Math.floor(state.resources.combat);
  const wantedDefenders = (rawAssignment.defenders ?? 0)
    + (rawAssignment.dayGuard ?? 0) + (rawAssignment.nightGuard ?? 0);
  const wantedCombat = rawAssignment.combatants ?? 0;
  const totalArmed = wantedDefenders + wantedCombat;
  let assignment: Assignment;
  if (totalArmed > cap && totalArmed > 0) {
    const k = cap / totalArmed;
    assignment = {
      ...rawAssignment,
      combatants: Math.floor(wantedCombat * k),
      defenders:  Math.floor(wantedDefenders * k),
    };
  } else {
    assignment = { ...rawAssignment, combatants: wantedCombat, defenders: wantedDefenders };
  }

  // 0. Človekovo drevo napredka — bonusi iz zgodovine osi
  const axisHistory = state.axisHistory ?? { obzidje: 0, orozje: 0, roboti: 0 };
  // (os Obzidje/Orožje/Roboti je zaenkrat brez mehanskih učinkov — beleži se le fokus za drevo)

  // 0.5. Obroki — vplivajo na porabo hrane, na moč ljudi in na rast populacije
  const rations = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];

  // 1. Preživetveni resursi — populacija poje hrano (skalirano z obroki)
  const survivalCost = Math.round(state.population * SURVIVAL_PER_PERSON_PER_ROUND * rations.foodMult);
  let survival = state.resources.survival - survivalCost;

  // 2. Forageri zbirajo preživetvene vire (učinkovitost skalirana z močjo iz obrokov)
  const foraged = Math.floor(assignment.foragers * FORAGER_YIELD * rations.strengthMult);
  survival += foraged;
  survival = Math.max(0, survival);

  // (izvidniki v kampu nimajo več ujetja — to velja le za odprave na poti)
  const scoutResult: ScoutResult = { captured: false, scoutsLost: 0, effectivenessMult: 1.0 };

  let combat = state.resources.combat;
  let material = state.resources.material ?? 0;
  let artifacts = state.resources.artifacts ?? 0;
  let artifactsCrafted = state.artifactsCrafted ?? 0;  // skupno izdelanih (za pregled taktike)
  let artifactsUsed = state.artifactsUsed ?? 0;        // skupno uporabljenih

  // 3. RAZISKOVALCI — intel boost + raziskave nadgradenj (orožje/obzidje)
  const researchers = assignment.researchers ?? assignment.scouts ?? 0;
  const researchObj: ResearchObjective = assignment.researchObjective ?? 'robots';
  const intelGained = Math.floor(researchers * SCOUT_INTEL_YIELD * rations.strengthMult);
  let intelligence = state.resources.intelligence + intelGained;

  let mapTiles = state.mapTiles ?? generateMap();
  let otherClans = (state.otherClans ?? generateOtherClans()).map(c => ({ ...c }));
  const workshopEvents: string[] = [];

  // Raziskovalne nadgradnje — stanje
  let robotsResearchLevel    = state.robotsResearchLevel ?? 0;
  let robotsResearchProgress = state.robotsResearchProgress ?? 0;
  let weaponResearchLevel    = state.weaponResearchLevel ?? 0;
  let weaponResearchProgress = state.weaponResearchProgress ?? 0;
  let wallResearchLevel      = state.wallResearchLevel ?? 0;
  let wallResearchProgress   = state.wallResearchProgress ?? 0;

  let aiInsightGain = 0;
  if (researchers > 0) {
    const insightFactor = researchObj === 'robots' ? 1 : NON_ROBOT_RESEARCH_INSIGHT_FACTOR;
    aiInsightGain = researchers * AI_INSIGHT_PER_RESEARCHER * rations.strengthMult * insightFactor;
    if (researchObj === 'robots') {
      // Roboti: ustvarjajo intel in insight, ki razkrije AI enote/šibkosti.
      const intelBonus = Math.floor(researchers * SCOUT_INTEL_YIELD * rations.strengthMult);
      intelligence += intelBonus;
      robotsResearchProgress += researchers;
      while (robotsResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS && robotsResearchLevel < 3) {
        robotsResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
        robotsResearchLevel += 1;
        workshopEvents.push(`🔬 Raziskava robotov dokončana — odkrili smo šibko točko ${researchedAIUnitLabel(robotsResearchLevel)}. To znanje lahko zdaj uporabimo pri razvoju orožja ali obzidja.`);
      }
    } else if (researchObj === 'weapon') {
      const unlocked = Math.max(state.robotsResearchLevel ?? 0, mechanicalTechUnlockLevel(state));
      if (weaponResearchLevel >= unlocked) {
        workshopEvents.push(`🔒 Orožje ${weaponResearchLevel + 1} zaklenjeno — najprej razkrij mehansko šibkost AI stopnje ${weaponResearchLevel + 1}.`);
      } else {
        weaponResearchProgress += researchers;
        while (weaponResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS && weaponResearchLevel < unlocked) {
          weaponResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
          weaponResearchLevel += 1;
          workshopEvents.push(`🔬 Raziskava orožja dokončana — orožje smo prilagodili šibkosti ${researchedAIUnitLabel(weaponResearchLevel)}. Napadalci lahko zdaj bolje zadenejo ranljive dele robotov.`);
        }
      }
    } else if (researchObj === 'wall') {
      const unlocked = Math.max(state.robotsResearchLevel ?? 0, mechanicalTechUnlockLevel(state));
      if (wallResearchLevel >= unlocked) {
        workshopEvents.push(`🔒 Obzidje ${wallResearchLevel + 1} zaklenjeno — najprej razkrij mehansko šibkost AI stopnje ${wallResearchLevel + 1}.`);
      } else {
        wallResearchProgress += researchers;
        while (wallResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS && wallResearchLevel < unlocked) {
          wallResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
          wallResearchLevel += 1;
          workshopEvents.push(`🔬 Raziskava obzidja dokončana — obrambo smo prilagodili šibkosti ${researchedAIUnitLabel(wallResearchLevel)}. Zidovi in branilci zdaj bolje ustavljajo ta tip napada.`);
        }
      }
    }
  }

  // Naše znanje o AI (insight) → odpiranje AI drevesa do faznega stropa; poganja ga raziskovanje.
  const aiInsight = Math.min(
    INSIGHT_PHASE_CAP[state.phase],
    (state.aiInsight ?? INITIAL_AI_INSIGHT) + aiInsightGain,
  );
  let aiTree = revealTreeByInsight(state.aiTree, aiInsight);
  const prevRevealed = new Set(state.aiTree.filter(n => n.visibility === 'revealed').map(n => n.id));
  const revealed: string[] = aiTree.filter(n => n.visibility === 'revealed' && !prevRevealed.has(n.id)).map(n => n.id);
  const unlockedTechLevel = Math.max(robotsResearchLevel, mechanicalTechUnlockLevel({ aiTree }));
  if (unlockedTechLevel > robotsResearchLevel) {
    const unlockedLevels = unlockedTechLevel - robotsResearchLevel;
    robotsResearchLevel = unlockedTechLevel;
    robotsResearchProgress = Math.max(0, robotsResearchProgress - RESEARCH_LEVEL_WORKER_MONTHS * unlockedLevels);
    workshopEvents.push(`🔓 Mehanska šibkost razkrita — odkrili smo šibko točko ${researchedAIUnitLabel(unlockedTechLevel)}. To znanje lahko zdaj uporabimo pri razvoju orožja ali obzidja.`);
  }

  // 4. DELAVCI — delavnica (delavec-meseci; napredek se ohrani ob preklopu)
  const workers = assignment.workers ?? 0;
  const workshopObj: 'weapon' | 'wall' | 'artifact' = assignment.workshopObjective ?? 'weapon';
  let weaponWorkshopProgress = state.weaponWorkshopProgress ?? 0;
  let weaponWorkshopScouts = state.weaponWorkshopScouts ?? 0;
  let wallProgress = state.wallProgress ?? 0;
  let wallsBuilt = state.wallsBuilt ?? 0;
  let artifactWorkshopProgress = state.artifactWorkshopProgress ?? 0;

  if (workers > 0) {
    if (workshopObj === 'weapon') {
      if (material < WEAPON_MATERIAL_COST) {
        workshopEvents.push(`⚔️ Delavnica orožja stoji — premalo materiala (potreben ${WEAPON_MATERIAL_COST}).`);
      } else {
        weaponWorkshopProgress += workers;
        const possible = Math.floor(weaponWorkshopProgress / WEAPON_WORKER_MONTHS);
        const made = Math.min(possible, Math.floor(material / WEAPON_MATERIAL_COST));
        if (made > 0) {
          combat += made;
          material -= made * WEAPON_MATERIAL_COST;
          weaponWorkshopProgress -= made * WEAPON_WORKER_MONTHS;
          workshopEvents.push(`⚔️ Delavnica orožja: +${made} orožja (−${made * WEAPON_MATERIAL_COST} materiala). Napredek: ${weaponWorkshopProgress}/${WEAPON_WORKER_MONTHS}.`);
        } else {
          workshopEvents.push(`⚔️ Delavnica orožja: ${weaponWorkshopProgress}/${WEAPON_WORKER_MONTHS} delavec-mesecev.`);
        }
        weaponWorkshopScouts = workers;
      }
    } else if (workshopObj === 'wall') {
      if (material < WALL_MATERIAL_COST) {
        workshopEvents.push(`🧱 Gradnja obzidja stoji — premalo materiala (potrebnih ${WALL_MATERIAL_COST}).`);
      } else {
        wallProgress += workers;
        const possible = Math.floor(wallProgress / WALL_WORKER_MONTHS);
        const made = Math.min(possible, Math.floor(material / WALL_MATERIAL_COST));
        if (made > 0) {
          wallsBuilt += made;
          material -= made * WALL_MATERIAL_COST;
          wallProgress -= made * WALL_WORKER_MONTHS;
          workshopEvents.push(`🧱 Obrambno obzidje dograjeno! +${made} obzidje (−${made * WALL_MATERIAL_COST} materiala). Skupaj ${wallsBuilt}, +${Math.round(difficultyProfile(state.difficulty).wallDefensePct * 100) * made} % obrambe. Napredek: ${wallProgress}/${WALL_WORKER_MONTHS}.`);
        } else {
          workshopEvents.push(`🧱 Gradnja obzidja: ${wallProgress}/${WALL_WORKER_MONTHS} delavec-mesecev.`);
        }
      }
    } else if (workshopObj === 'artifact') {
      if (material < ARTIFACT_MATERIAL_COST) {
        workshopEvents.push(`💎 Delavnica artefaktov stoji — premalo materiala (potrebnih ${ARTIFACT_MATERIAL_COST}).`);
      } else {
        artifactWorkshopProgress += workers;
        const possible = Math.floor(artifactWorkshopProgress / ARTIFACT_WORKER_MONTHS);
        const made = Math.min(possible, Math.floor(material / ARTIFACT_MATERIAL_COST));
        if (made > 0) {
          artifacts += made;
          artifactsCrafted += made;
          material -= made * ARTIFACT_MATERIAL_COST;
          artifactWorkshopProgress -= made * ARTIFACT_WORKER_MONTHS;
          workshopEvents.push(`💎 ARTEFAKT IZDELAN! +${made} artefakt (−${made * ARTIFACT_MATERIAL_COST} materiala). Napredek: ${artifactWorkshopProgress}/${ARTIFACT_WORKER_MONTHS}.`);
        } else {
          workshopEvents.push(`💎 Delavnica artefaktov: ${artifactWorkshopProgress}/${ARTIFACT_WORKER_MONTHS} delavec-mesecev.`);
        }
      }
    }
  }

  // 5. Šibke točke — odkrijejo se IZKLJUČNO z raziskovanjem mape (ko najdemo heks,
  //    ki skriva šibko točko; isti prag 0.50 kot ◆ oznaka na mapi). Ne razkrijejo se
  //    več samo z napredkom v AI drevesu.
  const aiWeakPoints = state.aiWeakPoints.map(wp => {
    if (wp.discovered) return wp;
    const mapRevealed = mapTiles.some(t => t.hidesWeakPointId === wp.id && t.researchProgress >= 0.50);
    return mapRevealed ? { ...wp, discovered: true } : wp;
  });

  // 6a. NAPAD (offensive combat — combatants gredo udariti AI)
  let population = state.population + legacyMissionReturn;
  let aiUnits = readAIUnits(state);
  const aiUnitsBefore = { ...aiUnits };
  let aiRobots = totalAIRobots(aiUnits);
  const applyDestroy = (n: number) => { aiUnits = destroyAIUnits(aiUnits, n); aiRobots = totalAIRobots(aiUnits); };
  let aiKnowledge = state.aiKnowledge;
  let combatLog = null;
  let scoutsKilled = scoutResult.scoutsLost;
  const expeditionEvents: string[] = [];   // posebni dogodki (vrnitve, izgube, uničene šibke točke)

  // POVELJSTVO: AI poteza (1P = skripta, 2P = igralec 2). Določi vloge robotov za TO rundo.
  const aiAct: AIAction = aiActionOverride ?? decideAIAction(state);
  const aiTotal0 = totalAIRobots(aiUnits);
  // Velikost ekip: patruljne robote razdeli v ekipe. Več ekip → več srečanj;
  // večja ekipa → večje izgube ob srečanju (wipeMult).
  const teamRobots = AI_TEAM_ROBOTS[(aiAct.teamSize ?? 2) as 1 | 2 | 3];
  const patrolRobots = aiAct.roles.patrol * aiTotal0;
  const teams = patrolRobots / Math.max(1, teamRobots);
  const patrolFactor = Math.min(PATROL_ENCOUNTER_MAX_MULT, 1 + teams * PATROL_ENCOUNTER_PER_TEAM);
  const wipeMult = teamRobots / AI_TEAM_WIPE_REF;
  const searchKnowledge = aiAct.roles.search * aiTotal0 * SEARCH_KNOWLEDGE_PER_ROBOT;

  const isExploiting = targetWeakPoint
    ? aiWeakPoints.some(wp => wp.id === targetWeakPoint && wp.discovered)
    : false;

  if (assignment.combatants > 0) {
    const { result, rng: rngAfter } = resolveCombat(state, assignment, rng, isExploiting);
    rng = rngAfter;
    combatLog = result;

    const actualHumanLost = result.humanLost;
    population -= actualHumanLost;
    // Smrti v napadu = izguba orožja (1 padel = 1 izgubljeno orožje)
    combat = Math.max(0, combat - actualHumanLost);
    applyDestroy(result.aiRobotsDestroyed);
    // Vsak uničen robot pusti 1 material (surovina za delavnice)
    material += result.aiRobotsDestroyed;
    aiKnowledge = Math.min(1, aiKnowledge + result.aiInfoGained);
    intelligence += result.infoGained;
    combat = Math.max(0, combat + (result.spoils.combat ?? 0));
    intelligence += result.spoils.intelligence ?? 0;

    if (isExploiting && result.outcome === 'victory') {
      const idx = aiWeakPoints.findIndex(wp => wp.id === targetWeakPoint);
      if (idx >= 0) {
        const wpLabel = aiWeakPoints[idx].label;
        aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true };
        expeditionEvents.push(`💥 ŠIBKA TOČKA UNIČENA: ${wpLabel} — v napadu izkoriščena.`);
      }
    }
  }

  // 6b. RAID — NAČRTOVAN tempo: ob vstopu v obdobje (faza / leto totalnega napada)
  // se izžreba število napadov in razporedi po mesecih. Po 36. mesecu AI VE, kje je
  // kamp — totalni napadi (8–10/leto); utrjen kamp lahko zmelje vse robote in zmaga.
  const trNow = state.totalRounds;
  const periodNow = raidPeriodFor(trNow);
  let raidPlan = state.raidPlan;
  if (!raidPlan || trNow > raidPlan.periodEnd || trNow < raidPlan.periodStart) {
    const [count, rngC] = rngInt(rng, periodNow.range[0], periodNow.range[1]); rng = rngC;
    // izberi `count` različnih mesecev v preostanku obdobja (migracija starih iger: od zdaj naprej)
    const window: number[] = [];
    for (let m = Math.max(periodNow.start, trNow); m <= periodNow.end; m++) window.push(m);
    const months: number[] = [];
    for (let i = 0; i < count && window.length > 0; i++) {
      const [idx, rngI] = rngInt(rng, 0, window.length - 1); rng = rngI;
      months.push(window.splice(idx, 1)[0]);
    }
    months.sort((a, b) => a - b);
    raidPlan = { periodStart: periodNow.start, periodEnd: periodNow.end, months };
    if (periodNow.assault && trNow === periodNow.start) {
      expeditionEvents.push(`🚨 TOTALNI NAPAD: AI ve, kje je kamp — letos načrtuje ${count} napadov. Brani se in zmelji njegovo vojsko!`);
    }
  }
  let raidLog: RaidResult | null = null;
  if (aiAttackPower(readAIUnits(state)) > 0 && raidPlan.months.includes(trNow)) {
    const { result: raidRes, rng: rngR2 } = resolveRaid(state, assignment, rng, population);
    rng = rngR2;
    // Obrambni nivo malo zmanjša žrtve med ljudmi
    const save = (n: number) => n;  // (obrambni bonus osi odstranjen)
    const actualDef = save(raidRes.defendersLost);
    const actualFor = save(raidRes.foragersLost);
    const actualWrk = save(raidRes.workersLost);
    const actualRes = save(raidRes.researchersLost);
    const actualHidden = save(raidRes.hiddenLost);
    // Žrtve so povsod, kjer je AI prebil — vsaka vloga izgubi svoje ljudi
    population -= actualDef + actualFor + actualWrk + actualRes + actualHidden;
    combat = Math.max(0, combat - actualDef);                    // padli branilci → izgubljeno orožje
    combat = Math.max(0, combat - raidRes.weaponsDestroyed);     // skladiščno (idle) orožje

    // Uničenje virov v prebitih območjih (na žive vrednosti tega meseca)
    let weaponsDestroyed = raidRes.weaponsDestroyed;
    let survivalDestroyed = 0, materialDestroyed = 0, wallsDestroyed = 0;
    for (const area of raidRes.breachedAreas) {
      if (area === 'food') {
        const d = Math.round(survival * RAID_DESTROY_FOOD_PCT); survival = Math.max(0, survival - d); survivalDestroyed += d;
      } else if (area === 'workshop') {
        const d = Math.round(combat * RAID_DESTROY_WEAPONS_PCT); combat = Math.max(0, combat - d); weaponsDestroyed += d;
      } else if (area === 'research') {
        const d = Math.round(material * RAID_DESTROY_MATERIAL_PCT); material = Math.max(0, material - d); materialDestroyed += d;
      } else if (area === 'defense') {
        const d = Math.min(wallsBuilt, RAID_DESTROY_WALL_LEVELS); wallsBuilt = Math.max(0, wallsBuilt - d); wallsDestroyed += d;
      }
    }

    applyDestroy(raidRes.aiRobotsDestroyed);
    material += raidRes.aiRobotsDestroyed;  // branilci poberejo material iz uničenih robotov
    raidLog = {
      ...raidRes,
      defendersLost: actualDef, foragersLost: actualFor, workersLost: actualWrk, researchersLost: actualRes, hiddenLost: actualHidden,
      weaponsDestroyed, survivalDestroyed, materialDestroyed, wallsDestroyed,
    };
    // AI dobi informacije le, če se kak robot vrne — ob DOMINACIJI obrambe ne dobi nič.
    aiKnowledge = Math.min(1, aiKnowledge + raidRes.aiInfoGained);
  } else {
    raidLog = { occurred: false, outcome: null,
      defendersLost: 0, foragersLost: 0, workersLost: 0, researchersLost: 0, hiddenLost: 0,
      aiRobotsDestroyed: 0, weaponsDestroyed: 0,
      survivalDestroyed: 0, materialDestroyed: 0, wallsDestroyed: 0,
      breachedAreas: [],
      successProbability: raidRepelProbability(state, assignment),
      aiInfoGained: 0, domination: null };
  }

  // 6c. Pop loss od ujetih izvidnikov
  population -= scoutsKilled;

  // Uporaba artefakta na šibko točko (instant uniči)
  if (assignment.useArtifactOnWpId && artifacts > 0) {
    const wpId = assignment.useArtifactOnWpId;
    const idx = aiWeakPoints.findIndex(w => w.id === wpId);
    if (idx >= 0 && !aiWeakPoints[idx].exploited) {
      artifacts -= 1;
      const wpLabel = aiWeakPoints[idx].label;
      aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true, discovered: true };
      expeditionEvents.push(`💎 ARTEFAKT UPORABLJEN: ${wpLabel} — instant uničena!`);
      artifactsUsed += 1;
    }
  }

  // 6c2. ODPRAVE NA POTI (scout + mission s path) — tick + sprejem novih
  const incomingExps = assignment.newExpeditions ?? [];
  const oldExps = state.expeditions ?? [];
  const oldCompletedExps = state.completedExpeditions ?? [];
  const tickedExps: Expedition[] = [];
  const finishedExps: Expedition[] = [];
  let returnedThisMonth = 0;  // ljudje, ki so se TA mesec vrnili v kamp — izvzeti iz lakote/obrokov (hrano so imeli s seboj)

  // Opis nošenega plena za dnevnik
  const carriedStr = (c: { material: number; weapons: number; artifacts: number }) => {
    const parts: string[] = [];
    if (c.material > 0) parts.push(`${c.material} materiala`);
    if (c.weapons > 0) parts.push(`${c.weapons} orožja`);
    if (c.artifacts > 0) parts.push(`${c.artifacts} artefakt(ov)`);
    return parts.join(', ');
  };

  // Sprejmi NOVE odprave po logistiki tega meseca, vendar jih ne tikaj takoj:
  // po potrditvi morajo biti na izhodnem kamp hexu do naslednjega meseca.
  const newlyCreated: Expedition[] = [];
  for (const inp of incomingExps) {
    if (!inp.path || inp.path.length < 2) continue;
    if (inp.assigned < 1) continue;
    // VARNOST: nikoli ne pošlji več ljudi, kot jih je dejansko v kampu (prepreči negativno populacijo).
    const take = Math.min(inp.assigned, Math.max(0, population));
    if (take < 1) {
      expeditionEvents.push(`⚠ Odprava preklicana — v kampu ni dovolj ljudi.`);
      continue;
    }
    if (take < inp.assigned) {
      expeditionEvents.push(`⚠ Odprava zmanjšana na ${take} ljudi (v kampu jih ni bilo dovolj za ${inp.assigned}).`);
    }
    const [idRoll, rngId] = rngInt(rng, 1000, 9999); rng = rngId;
    population -= take;
    // OROŽJE GRE Z NJIMI: napadalne misije vzamejo 1 orožje na člana (vrne se s preživelimi).
    // IZVIDNIKI orožja NE nosijo (logično — izvidujejo, ne napadajo) → 0 orožja, ne trošijo
    // dragocenega orožja, ki ga rabimo za obrambo. (Prej le stealth; zdaj vsi izvidniki.)
    const equippedWeapons = inp.kind === 'scout' ? 0 : Math.min(take, Math.max(0, combat));
    combat -= equippedWeapons;
    const eTier = RATIONS_LEVELS[inp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
    // Hrana se plača po dolžini poti v hexih, ne po pospešenem trajanju.
    const target = inp.path[inp.path.length - 1];
    const retEnd = inp.returnPath?.[inp.returnPath.length - 1];
    const retValid = !!inp.returnPath && inp.returnPath.length >= 2
      && inp.returnPath[0].q === target.q && inp.returnPath[0].r === target.r
      && !!retEnd && isCampHex(retEnd);
    const months = Math.max(1,
      pathMonths(inp.path, inp.rations) + (retValid ? pathMonths(inp.returnPath!, inp.rations) : returnMonths(inp.path, inp.rations)));
    const foodMonths = Math.max(1,
      pathFoodMonths(inp.path) + (retValid ? pathFoodMonths(inp.returnPath!) : returnFoodMonths(inp.path)));
    const foodPack = Math.round(take * foodMonths * eTier.foodMult);
    survival = Math.max(0, survival - foodPack);
    expeditionEvents.push(`🎒 Odprava (${take} ljudi, ${months}m tja+nazaj, hrana za ${foodMonths} hex-m) vzela ${foodPack} hrane${equippedWeapons > 0 ? ` in ${equippedWeapons} orožja` : ''} s seboj.`);
    newlyCreated.push({
      id: `exp_${state.totalRounds}_${idRoll}`,
      kind: inp.kind,
      weakPointId: inp.weakPointId,
      path: inp.path,
      currentIndex: 0,
      assigned: take,
      rations: inp.rations,
      status: 'traveling',
      monthsElapsed: 0,
      encountersLog: [],
      stealth: inp.stealth,
      lootMode: inp.lootMode,
      equippedWeapons,
      departedCount: take,
      returnPath: inp.returnPath,
    });
  }

  for (const e of oldExps) {
    const scoutEncounterUnits = Math.round(aiUnits.scouts * (1 - (logicalWeaknessByRobot({ ...state, aiTree } as GameState).scouts ? LOGICAL_WEAKNESS_ENCOUNTER_REDUCTION : 0)));
    const r = tickExpedition(e, mapTiles, aiKnowledge, rng, scoutEncounterUnits, patrolFactor, wipeMult);
    rng = r.rng;
    mapTiles = r.tiles;
    // Srečanja: ljudje VEDNO izvedo o AI enotah (+intel); AI izve o nas le, če skrivanje ni uspelo.
    intelligence += r.intelGained;
    aiKnowledge = Math.min(1, aiKnowledge + r.aiInfoGained);

    // Najdbe med potjo — NE gredo takoj v kamp; odprava jih NOSI in dostavi ob vrnitvi
    const carried = {
      material:  (e.carried?.material  ?? 0) + r.finds.material,
      weapons:   (e.carried?.weapons   ?? 0) + r.finds.weapons,
      artifacts: (e.carried?.artifacts ?? 0) + r.finds.artifacts,
    };

    // VOJNA MEGLA: dogodki s poti (srečanja, najdbe, spopadi) se NE objavijo sproti —
    // zbirajo se v exp.encountersLog in se objavijo kot POROČILO šele ob vrnitvi v kamp.
    // Če se nihče ne vrne, poročila NI — izvemo samo, da so izgubljeni.
    const dumpReport = (log: string[]) => {
      if (!log.length) return;
      expeditionEvents.push(`📋 Poročilo odprave:`);
      for (const ev of log) expeditionEvents.push(`· ${ev}`);
    };
    const departed = e.departedCount ?? e.assigned;

    // ── POVRATNI LEG — odprava potuje nazaj po NOVI poti proti kampu: raziskuje polja in je vidna na mapi ──
    if (e.status === 'returning') {
      if (r.exp.status === 'lost') {
        // nihče se ni vrnil — brez podrobnosti in brez plena
        expeditionEvents.push(`☠ Odprava (${departed} ljudi) se ni vrnila. Nihče ne ve, kaj se je zgodilo.`);
        finishedExps.push({ ...r.exp, carried });
      } else if (r.exp.currentIndex >= r.exp.path.length - 1) {
        // prispeli v kamp — šele zdaj dostavimo ljudi, plen IN orožje preživelih + objavimo poročilo
        returnedThisMonth += Math.max(0, r.exp.assigned);
        const retWeapons = Math.min(Math.max(0, r.exp.assigned), r.exp.equippedWeapons ?? 0);
        material += carried.material; combat += carried.weapons + retWeapons; artifacts += carried.artifacts;
        const cs = carriedStr(carried);
        expeditionEvents.push(`✓ Odprava se je vrnila v kamp — ${r.exp.assigned}/${departed} ljudi${retWeapons > 0 ? ` (+${retWeapons} orožja)` : ''}${cs ? ` · prinesli: ${cs}` : ''}.`);
        dumpReport(r.exp.encountersLog);
        finishedExps.push({ ...r.exp, status: 'completed', carried });
      } else {
        // še na poti domov — na mapi se vidi premik, novic pa ni
        tickedExps.push({ ...r.exp, carried });
      }
      continue;
    }

    if (r.exp.status === 'completed' || r.exp.status === 'lost') {
      if (r.exp.status === 'completed') {
        const target = r.exp.path[r.exp.path.length - 1];
        // Navezava stika z drugim klanom, če je odprava dospela na njihov heks
        const arrTile = mapTiles.find(t => t.q === target.q && t.r === target.r);
        if (arrTile?.otherClanId) {
          const ci = otherClans.findIndex(c => c.id === arrTile.otherClanId);
          if (ci >= 0 && !otherClans[ci].allied) {
            if (otherClans[ci].discovered) {
              // klan je bil že odkrit (videli smo ga na mapi) → zdaj zavezništvo
              otherClans[ci] = { ...otherClans[ci], allied: true };
              expeditionEvents.push(`🤝 ZAVEZNIŠTVO: ${otherClans[ci].label} se nam je pridružil — odslej sodelujemo!`);
            } else {
              // prvič ga vidimo → samo razkrijemo na mapi; zavezništvo zahteva nov obisk
              otherClans[ci] = { ...otherClans[ci], discovered: true };
              expeditionEvents.push(`📍 ODKRIT KLAN: ${otherClans[ci].label} na ${hexLabel(otherClans[ci])}. Pošlji odpravo še enkrat za zavezništvo.`);
            }
          }
        }
        let survivors = r.exp.assigned;
        const arrivalLog: string[] = [];  // izid na cilju → v poročilo ob vrnitvi (ne objavi sproti)
        if (r.exp.kind === 'mission') {
          // SPOPAD OB PRIHODU — napadalci udarijo na cilju, preživeli se nato vračajo
          const aTier = RATIONS_LEVELS[r.exp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
          const stealthBonus = r.exp.stealth ? 1.2 : 1.0;  // +20 % uspeha v boju
          // POENOTENJE: napad na hex, KJER JE šibka točka, VEDNO šteje kot napad NANJO —
          // tudi če odprava ni bila izrecno označena (weakPointId). Tako je "napad na hex"
          // in "napad na šibko točko" ista stvar, kadar je na tem polju.
          const effectiveWpId = r.exp.weakPointId ?? arrTile?.hidesWeakPointId;
          if (effectiveWpId) {
            // Napad na šibko točko AI
            const wpIdx = aiWeakPoints.findIndex(wp => wp.id === effectiveWpId);
            const pBase = missionSuccessProbability(
              { ...state, resources: { ...state.resources, intelligence } },
              effectiveWpId, survivors, r.exp.rations);
            const p = Math.min(0.98, pBase * stealthBonus);
            const [roll, rngA] = tacticalRoll(rng); rng = rngA;
            const wpLabel = wpIdx >= 0 ? aiWeakPoints[wpIdx].label : 'šibka točka';
            // Straža te točke: napad jo vedno redči — neuspešen napad olajša naslednjega.
            const effG = wpIdx >= 0
              ? Math.max(0, wpGarrisonUnits(aiUnits) - (aiWeakPoints[wpIdx].garrisonLoss ?? 0))
              : 0;
            const attackersNow = survivors;
            if (roll < p && wpIdx >= 0) {
              const lost = Math.round(survivors * (1 - p) * 0.3);
              survivors = Math.max(0, survivors - lost);
              aiWeakPoints[wpIdx] = { ...aiWeakPoints[wpIdx], exploited: true, discovered: true };
              if (effG > 0) applyDestroy(effG);  // straža je padla z njo
              arrivalLog.push(`💥 ŠIBKA TOČKA UNIČENA: ${wpLabel} — ${lost} padlih${effG > 0 ? `, pobita straža (${effG} enot)` : ''}.`);
            } else {
              const lost = expeditionDefeatLoss(survivors, 0.5);
              survivors = Math.max(0, survivors - lost);
              const killedG = Math.min(effG, Math.round(attackersNow * 0.35));
              if (wpIdx >= 0 && killedG > 0) {
                aiWeakPoints[wpIdx] = { ...aiWeakPoints[wpIdx], garrisonLoss: (aiWeakPoints[wpIdx].garrisonLoss ?? 0) + killedG };
                applyDestroy(killedG);
              }
              arrivalLog.push(`✗ Napad na ${wpLabel} ni uspel — ${lost} padlih${killedG > 0 ? ` · straža oslabljena (−${killedG}, ostane ${effG - killedG})` : ''}.`);
            }
          } else {
            // Splošni napad na AI robote — naša moč raste z orožjem in razkritimi logičnimi šibkostmi
            const humanStr = survivors * 1.2 * aTier.strengthMult * stealthBonus
              * weaponEffectMult(state.difficulty, state.weaponResearchLevel ?? 0) * (1 + logicalWeaknessBonus(state));
            const aiStr = Math.max(1, aiDefensePower(aiUnits) * 0.05);
            const p = humanStr / (humanStr + aiStr);
            const [roll, rngA] = tacticalRoll(rng); rng = rngA;
            if (roll < p) {
              const destroyed = Math.min(aiRobots, Math.round(survivors * (1 + p)));
              applyDestroy(destroyed);
              carried.material += destroyed;  // plen nosijo s seboj, dostavijo ob vrnitvi
              const lost = Math.round(survivors * (1 - p) * 0.3);
              survivors = Math.max(0, survivors - lost);
              arrivalLog.push(`⚔️ Napad uspešen na ${hexLabel(target)}: ${destroyed} robotov uničenih, ${lost} padlih.`);
            } else {
              const destroyed = Math.min(aiRobots, Math.round(survivors * 0.5));
              applyDestroy(destroyed);
              carried.material += destroyed;  // plen nosijo s seboj, dostavijo ob vrnitvi
              const lost = expeditionDefeatLoss(survivors, 0.6);
              survivors = Math.max(0, survivors - lost);
              arrivalLog.push(`⚔️ Napad odbit na ${hexLabel(target)}: ${destroyed} robotov, a ${lost} padlih.`);
            }
          }
        } else {
          arrivalLog.push(`✓ Dospeli na cilj ${hexLabel(target)}.`);
        }
        // POVRATEK — preživeli krenejo nazaj. Če je igralec izbral lastno povratno pot (in se začne na cilju
        // ter konča v kampu), jo upoštevamo; sicer izračunamo najkrajšo. Med potjo raziskujejo polja.
        survivors = Math.max(0, survivors);
        const chosenRet = r.exp.returnPath;
        const retEnd = chosenRet?.[chosenRet.length - 1];
        const retValid = !!chosenRet && chosenRet.length >= 2
          && chosenRet[0].q === target.q && chosenRet[0].r === target.r
          && !!retEnd && isCampHex(retEnd);  // povratek se mora končati v kamp-grozdu
        const retPath = retValid ? chosenRet! : pathToCamp(target);
        if (survivors <= 0) {
          // vsi padli na cilju → nihče se ni vrnil; brez poročila, brez plena
          expeditionEvents.push(`☠ Odprava (${departed} ljudi) se ni vrnila. Nihče ne ve, kaj se je zgodilo.`);
          finishedExps.push({ ...r.exp, status: 'lost', assigned: 0, carried });
        } else if (retPath.length <= 1) {
          // cilj je kamp — takoj doma (vrne tudi orožje preživelih) + poročilo
          returnedThisMonth += survivors;
          const retWeapons = Math.min(survivors, r.exp.equippedWeapons ?? 0);
          material += carried.material; combat += carried.weapons + retWeapons; artifacts += carried.artifacts;
          const cs = carriedStr(carried);
          expeditionEvents.push(`✓ Odprava se je vrnila v kamp — ${survivors}/${departed} ljudi${retWeapons > 0 ? ` (+${retWeapons} orožja)` : ''}${cs ? ` · prinesli: ${cs}` : ''}.`);
          dumpReport([...r.exp.encountersLog, ...arrivalLog]);
          finishedExps.push({ ...r.exp, carried });
        } else {
          // krenejo nazaj — izid na cilju gre v poročilo (objavi se ob vrnitvi)
          tickedExps.push({ ...r.exp, status: 'returning', path: retPath, currentIndex: 0, assigned: survivors, carried,
            encountersLog: [...r.exp.encountersLog, ...arrivalLog] });
        }
      } else {
        // ODPRAVA IZGUBLJENA na poti — nihče se ni vrnil; brez podrobnosti in plena
        expeditionEvents.push(`☠ Odprava (${departed} ljudi) se ni vrnila. Nihče ne ve, kaj se je zgodilo.`);
        finishedExps.push({ ...r.exp, carried });
      }
    } else {
      // še na poti — nosi plen naprej
      tickedExps.push({ ...r.exp, carried });
    }
  }

  tickedExps.push(...newlyCreated);

  // Nove odprave se premaknejo šele v naslednjem processRound.

  // Avtomatsko razkrivanje šibkih točk: če je heks z wp dosegel >= 0.50 raziskanost, je discovered
  for (let i = 0; i < aiWeakPoints.length; i++) {
    const wp = aiWeakPoints[i];
    if (wp.discovered) continue;
    const tile = mapTiles.find(t => t.hidesWeakPointId === wp.id);
    if (tile && tile.researchProgress >= 0.50) {
      aiWeakPoints[i] = { ...wp, discovered: true };
      expeditionEvents.push(`◆ ŠIBKA TOČKA ODKRITA: ${wp.label} na ${hexLabel(tile)}. To je tarča, ki lahko prevesi vojno proti AI.`);
    }
  }

  // 6d. LEGACY MISIJE — timer sistem je odstranjen iz aktivnega gameplaya.
  // Stare shranjene seje varno migriramo: ljudi vrnemo v kamp, novih missionAssignments ne sprejemamo.
  const oldMissions: Mission[] = [];
  const oldCompleted = state.completedMissions ?? [];
  const tickedMissions: Mission[] = [];
  const newlyCompleted: Mission[] = [];
  if (legacyMissionReturn > 0) {
    expeditionEvents.push(`↩ Legacy misije odstranjene — ${legacyMissionReturn} ljudi se je vrnilo v kamp. Uporabi odprave po mapi za nove napade.`);
  }

  // 6e. DRUGI KLANI — odkritje (raziskan heks) + mesečno sodelovanje (če zavezniki)
  for (let i = 0; i < otherClans.length; i++) {
    const c = otherClans[i];
    if (!c.discovered) {
      const tile = mapTiles.find(t => t.q === c.q && t.r === c.r);
      if (tile && tile.researchProgress >= 0.50) {
        otherClans[i] = { ...c, discovered: true };
        expeditionEvents.push(`📍 ODKRIT KLAN: ${c.label} na ${hexLabel(c)}. Pošlji odpravo do njih za zavezništvo.`);
      }
    }
  }
  let anyAlly = false;
  for (const c of otherClans) {
    if (!c.allied) continue;
    anyAlly = true;
    if (c.specialty === 'food')     { survival += 8; }
    else if (c.specialty === 'material') { material += 4; }
    else if (c.specialty === 'weapons')  { combat += 2; }
    else if (c.specialty === 'people')   { population += 1; }
  }
  if (anyAlly) {
    const gifts = otherClans.filter(c => c.allied).map(c => c.label).join(', ');
    expeditionEvents.push(`🤝 Zavezniki (${gifts}) so poslali pomoč ta mesec.`);
  }

  // Aktivnost klanov odstranjena — AI sila ni več filtrirana skoznjo.
  const clanActivity = 0;

  // 8. AI surveillance gain (skupna izpostavljenost: combatants + scouts)
  const exposure = (assignment.combatants + (assignment.researchers ?? 0)) / Math.max(1, state.population);
  const aiKnowledgeGain = calcAISurveillanceGain(DEFAULT_GENOME, exposure);
  // POVELJSTVO/ISKANJE: roboti na iskanju dodatno dvigajo znanje o kampu.
  const finalAiKnowledge = Math.min(1, aiKnowledge + aiKnowledgeGain + searchKnowledge);

  // 9. Stopnjevana lakota — če hrana pade pod 0, izgubljamo % populacije.
  // Ta-mesečni vrnjenci so IZVZETI iz lakote/obrokov (s seboj so imeli vnaprej plačano hrano) —
  // dodamo jih šele po izračunu, da ne kaže lažnih žrtev ob vrnitvi.
  let finalPopulation = population;
  const isStarving = survival <= 0;
  const prevStarvStreak = state.consecutiveStarvationMonths ?? 0;
  const newStarvStreak = isStarving ? prevStarvStreak + 1 : 0;
  if (isStarving) {
    const lossPct = newStarvStreak === 1 ? STARVATION_LOSS_PCT_1ST
                   : newStarvStreak === 2 ? STARVATION_LOSS_PCT_2ND
                   : STARVATION_LOSS_PCT_NTH;
    const dead = Math.ceil(finalPopulation * lossPct);
    finalPopulation = Math.max(0, finalPopulation - dead);
  }

  // 9.5. Obroki — sprememba populacije (lakota → odhod, obilje → novi pridejo)
  let finalMaxPopulation = state.maxPopulation;
  if (rations.popMin !== 0 || rations.popMax !== 0) {
    const [rationsDelta, rngAfter] = rngInt(rng, rations.popMin, rations.popMax);
    rng = rngAfter;
    finalPopulation = Math.max(0, finalPopulation + rationsDelta);
    if (rationsDelta > 0) {
      finalMaxPopulation = Math.max(state.maxPopulation, finalPopulation);
    }
  }

  // Ta-mesečni vrnjenci — dodani po lakoti/obrokih, nedotaknjeni
  if (returnedThisMonth > 0) {
    finalPopulation += returnedThisMonth;
    finalMaxPopulation = Math.max(finalMaxPopulation, finalPopulation);
  }

  // 10. Statusni check — izumrtje le če je CEL klan mrtev (kamp + misije + odprave)
  const totalClanAfter = finalPopulation
    + tickedMissions.reduce((s, m) => s + m.assigned, 0)
    + tickedExps.reduce((s, e) => s + e.assigned, 0);
  // Poraz = samo izumrtje. Po 36. mesecu igra preide v TOTALNI NAPAD (8–10 raidov/leto):
  // AI ve vse — a utrjen kamp lahko z obrambo zmelje vso vojsko in zmaga.
  let status: GameState['status'] = state.status;
  if (totalClanAfter <= 0) status = 'defeat_extinction';

  // 11. Fazni napredek in morebitni prehod
  const aiPhaseProgress = state.aiPhaseProgress + 1;
  const phaseComplete = aiPhaseProgress >= ROUNDS_PER_PHASE;
  // Konec faze s kritično majhnim klanom = poraz (kapica na neskončno vračanje preživelih).
  if (phaseComplete && totalClanAfter <= MIN_CLAN_AT_PHASE_END) status = 'defeat_extinction';

  const round = state.round < ROUNDS_PER_PHASE ? state.round + 1 : 1;
  const phase = phaseComplete ? nextPhase(state.phase) : state.phase;

  // Fazni razplet — AI izvede načrt
  let finalTree = aiTree;
  if (phaseComplete && state.phase !== 'eliminate') {
    finalTree = applyPhaseEvent(aiTree, state.phase);
  }

  // Fazni prihod novih AI enot (ob prehodu v novo fazo)
  if (phaseComplete) {
    if (phase === 'understand') {
      // AI iz proračuna (= načrtovane napadalne enote × cena) IZBERE sestavo pošiljke.
      const budget = difficultyProfile(state.difficulty).aiAttackers * AI_UNIT_ENERGY_COST.attackers;
      const ship = aiChoosePhaseShipment('understand', budget);
      aiUnits = { scouts: aiUnits.scouts + ship.scouts, attackers: aiUnits.attackers + ship.attackers, peopleKillers: aiUnits.peopleKillers + ship.peopleKillers };
      aiRobots = totalAIRobots(aiUnits);
      expeditionEvents.push(`🤖 AI je pripeljal ${ship.attackers} napadalnih enot — pričakuj napade na kamp.`);
    } else if (phase === 'eliminate' && state.phase === 'understand') {
      const budget = difficultyProfile(state.difficulty).aiPeopleKillers * AI_UNIT_ENERGY_COST.peopleKillers;
      const ship = aiChoosePhaseShipment('eliminate', budget);
      aiUnits = { scouts: aiUnits.scouts + ship.scouts, attackers: aiUnits.attackers + ship.attackers, peopleKillers: aiUnits.peopleKillers + ship.peopleKillers };
      aiRobots = totalAIRobots(aiUnits);
      expeditionEvents.push(`☠ AI je pripeljal ${ship.peopleKillers} people-killer enot — napadi so zdaj smrtonosnejši.`);
    }
    // (Konec 3. faze NI poraz — sledi era totalnega napada; napoved gre prek raidPlan-a.)
  }

  // AI EKONOMIJA (temelj): pritok energije iz jedra + NADOMEŠČANJE izgub do ciljne vojske.
  // Uničeno jedro (wp_power) strmo zniža pritok → izčrpavalna zmaga postane dosegljiva.
  // Ne oživlja popolnoma iztrebljene vojske (aiRobots = 0 ostane zmaga igralca).
  let aiEnergy = state.aiEnergy ?? AI_ENERGY_START;
  let aiEnergyLevel = state.aiEnergyLevel ?? 0;
  let aiAttackLevel = state.aiAttackLevel ?? 0;
  let aiDefenseLevel = state.aiDefenseLevel ?? 0;
  let aiLastAction: AIAction | undefined;
  {
    const coreDestroyed = !!aiWeakPoints.find(w => w.id === AI_ENERGY_CORE_WEAKPOINT && w.exploited);
    const coreMult = coreDestroyed ? AI_ENERGY_CORE_DESTROYED_MULT : 1;
    aiEnergy += difficultyProfile(state.difficulty).aiEnergyInflow * coreMult * (1 + aiEnergyLevel * AI_ENERGY_PER_LEVEL);
    // AI POLITIKA: že določena zgoraj (aiAct) — 1P skripta / 2P igralec 2.
    const decided = aiAct;
    if (aiRobots > 0) {
      // 1) PRODUKCIJA: 2P gradi natanko izbrane enote; 1P nadomesti izgube do cilja.
      const rein = aiActionOverride
        ? aiBuild(aiUnits, aiEnergy, decided.production)
        : aiReinforce(aiUnits, aiEnergy, aiTargetArmy(state, state.totalRounds + 1));
      const built = totalAIRobots(rein.units) - aiRobots;
      aiUnits = rein.units; aiEnergy = rein.energy; aiRobots = totalAIRobots(aiUnits);
      if (built > 0) expeditionEvents.push(`⚡ AI je zgradil ${built} ${built === 1 ? 'enoto' : 'enot'}.`);
      // 2) NADGRADNJA: vloži presežek v dvig pritoka.
      if (decided.upgrade && aiEnergyLevel < AI_ENERGY_LEVEL_MAX && aiEnergy >= AI_ENERGY_LEVEL_COST) {
        aiEnergy -= AI_ENERGY_LEVEL_COST; aiEnergyLevel += 1;
        expeditionEvents.push(`⚙️ AI je nadgradil energijsko jedro (nivo ${aiEnergyLevel}) — odslej hitrejši pritok.`);
      }
      // 3) LABORATORIJ: vloži presežek v bojno nadgradnjo (napad ali obramba).
      if (decided.labTarget && aiEnergy >= AI_LAB_LEVEL_COST) {
        if (decided.labTarget === 'attack' && aiAttackLevel < AI_LAB_LEVEL_MAX) {
          aiEnergy -= AI_LAB_LEVEL_COST; aiAttackLevel += 1;
          expeditionEvents.push(`🧪 AI laboratorij: nadgradnja NAPADA (stopnja ${aiAttackLevel}).`);
        } else if (decided.labTarget === 'defense' && aiDefenseLevel < AI_LAB_LEVEL_MAX) {
          aiEnergy -= AI_LAB_LEVEL_COST; aiDefenseLevel += 1;
          expeditionEvents.push(`🧪 AI laboratorij: nadgradnja OBRAMBE (stopnja ${aiDefenseLevel}).`);
        }
      }
    }
    aiLastAction = { ...decided, upgrade: aiEnergyLevel > (state.aiEnergyLevel ?? 0) };
  }

  // Zmaga — AI popolnoma iztrebljen (tudi v fazi 1: če pobijemo vse izvidnike, AI ne more nadaljevati),
  // ali vse šibke točke izkoriščene.
  if (aiRobots <= 0 || aiWeakPoints.every(wp => wp.exploited)) {
    status = 'victory';
  }

  // Agregat igralčeve TAKTIKE za pregled ob koncu igre (po obdobjih, v jeziku genoma)
  const tacticsKey = (state.totalRounds > 36 ? 'assault' : state.phase) as 'find' | 'understand' | 'eliminate' | 'assault';
  const tPrev = state.tacticsByPhase ?? {};
  const tCur = tPrev[tacticsKey] ?? { months: 0, pop: 0, def: 0, forag: 0, wrk: 0, res: 0,
    scoutsSent: 0, attacksSent: 0, raidsFaced: 0, raidsRepelled: 0, wpDestroyed: 0 };
  const wpExploitedBefore = state.aiWeakPoints.filter(w => w.exploited).length;
  const wpExploitedNow = aiWeakPoints.filter(w => w.exploited).length;
  const newExpsIn = assignment.newExpeditions ?? [];
  const tacticsByPhase = { ...tPrev, [tacticsKey]: {
    months: tCur.months + 1,
    pop: tCur.pop + Math.max(0, state.population),
    def: tCur.def + (assignment.defenders ?? 0),
    forag: tCur.forag + (assignment.foragers ?? 0),
    wrk: tCur.wrk + (assignment.workers ?? 0),
    res: tCur.res + (assignment.researchers ?? 0),
    scoutsSent: tCur.scoutsSent + newExpsIn.filter(e => e.kind === 'scout').length,
    attacksSent: tCur.attacksSent + newExpsIn.filter(e => e.kind === 'mission').length,
    raidsFaced: tCur.raidsFaced + (raidLog?.occurred ? 1 : 0),
    raidsRepelled: tCur.raidsRepelled + (raidLog?.occurred && (raidLog.outcome === 'victory' || raidLog.outcome === 'partial') ? 1 : 0),
    wpDestroyed: tCur.wpDestroyed + Math.max(0, wpExploitedNow - wpExploitedBefore),
  } };

  const log: RoundLog = {
    round: state.round,
    phase: state.phase,
    assignment,
    aiUnitsBefore,
    aiUnitsAfter: { ...aiUnits },
    combat: combatLog,
    raid: raidLog,
    scout: scoutResult,
    resourceDelta: {
      survival: survival - state.resources.survival,
      combat: combat - state.resources.combat,
      intelligence: intelligence - state.resources.intelligence,
      material: material - (state.resources.material ?? 0),
    },
    populationDelta: (finalPopulation
      + tickedMissions.reduce((s, m) => s + m.assigned, 0)
      + tickedExps.reduce((s, e) => s + e.assigned, 0)
    ) - totalClanBefore,  // pravi delta klana (samo smrti/rojstva, ne premiki)
    clanActivityDelta: 0,
    aiKnowledgeDelta: finalAiKnowledge - state.aiKnowledge,
    revealedNodes: revealed,
    narrative: buildNarrative(assignment, combatLog, raidLog, scoutResult, revealed, phaseComplete, state.phase, [...expeditionEvents, ...workshopEvents]),
  };

  return {
    ...state,
    round,
    phase,
    raidPlan,
    artifactsCrafted,
    artifactsUsed,
    tacticsByPhase,
    totalRounds: state.totalRounds + 1,
    population: finalPopulation,
    maxPopulation: finalMaxPopulation,
    resources: { survival, combat, intelligence, material, artifacts },
    aiPhaseProgress: phaseComplete ? 0 : aiPhaseProgress,
    aiRobots,
    aiUnits,
    aiInsight,
    aiKnowledge: finalAiKnowledge,
    aiEnergy,
    aiEnergyLevel,
    aiAttackLevel,
    aiDefenseLevel,
    aiLastAction,
    aiTree: finalTree,
    aiWeakPoints,
    clanActivity,
    axisHistory: {
      ...axisHistory,
      [assignment.axis]: (axisHistory[assignment.axis] ?? 0) + 1,
    },
    activeMissions: tickedMissions,
    completedMissions: [...oldCompleted, ...newlyCompleted],
    consecutiveStarvationMonths: newStarvStreak,
    mapTiles,
    otherClans,
    expeditions: tickedExps,
    completedExpeditions: [...oldCompletedExps, ...finishedExps],
    weaponWorkshopProgress, weaponWorkshopScouts, wallProgress, wallsBuilt, artifactWorkshopProgress,
    robotsResearchLevel, robotsResearchProgress,
    weaponResearchLevel, weaponResearchProgress, wallResearchLevel, wallResearchProgress,
    rngCallCount: rng.calls,
    lastRoundLog: log,
    status,
  };
}

function nextPhase(current: AIPhase): AIPhase {
  if (current === 'find') return 'understand';
  if (current === 'understand') return 'eliminate';
  return 'eliminate';
}

function applyPhaseEvent(nodes: ReturnType<typeof generateAITree>, phase: AIPhase) {
  // Ko AI izvede fazni načrt, vozlišča te faze postanejo retroaktivno razkrita
  return nodes.map(n =>
    n.phase === phase ? revealNodeRetroactive(n) : n
  );
}

function buildNarrative(
  assignment: Assignment,
  combat: ReturnType<typeof resolveCombat>['result'] | null,
  raid: RaidResult | null,
  scout: ScoutResult | null,
  revealed: string[],
  phaseComplete: boolean,
  phase: AIPhase,
  expeditionEvents: string[] = []
): string {
  const parts: string[] = [];

  if (combat) {
    const outcome = combat.outcome;
    if (outcome === 'victory') parts.push('Napad uspel — AI je utrpel velike izgube.');
    else if (outcome === 'partial') parts.push('Napad delno uspel — preživeli smo, a z žrtvami.');
    else if (outcome === 'defeat') parts.push('Napad neuspešen — umaknili smo se z izgubami.');
    else parts.push('Pokol — napadalci so padli do zadnjega.');
  }

  if (raid && raid.occurred) {
    const o = raid.outcome;
    if (o === 'victory') {
      parts.push(`🛡️ DOMINACIJA OBRAMBE: AI je napadel kamp, obramba je IZTREBILA vseh ${raid.aiRobotsDestroyed} robotov${raid.defendersLost > 0 ? ` (${raid.defendersLost} branilcev padlo)` : ' brez večjih izgub'}. Noben robot se ni vrnil — AI ni dobil NOBENE informacije o kampu.`);
    } else {
      const areaLabels: Record<string, string> = { food: 'prehrano', workshop: 'delavnice', research: 'raziskave', defense: 'obrambo' };
      const breached = (raid.breachedAreas ?? []).map(a => areaLabels[a] ?? a);
      // žrtve po vlogah
      const losses: string[] = [];
      if (raid.defendersLost > 0)   losses.push(`${raid.defendersLost} branilcev`);
      if (raid.foragersLost > 0)    losses.push(`${raid.foragersLost} nabiralcev`);
      if (raid.workersLost > 0)     losses.push(`${raid.workersLost} delavcev`);
      if (raid.researchersLost > 0) losses.push(`${raid.researchersLost} raziskovalcev`);
      if (raid.hiddenLost > 0)      losses.push(`${raid.hiddenLost} skritih/prostih`);
      // uničeni viri
      const damage: string[] = [];
      if (raid.survivalDestroyed > 0) damage.push(`${raid.survivalDestroyed} hrane`);
      if (raid.weaponsDestroyed > 0)  damage.push(`${raid.weaponsDestroyed} orožja`);
      if (raid.materialDestroyed > 0) damage.push(`${raid.materialDestroyed} materiala`);
      if (raid.wallsDestroyed > 0)    damage.push(`${raid.wallsDestroyed} stopnjo obzidja`);
      const verb = o === 'annihilation' ? 'je opustošil kamp' : 'je prebil obrambo';
      let msg = o === 'annihilation'
        ? `☠ AI DOMINACIJA: ${verb} — obramba je bila iztrebljena do zadnjega`
        : `AI ${verb}`;
      if (breached.length) msg += ` (prizadeta: ${breached.join(', ')})`;
      if (losses.length) msg += ` — padlo ${losses.join(', ')}`;
      if (damage.length) msg += `; uničeno ${damage.join(', ')}`;
      if (raid.aiInfoGained > 0) msg += `. Preživeli roboti so AI-ju prinesli informacije o kampu (+${Math.round(raid.aiInfoGained * 100)} % AI ve)`;
      parts.push(msg + '.');
    }
  }

  if (scout?.captured) {
    parts.push(`AI je ujel izvidniško skupino — ${scout.scoutsLost} izvidnikov ni preživelo.`);
  } else if (scout && scout.effectivenessMult < 1.0 && (assignment?.scouts ?? 0) > 0) {
    parts.push('Izvidniki so morali prekiniti misijo — donos je bil manjši.');
  }

  if (revealed.length > 0) {
    parts.push(`Špijoni so razkrili ${revealed.length} novo(e) vozlišče(a) v AI načrtu.`);
  }
  // Dogodki odprav (vrnitve, izgube, srečanja)
  for (const ev of expeditionEvents) parts.push(ev);

  if (phaseComplete) {
    const phaseLabels: Record<AIPhase, string> = {
      find: 'iskanje',
      understand: 'razumevanje',
      eliminate: 'iztrebljanje',
    };
    parts.push(`AI je zaključil fazo ${phaseLabels[phase]}. Nova faza se začne.`);
  }

  return parts.join('\n') || 'Mesec je minil mirno.';
}

// ─── Pomožne funkcije za UI ───────────────────────────────────────────────────

// Izračun obeta za dano dodelitev — UI prikaže pred akcijo
export function previewOdds(state: GameState, assignment: Assignment) {
  const intelB = intelCombatBonus(state);
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase, weaponEffectMult(state.difficulty, state.weaponResearchLevel ?? 0)) * (1 + intelB) * (1 + logicalWeaknessBonus(state));
  const aiStr = calcAIStrength(state, state.phase);
  const p = calcSuccessProbability(humanStr, aiStr);

  const missionPreviews: Record<string, { successProbability: number; encounterPerMonth: number; monthsTotal: number }> = {};

  return {
    successProbability: p,
    mAxisModifier: 1.0,
    humanStrength: humanStr,
    aiStrength: aiStr,
    raidProbability: raidProbability(state),
    raidRepelProbability: raidRepelProbability(state, assignment),
    scoutSuccessProbability: scoutSuccessProbability(state, assignment),
    scoutCaptureProbability: scoutCaptureProbability(state, assignment),
    forageSafetyProbability: forageSafetyProbability(state, assignment),
    intelBonus: intelB,
    weaponCap: weaponCap(state),
    missionPreviews,
  };
}
