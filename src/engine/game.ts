// Glavni game engine — čiste funkcije (state, action) → new state
// Brez side effectov, brez IO

import type { GameState, PlayerAction, RoundLog, Assignment, AIPhase, RaidResult, ScoutResult, HumanAxis, Mission } from './types.js';
import type { RNGState } from './rng.js';
import { createRNG, rngBool, rngInt, rngNext, seedFromString } from './rng.js';
import { resolveCombat } from './combat.js';
import { spendIntelOnFog, revealNodeRetroactive } from './fog.js';
import { generateMap, spendScoutsOnMap } from './map.js';
import { tileId } from './types.js';
import { calcAISurveillanceGain, adaptGenome, generateAITree, generateAIWeakPoints, DEFAULT_GENOME } from './ai-brain.js';
import {
  INITIAL_POPULATION, INITIAL_SURVIVAL, INITIAL_COMBAT, INITIAL_INTELLIGENCE,
  INITIAL_AI_ROBOTS, INITIAL_AI_KNOWLEDGE, INITIAL_CLAN_ACTIVITY,
  ROUNDS_PER_PHASE, SURVIVAL_PER_PERSON_PER_ROUND, FORAGER_YIELD,
  SCOUT_INTEL_YIELD, SCOUT_FOG_YIELD, CLAN_ACTIVITY_BY_PHASE, CLAN_ACTIVITY_EXPOSURE_MODIFIER,
  CLAN_ACTIVITY_HIDDEN_MODIFIER, PHASE_EVENT_BASE_DAMAGE, PREPARED_DAMAGE_REDUCTION,
  M_OS, RATIONS_LEVELS, DEFAULT_RATIONS,
  RAID_BASE_CHANCE, RAID_POP_SCALING_MAX, RAID_POP_REFERENCE, RAID_AI_KNOWLEDGE_BONUS,
  RAID_HIDING_REDUCTION, RAID_CLAN_ABSORPTION, RAID_AI_FORCE_PCT, DEFENDER_EQUIPMENT_MULT,
  SCOUT_BASE_SUCCESS, SCOUT_INTEL_BONUS_PER_100, SCOUT_ESPIONAGE_BONUS,
  SCOUT_CAPTURE_BASE, SCOUT_CAPTURE_PER_SCOUT, SCOUT_HIDING_REDUCTION, SCOUT_AI_KNOWLEDGE_BONUS,
  SCOUT_PARTIAL_EFFECTIVE, SCOUT_CAPTURED_LOSS_MIN, SCOUT_CAPTURED_LOSS_MAX,
  COMBAT_BASE_HUMAN_MULTIPLIER, AI_ROBOT_STRENGTH, VICTORY_THRESHOLD, PARTIAL_THRESHOLD, DEFEAT_THRESHOLD,
  STARVATION_LOSS_PCT_1ST, STARVATION_LOSS_PCT_2ND, STARVATION_LOSS_PCT_NTH,
  INTEL_COMBAT_BONUS_PER_100, INTEL_COMBAT_BONUS_MAX,
  WEAPON_DESTROY_MIN_PCT, WEAPON_DESTROY_MAX_PCT,
  MISSION_DURATION_MONTHS, MISSION_ENCOUNTER_BASE, MISSION_ENCOUNTER_PER_PERSON,
  MISSION_ENCOUNTER_AI_KNOW, MISSION_WP_DIFFICULTY, MISSION_MIN_TEAM,
} from './constants.js';
import { calcHumanStrength, calcAIStrength, calcSuccessProbability } from './combat.js';

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
  const h = state.axisHistory ?? { hiding: 0, espionage: 0, defense: 0 };
  // Os, v katero smo največ vlagali, je trenutna "preferenca"
  const max = Math.max(h.hiding ?? 0, h.espionage ?? 0, h.defense ?? 0);
  if ((h.hiding ?? 0) === max) return 'hiding';
  if ((h.espionage ?? 0) === max) return 'espionage';
  return 'defense';
}

/** Verjetnost, da AI najde in napade kamp v tej rundi. */
export function raidProbability(state: GameState, axis: HumanAxis): number {
  const popFactor = Math.min(1, state.population / RAID_POP_REFERENCE);
  let p = RAID_BASE_CHANCE
    + RAID_POP_SCALING_MAX * popFactor
    + RAID_AI_KNOWLEDGE_BONUS * state.aiKnowledge;
  if (axis === 'hiding') p *= (1 - RAID_HIDING_REDUCTION);
  p *= (1 - state.clanActivity * RAID_CLAN_ABSORPTION);
  return Math.max(0, Math.min(1, p));
}

/** Verjetnost, da obramba odbije napad ob danem času dneva.
 *  Branilci, ki spijo, se borijo le s ~30 % polne moči (zbujeni, slabo opremljeni). */
export function raidRepelProbability(state: GameState, assignment: Assignment, timeOfDay: 'day' | 'night' = 'day'): number {
  const awake = timeOfDay === 'day' ? assignment.dayGuard : assignment.nightGuard;
  const asleep = timeOfDay === 'day' ? assignment.nightGuard : assignment.dayGuard;
  if (awake + asleep <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const axisH = state.axisHistory ?? { hiding: 0, espionage: 0, defense: 0 };
  const defenseLvl = Math.floor((axisH.defense ?? 0) / 3);
  const intelB = intelCombatBonus(state);
  const awakeStr = awake * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult * (1 + 0.10 * defenseLvl);
  const sleepStr = asleep * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult * 0.30;
  const equip = Math.min(state.resources.combat, awake + asleep) * DEFENDER_EQUIPMENT_MULT;
  const defStr = (awakeStr + sleepStr + equip) * (1 + intelB);
  const aiForce = Math.floor(state.aiRobots * (1 - state.clanActivity) * RAID_AI_FORCE_PCT);
  const aiStr = aiForce * AI_ROBOT_STRENGTH;
  return defStr / (defStr + Math.max(1, aiStr));
}

/** Verjetnost, da izvidniki vrnejo s polnim donosom. */
export function scoutSuccessProbability(state: GameState, assignment: Assignment): number {
  if (assignment.scouts <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  let p = SCOUT_BASE_SUCCESS
    + SCOUT_INTEL_BONUS_PER_100 * (state.resources.intelligence / 100)
    + (tier.strengthMult - 1.0) * 0.5;
  if (assignment.axis === 'espionage') p += SCOUT_ESPIONAGE_BONUS;
  return Math.max(0, Math.min(0.98, p));
}

/** Verjetnost, da AI ujame izvidnike. */
export function scoutCaptureProbability(state: GameState, assignment: Assignment): number {
  if (assignment.scouts <= 0) return 0;
  let p = SCOUT_CAPTURE_BASE
    + SCOUT_CAPTURE_PER_SCOUT * assignment.scouts
    + SCOUT_AI_KNOWLEDGE_BONUS * state.aiKnowledge;
  if (assignment.axis === 'hiding') p *= (1 - SCOUT_HIDING_REDUCTION);
  return Math.max(0, Math.min(0.80, p));
}

/** Pričakovana varnost za nabiralce (in spečo stražo). */
export function forageSafetyProbability(state: GameState, assignment: Assignment): number {
  const pRaid = raidProbability(state, assignment.axis);
  // Predpostavi povprečje dan/noč
  const pRepelAvg = (raidRepelProbability(state, assignment, 'day') + raidRepelProbability(state, assignment, 'night')) / 2;
  return Math.max(0, Math.min(1, 1 - pRaid * (1 - pRepelAvg)));
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
export function missionSuccessProbability(state: GameState, weakPointId: string, assigned: number, rationsLevel: number = DEFAULT_RATIONS): number {
  if (assigned < MISSION_MIN_TEAM) return 0;
  const diff = MISSION_WP_DIFFICULTY[weakPointId] ?? 100;
  const tier = RATIONS_LEVELS[rationsLevel] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const equip = Math.min(state.resources.combat, assigned);
  const teamPower = (Math.sqrt(assigned) * COMBAT_BASE_HUMAN_MULTIPLIER * 8 + equip * 1.2) * tier.strengthMult;
  const intelB = intelCombatBonus(state);
  return (teamPower * (1 + intelB)) / (teamPower * (1 + intelB) + diff);
}

type Outcome = 'victory' | 'partial' | 'defeat' | 'annihilation';
function outcomeFromP(p: number): Outcome {
  if (p >= VICTORY_THRESHOLD) return 'victory';
  if (p >= PARTIAL_THRESHOLD) return 'partial';
  if (p >= DEFEAT_THRESHOLD)  return 'defeat';
  return 'annihilation';
}

/** Resolve raid — z dnem/nočjo + uničenjem orožja v skladišču. */
function resolveRaid(
  state: GameState, assignment: Assignment, rng: RNGState
): { result: RaidResult; rng: RNGState } {
  // Roll dan/noč
  const [todRoll, rng2] = rngNext(rng); rng = rng2;
  const timeOfDay: 'day' | 'night' = todRoll < 0.5 ? 'day' : 'night';
  const awake = timeOfDay === 'day' ? assignment.dayGuard : assignment.nightGuard;
  const asleep = timeOfDay === 'day' ? assignment.nightGuard : assignment.dayGuard;

  const p = raidRepelProbability(state, assignment, timeOfDay);
  const outcome = outcomeFromP(p);
  const aiForce = Math.floor(state.aiRobots * (1 - state.clanActivity) * RAID_AI_FORCE_PCT);

  let defendersLost = 0, sleepersLost = 0, foragersLost = 0, aiRobotsDestroyed = 0;
  switch (outcome) {
    case 'victory':
      defendersLost     = Math.floor(awake * 0.05);
      sleepersLost      = Math.floor(asleep * 0.05);
      foragersLost      = 0;
      aiRobotsDestroyed = Math.floor(aiForce * 0.80);
      break;
    case 'partial':
      defendersLost     = Math.floor(awake * 0.25);
      sleepersLost      = Math.floor(asleep * 0.40);
      foragersLost      = Math.floor(assignment.foragers * 0.15);
      aiRobotsDestroyed = Math.floor(aiForce * 0.35);
      break;
    case 'defeat':
      defendersLost     = Math.floor(awake * 0.60);
      sleepersLost      = Math.floor(asleep * 0.80);
      foragersLost      = Math.floor(assignment.foragers * 0.40);
      aiRobotsDestroyed = Math.floor(aiForce * 0.12);
      break;
    case 'annihilation':
      defendersLost     = awake;
      sleepersLost      = asleep;
      foragersLost      = Math.floor(assignment.foragers * 0.70);
      aiRobotsDestroyed = Math.floor(aiForce * 0.03);
      break;
  }

  // Uničenje orožja v skladišču (kar ni v rabi, ko napadejo)
  const weaponsInUse = awake + asleep + assignment.combatants;
  const weaponsIdle  = Math.max(0, state.resources.combat - weaponsInUse);
  let weaponsDestroyed = 0;
  if (weaponsIdle > 0) {
    const [pctRoll, rng3] = rngInt(rng, WEAPON_DESTROY_MIN_PCT * 100, WEAPON_DESTROY_MAX_PCT * 100);
    rng = rng3;
    weaponsDestroyed = Math.floor(weaponsIdle * pctRoll / 100);
  }

  return {
    result: {
      occurred: true, outcome, timeOfDay,
      defendersLost, sleepersLost, foragersLost, aiRobotsDestroyed, weaponsDestroyed,
      successProbability: p,
    },
    rng,
  };
}

// ─── Inicializacija nove linije ───────────────────────────────────────────────

export function newGame(seed?: number): GameState {
  const runId = Date.now().toString(36);
  const rngSeed = seed ?? seedFromString(runId);

  return {
    round: 1,
    phase: 'find',
    totalRounds: 1,
    population: INITIAL_POPULATION,
    maxPopulation: INITIAL_POPULATION,
    resources: {
      survival: INITIAL_SURVIVAL,
      combat: INITIAL_COMBAT,
      intelligence: INITIAL_INTELLIGENCE,
    },
    aiPhaseProgress: 0,
    aiRobots: INITIAL_AI_ROBOTS,
    aiKnowledge: INITIAL_AI_KNOWLEDGE,
    aiTree: generateAITree(),
    aiWeakPoints: generateAIWeakPoints(),
    clanActivity: INITIAL_CLAN_ACTIVITY,
    axisHistory: { hiding: 0, espionage: 0, defense: 0 },
    activeMissions: [],
    completedMissions: [],
    consecutiveStarvationMonths: 0,
    mapTiles: generateMap(),
    rngSeed,
    rngCallCount: 0,
    lastRoundLog: null,
    status: 'active',
    runId,
  };
}

// ─── Mesečna zanka ─────────────────────────────────────────────────────────────

export function processRound(state: GameState, action: PlayerAction): GameState {
  if (state.status !== 'active') return state;

  let rng: RNGState = { seed: state.rngSeed, calls: state.rngCallCount };
  const { assignment: rawAssignment, targetWeakPoint } = action;

  // Normaliziraj — backward compat in clamp na orožje
  const cap = Math.floor(state.resources.combat);
  // dayGuard + nightGuard + combatants ≤ orožje
  const wantedDay   = rawAssignment.dayGuard   ?? 0;
  const wantedNight = rawAssignment.nightGuard ?? 0;
  const wantedCombat = rawAssignment.combatants ?? 0;
  const totalArmed = wantedDay + wantedNight + wantedCombat;
  let assignment: Assignment;
  if (totalArmed > cap && totalArmed > 0) {
    const k = cap / totalArmed;
    assignment = {
      ...rawAssignment,
      combatants: Math.floor(wantedCombat * k),
      dayGuard:   Math.floor(wantedDay * k),
      nightGuard: Math.floor(wantedNight * k),
    };
  } else {
    assignment = { ...rawAssignment, combatants: wantedCombat, dayGuard: wantedDay, nightGuard: wantedNight };
  }

  // 0. Človekovo drevo napredka — bonusi iz zgodovine osi
  const axisHistory = state.axisHistory ?? { hiding: 0, espionage: 0, defense: 0 };
  const hidingLvl    = Math.floor((axisHistory.hiding    ?? 0) / 3);
  const espionageLvl = Math.floor((axisHistory.espionage ?? 0) / 3);
  const defenseLvl   = Math.floor((axisHistory.defense   ?? 0) / 3);

  // 0.5. Obroki — vplivajo na porabo hrane, na moč ljudi in na rast populacije
  const rations = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];

  // 1. Preživetveni resursi — populacija poje hrano (skalirano z obroki)
  const survivalCost = Math.round(state.population * SURVIVAL_PER_PERSON_PER_ROUND * rations.foodMult);
  let survival = state.resources.survival - survivalCost;

  // 2. Forageri zbirajo preživetvene vire (učinkovitost skalirana z močjo iz obrokov)
  const foraged = Math.floor(assignment.foragers * FORAGER_YIELD * rations.strengthMult);
  survival += foraged;
  survival = Math.max(0, survival);

  // 3. IZVIDNIKI — kotaljenje uspeha in možno ujetje
  let scoutResult: ScoutResult = { captured: false, scoutsLost: 0, effectivenessMult: 1.0 };
  let effectiveScouts = assignment.scouts;
  if (assignment.scouts > 0) {
    const captureProb = scoutCaptureProbability(state, assignment);
    const [captureRoll, rngA] = rngNext(rng); rng = rngA;
    if (captureRoll < captureProb) {
      // Ujeti
      const [pctRoll, rngB] = rngInt(rng, SCOUT_CAPTURED_LOSS_MIN * 100, SCOUT_CAPTURED_LOSS_MAX * 100);
      rng = rngB;
      const lost = Math.floor(assignment.scouts * (pctRoll / 100));
      effectiveScouts = Math.max(0, assignment.scouts - lost);
      scoutResult = { captured: true, scoutsLost: lost, effectivenessMult: SCOUT_PARTIAL_EFFECTIVE };
    } else {
      const successProb = scoutSuccessProbability(state, assignment);
      const [successRoll, rngC] = rngNext(rng); rng = rngC;
      scoutResult = {
        captured: false, scoutsLost: 0,
        effectivenessMult: successRoll < successProb ? 1.0 : SCOUT_PARTIAL_EFFECTIVE,
      };
    }
  }

  // Donos izvidnikov skaliran z uspehom misije
  const intelGained = Math.floor(effectiveScouts * SCOUT_INTEL_YIELD * rations.strengthMult * scoutResult.effectivenessMult);
  let intelligence = state.resources.intelligence + intelGained;

  // 4. Izvidniki — razdelitev moči po izbranem cilju
  const scoutObjective = assignment.scoutPlan?.objective ?? 'ai_weakpoints';
  const fogEfficiency = assignment.axis === 'espionage' ? M_OS[state.phase].espionage : 0.15;
  const espionageBonus = 1 + 0.20 * espionageLvl;
  const totalScoutBudget = Math.floor(effectiveScouts * SCOUT_FOG_YIELD * fogEfficiency * espionageBonus * rations.strengthMult * scoutResult.effectivenessMult);

  let aiTree = state.aiTree;
  let revealed: string[] = [];
  let mapTiles = state.mapTiles ?? generateMap();
  let revealedTileIds: string[] = [];

  if (scoutObjective === 'ai_weakpoints') {
    // Obstoječe vedenje — fog clearing AI tree
    const r = spendIntelOnFog(aiTree, totalScoutBudget);
    aiTree = r.nodes;
    revealed = r.revealed;
  } else if (scoutObjective === 'map') {
    // Razkrivanje izbranih heksov
    const targetIds = assignment.scoutPlan?.targetTileIds ?? [];
    const m = spendScoutsOnMap(mapTiles, targetIds, totalScoutBudget);
    mapTiles = m.tiles;
    revealedTileIds = m.revealed;
  } else if (scoutObjective === 'ai_robots') {
    // Recon na AI robote — dodaj intel (bonus k bojem skozi intel coef)
    // Vsa moč izvidnikov gre v intel (poleg že prištetega)
    intelligence += Math.floor(totalScoutBudget * 0.6);
  }

  // 5. Šibke točke — odkrijemo, če smo dovolj razkrili sosednje vozlišče
  // ALI če smo razkrili heks na mapi, ki skriva to šibko točko
  const aiWeakPoints = state.aiWeakPoints.map(wp => {
    if (wp.discovered) return wp;
    const relatedRevealed = aiTree.some(n => n.phase === wp.phase && n.visibility === 'revealed');
    const mapRevealed = mapTiles.some(t => t.hidesWeakPointId === wp.id && t.visibility === 'revealed');
    return (relatedRevealed || mapRevealed) ? { ...wp, discovered: true } : wp;
  });

  // 6a. NAPAD (offensive combat — combatants gredo udariti AI)
  let combat = state.resources.combat;
  let population = state.population;
  let aiRobots = state.aiRobots;
  let aiKnowledge = state.aiKnowledge;
  let combatLog = null;
  let scoutsKilled = scoutResult.scoutsLost;

  const isExploiting = targetWeakPoint
    ? aiWeakPoints.some(wp => wp.id === targetWeakPoint && wp.discovered)
    : false;

  if (assignment.combatants > 0) {
    const { result, rng: rngAfter } = resolveCombat(state, assignment, rng, isExploiting);
    rng = rngAfter;
    combatLog = result;

    const defenseSave = Math.floor(result.humanLost * 0.10 * defenseLvl);
    const actualHumanLost = Math.max(0, result.humanLost - defenseSave);
    population -= actualHumanLost;
    if (defenseSave > 0) combatLog = { ...result, humanLost: actualHumanLost };
    // Smrti v napadu = izguba orožja (1 padel = 1 izgubljeno orožje)
    combat = Math.max(0, combat - actualHumanLost);
    aiRobots = Math.max(0, aiRobots - result.aiRobotsDestroyed);
    aiKnowledge = Math.min(1, aiKnowledge + result.aiInfoGained);
    intelligence += result.infoGained;
    combat = Math.max(0, combat + (result.spoils.combat ?? 0));
    intelligence += result.spoils.intelligence ?? 0;

    if (isExploiting && result.outcome === 'victory') {
      const idx = aiWeakPoints.findIndex(wp => wp.id === targetWeakPoint);
      if (idx >= 0) aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true };
    }
  }

  // 6b. RAID — AI najde kamp z neko verjetnostjo
  let raidLog: RaidResult | null = null;
  const pRaid = raidProbability(state, assignment.axis);
  const [raidRoll, rngR1] = rngNext(rng); rng = rngR1;
  if (raidRoll < pRaid) {
    const { result: raidRes, rng: rngR2 } = resolveRaid(state, assignment, rng);
    rng = rngR2;
    raidLog = raidRes;
    const defSave = Math.floor((raidRes.defendersLost + raidRes.sleepersLost) * 0.10 * defenseLvl);
    const totalGuardLost = Math.max(0, raidRes.defendersLost + raidRes.sleepersLost - defSave);
    const forSave = Math.floor(raidRes.foragersLost  * 0.10 * defenseLvl);
    const actualFor = Math.max(0, raidRes.foragersLost  - forSave);
    population -= totalGuardLost + actualFor;
    // Smrti branilcev → izguba orožja
    combat = Math.max(0, combat - totalGuardLost);
    // Uničeno orožje v skladišču
    combat = Math.max(0, combat - raidRes.weaponsDestroyed);
    aiRobots = Math.max(0, aiRobots - raidRes.aiRobotsDestroyed);
    if (defSave > 0 || forSave > 0) {
      // Proporcionalno zmanjšaj logirana stanja
      const k1 = (raidRes.defendersLost + raidRes.sleepersLost) > 0
        ? Math.max(0, raidRes.defendersLost + raidRes.sleepersLost - defSave) / (raidRes.defendersLost + raidRes.sleepersLost)
        : 1;
      raidLog = {
        ...raidRes,
        defendersLost: Math.floor(raidRes.defendersLost * k1),
        sleepersLost:  Math.floor(raidRes.sleepersLost  * k1),
        foragersLost:  actualFor,
      };
    }
    aiKnowledge = Math.min(1, aiKnowledge + (raidRes.outcome === 'victory' ? 0.03 : raidRes.outcome === 'partial' ? 0.07 : 0.15));
  } else {
    raidLog = { occurred: false, outcome: null, timeOfDay: null,
      defendersLost: 0, sleepersLost: 0, foragersLost: 0,
      aiRobotsDestroyed: 0, weaponsDestroyed: 0,
      successProbability: (raidRepelProbability(state, assignment, 'day') + raidRepelProbability(state, assignment, 'night')) / 2 };
  }

  // 6c. Pop loss od ujetih izvidnikov
  population -= scoutsKilled;

  // 6d. MISIJE — tikni aktivne misije + obravnavaj nove razporeditve
  const oldMissions = state.activeMissions ?? [];
  const oldCompleted = state.completedMissions ?? [];
  const tickedMissions: Mission[] = [];
  const newlyCompleted: Mission[] = [];
  const missionRationsMap = assignment.missionRations ?? {};

  for (const m of oldMissions) {
    // Posodobi obroke misije iz trenutne izbire (default na prejšnje)
    const mRationsLvl = missionRationsMap[m.weakPointId] ?? m.rations ?? DEFAULT_RATIONS;
    const mTier = RATIONS_LEVELS[mRationsLvl] ?? RATIONS_LEVELS[DEFAULT_RATIONS];

    // Strošek hrane za misijo (poje iz skupne zaloge)
    const mFoodCost = Math.round(m.assigned * SURVIVAL_PER_PERSON_PER_ROUND * mTier.foodMult);
    survival = Math.max(0, survival - mFoodCost);

    // Encounter roll vsak mesec
    const encP = missionEncounterProbability(state, m.assigned);
    const [encRoll, rngM] = rngNext(rng); rng = rngM;
    let assignedNow = m.assigned;
    if (encRoll < encP) {
      const [lossPct, rngMl] = rngInt(rng, 20, 60); rng = rngMl;
      const lost = Math.floor(m.assigned * lossPct / 100);
      population -= lost;
      combat = Math.max(0, combat - lost);
      assignedNow = Math.max(0, m.assigned - lost);
      if (assignedNow < MISSION_MIN_TEAM) {
        newlyCompleted.push({ ...m, assigned: assignedNow, monthsRemaining: 0, rations: mRationsLvl, status: 'aborted',
          resultNarrative: `Odprava prekinjena — AI je razkril ekipo, ${lost} mrtvih.` });
        continue;
      }
    }
    const remaining = m.monthsRemaining - 1;
    if (remaining <= 0) {
      const finalP = missionSuccessProbability({ ...state, resources: { ...state.resources, intelligence } }, m.weakPointId, assignedNow, mRationsLvl);
      const [fRoll, rngF] = rngNext(rng); rng = rngF;
      if (fRoll < finalP) {
        newlyCompleted.push({ ...m, assigned: assignedNow, monthsRemaining: 0, rations: mRationsLvl, status: 'success',
          resultNarrative: `Odprava na ${m.weakPointId} uspela.` });
        const idx = aiWeakPoints.findIndex(wp => wp.id === m.weakPointId);
        if (idx >= 0) aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true, discovered: true };
      } else {
        const [lossPct, rngL] = rngInt(rng, 30, 70); rng = rngL;
        const lost = Math.floor(assignedNow * lossPct / 100);
        population -= lost;
        combat = Math.max(0, combat - lost);
        newlyCompleted.push({ ...m, assigned: Math.max(0, assignedNow - lost), monthsRemaining: 0, rations: mRationsLvl, status: 'failed',
          resultNarrative: `Odprava na ${m.weakPointId} ni uspela — ${lost} padlih.` });
      }
      continue;
    }
    // Posodobi successProbability glede na trenutne pogoje
    const updatedSP = missionSuccessProbability({ ...state, resources: { ...state.resources, intelligence } }, m.weakPointId, assignedNow, mRationsLvl);
    tickedMissions.push({ ...m, assigned: assignedNow, monthsRemaining: remaining, rations: mRationsLvl, successProbability: updatedSP });
  }

  // Nove misije iz assignment.missionAssignments
  const newMissionAssigns = assignment.missionAssignments ?? {};
  for (const [wpId, ppl] of Object.entries(newMissionAssigns)) {
    if (ppl < MISSION_MIN_TEAM) continue;
    if (tickedMissions.some(m => m.weakPointId === wpId)) continue;
    if (oldCompleted.some(m => m.weakPointId === wpId && m.status === 'success')) continue;
    const wp = aiWeakPoints.find(w => w.id === wpId);
    if (!wp || !wp.discovered || wp.exploited) continue;
    const dur = MISSION_DURATION_MONTHS[wpId] ?? 4;
    const mRationsLvl = missionRationsMap[wpId] ?? DEFAULT_RATIONS;
    const mTier = RATIONS_LEVELS[mRationsLvl] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
    // Strošek hrane tudi pri startu
    const mFoodCost = Math.round(ppl * SURVIVAL_PER_PERSON_PER_ROUND * mTier.foodMult);
    survival = Math.max(0, survival - mFoodCost);
    const sp = missionSuccessProbability({ ...state, resources: { ...state.resources, intelligence } }, wpId, ppl, mRationsLvl);
    tickedMissions.push({ weakPointId: wpId, assigned: ppl, monthsTotal: dur, monthsRemaining: dur,
      successProbability: sp, rations: mRationsLvl, status: 'in_progress' });
  }

  // 7. Klan aktivnost — krivulja + vedenjski modifikator
  // Hiding lvl bonus: 25 % počasnejši padec na nivo
  // Skrivamo se le če ni ofenzivnih akcij ven (combatants+scouts majhni)
  const isHiding = assignment.axis === 'hiding' && assignment.combatants < 5 && assignment.scouts < 8;
  const rawClanDelta = isHiding
    ? -CLAN_ACTIVITY_HIDDEN_MODIFIER
    : -CLAN_ACTIVITY_EXPOSURE_MODIFIER;
  const clanDelta = rawClanDelta * Math.max(0, 1 - 0.25 * hidingLvl);
  const clanActivity = Math.max(0, state.clanActivity + clanDelta);

  // 8. AI surveillance gain (skupna izpostavljenost: combatants + scouts)
  const exposure = (assignment.combatants + assignment.scouts) / Math.max(1, state.population);
  const aiKnowledgeGain = calcAISurveillanceGain(DEFAULT_GENOME, clanActivity, exposure);
  const finalAiKnowledge = Math.min(1, aiKnowledge + aiKnowledgeGain);

  // 9. Stopnjevana lakota — če hrana pade pod 0, izgubljamo % populacije
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

  // 10. Statusni check
  let status: GameState['status'] = state.status;
  if (finalPopulation <= 0) status = 'defeat_extinction';
  else if (finalAiKnowledge >= 1.0 && state.phase === 'eliminate') {
    status = 'defeat_overwhelmed';
  }

  // 11. Fazni napredek in morebitni prehod
  const aiPhaseProgress = state.aiPhaseProgress + 1;
  const phaseComplete = aiPhaseProgress >= ROUNDS_PER_PHASE;

  const round = state.round < ROUNDS_PER_PHASE ? state.round + 1 : 1;
  const phase = phaseComplete ? nextPhase(state.phase) : state.phase;

  // Fazni razplet — AI izvede načrt
  let finalTree = aiTree;
  if (phaseComplete && state.phase !== 'eliminate') {
    finalTree = applyPhaseEvent(aiTree, state.phase);
  }

  // Zmaga — AI iztrebljen ali vsi weak points exploited
  if (aiRobots <= 0 || aiWeakPoints.every(wp => wp.exploited)) {
    status = 'victory';
  }

  const log: RoundLog = {
    round: state.round,
    phase: state.phase,
    assignment,
    combat: combatLog,
    raid: raidLog,
    scout: scoutResult,
    resourceDelta: {
      survival: survival - state.resources.survival,
      combat: combat - state.resources.combat,
      intelligence: intelligence - state.resources.intelligence,
    },
    populationDelta: finalPopulation - state.population,
    clanActivityDelta: clanActivity - state.clanActivity,
    aiKnowledgeDelta: finalAiKnowledge - state.aiKnowledge,
    revealedNodes: revealed,
    narrative: buildNarrative(assignment, combatLog, raidLog, scoutResult, revealed, phaseComplete, state.phase),
  };

  return {
    ...state,
    round,
    phase,
    totalRounds: state.totalRounds + 1,
    population: finalPopulation,
    maxPopulation: finalMaxPopulation,
    resources: { survival, combat, intelligence },
    aiPhaseProgress: phaseComplete ? 0 : aiPhaseProgress,
    aiRobots,
    aiKnowledge: finalAiKnowledge,
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
  phase: AIPhase
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
    if (o === 'victory') parts.push(`AI je napadel kamp, a obramba ga je odbila (${raid.defendersLost} branilcev padlo).`);
    else if (o === 'partial') parts.push(`AI je napadel kamp — odbili smo, a ${raid.defendersLost} branilcev in ${raid.foragersLost} nabiralcev je padlo.`);
    else if (o === 'defeat') parts.push(`AI je napadel kamp in prebil obrambo — izgubili smo ${raid.defendersLost} branilcev in ${raid.foragersLost} nabiralcev.`);
    else if (o === 'annihilation') parts.push(`AI je opustošil kamp — vsi branilci so padli, ${raid.foragersLost} nabiralcev je umrlo.`);
  }

  if (scout?.captured) {
    parts.push(`AI je ujel izvidniško skupino — ${scout.scoutsLost} izvidnikov ni preživelo.`);
  } else if (scout && scout.effectivenessMult < 1.0 && (assignment?.scouts ?? 0) > 0) {
    parts.push('Izvidniki so morali prekiniti misijo — donos je bil manjši.');
  }

  if (revealed.length > 0) {
    parts.push(`Špijoni so razkrili ${revealed.length} novo(e) vozlišče(a) v AI načrtu.`);
  }
  // (Razkriti heksi se izrišejo na mapi — narativa jih ne podvaja)

  if (phaseComplete) {
    const phaseLabels: Record<AIPhase, string> = {
      find: 'iskanje',
      understand: 'razumevanje',
      eliminate: 'iztrebljanje',
    };
    parts.push(`AI je zaključil fazo ${phaseLabels[phase]}. Nova faza se začne.`);
  }

  return parts.join(' ') || 'Mesec je minil mirno.';
}

// ─── Pomožne funkcije za UI ───────────────────────────────────────────────────

// Izračun obeta za dano dodelitev — UI prikaže pred akcijo
export function previewOdds(state: GameState, assignment: Assignment) {
  const intelB = intelCombatBonus(state);
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase) * (1 + intelB);
  const aiStr = calcAIStrength(state, state.phase);
  const p = calcSuccessProbability(humanStr, aiStr);

  const missionPreviews: Record<string, { successProbability: number; encounterPerMonth: number; monthsTotal: number }> = {};
  const want = assignment.missionAssignments ?? {};
  const wantR = assignment.missionRations ?? {};
  // Za aktivne misije uporabimo dejansko stanje
  const activeById: Record<string, Mission> = {};
  for (const m of state.activeMissions ?? []) activeById[m.weakPointId] = m;
  for (const wp of state.aiWeakPoints) {
    const active = activeById[wp.id];
    const ppl = active ? active.assigned : (want[wp.id] ?? 0);
    const r = wantR[wp.id] ?? active?.rations ?? DEFAULT_RATIONS;
    const dur = MISSION_DURATION_MONTHS[wp.id] ?? 4;
    missionPreviews[wp.id] = {
      successProbability: missionSuccessProbability(state, wp.id, ppl, r),
      encounterPerMonth:  missionEncounterProbability(state, ppl),
      monthsTotal: dur,
    };
  }

  return {
    successProbability: p,
    mAxisModifier: 1.0,
    humanStrength: humanStr,
    aiStrength: aiStr,
    raidProbability: raidProbability(state, assignment.axis),
    raidRepelProbability: (raidRepelProbability(state, assignment, 'day') + raidRepelProbability(state, assignment, 'night')) / 2,
    scoutSuccessProbability: scoutSuccessProbability(state, assignment),
    scoutCaptureProbability: scoutCaptureProbability(state, assignment),
    forageSafetyProbability: forageSafetyProbability(state, assignment),
    intelBonus: intelB,
    weaponCap: weaponCap(state),
    missionPreviews,
  };
}
