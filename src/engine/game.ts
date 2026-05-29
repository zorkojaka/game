// Glavni game engine — čiste funkcije (state, action) → new state
// Brez side effectov, brez IO

import type { GameState, PlayerAction, RoundLog, Assignment, AIPhase, RaidResult, ScoutResult, HumanAxis, Mission } from './types.js';
import type { RNGState } from './rng.js';
import { createRNG, rngBool, rngInt, rngNext, seedFromString } from './rng.js';
import { resolveCombat } from './combat.js';
import { spendIntelOnFog, revealNodeRetroactive } from './fog.js';
import { generateMap, generateOtherClans, spendScoutsOnMap, visibilityFromProgress } from './map.js';
import { tickExpedition } from './expedition.js';
import { tileId } from './types.js';
import type { Expedition } from './types.js';
import { calcAISurveillanceGain, adaptGenome, generateAITree, generateAIWeakPoints, DEFAULT_GENOME } from './ai-brain.js';
import {
  INITIAL_POPULATION, INITIAL_SURVIVAL, INITIAL_COMBAT, INITIAL_INTELLIGENCE, INITIAL_MATERIAL,
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

/** Verjetnost, da obramba odbije napad. Vsi branilci so v boju. */
export function raidRepelProbability(state: GameState, assignment: Assignment): number {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  if (defenders <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const axisH = state.axisHistory ?? { hiding: 0, espionage: 0, defense: 0 };
  const defenseLvl = Math.floor((axisH.defense ?? 0) / 3);
  const intelB = intelCombatBonus(state);
  const wallBonus = 1 + 0.20 * (state.wallsBuilt ?? 0);  // vsak zid: +20 % moč obrambe
  const base = defenders * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult * (1 + 0.10 * defenseLvl);
  const equip = Math.min(state.resources.combat, defenders) * DEFENDER_EQUIPMENT_MULT;
  const defStr = (base + equip) * (1 + intelB) * wallBonus;
  const aiForce = Math.floor(state.aiRobots * (1 - state.clanActivity) * RAID_AI_FORCE_PCT);
  const aiStr = aiForce * AI_ROBOT_STRENGTH;
  return defStr / (defStr + Math.max(1, aiStr));
}

/** Verjetnost, da izvidniki vrnejo s polnim donosom. */
export function scoutSuccessProbability(state: GameState, assignment: Assignment): number {
  if ((assignment.scouts ?? 0) <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  let p = SCOUT_BASE_SUCCESS
    + SCOUT_INTEL_BONUS_PER_100 * (state.resources.intelligence / 100)
    + (tier.strengthMult - 1.0) * 0.5;
  if (assignment.axis === 'espionage') p += SCOUT_ESPIONAGE_BONUS;
  return Math.max(0, Math.min(0.98, p));
}

/** Verjetnost, da AI ujame izvidnike. */
export function scoutCaptureProbability(state: GameState, assignment: Assignment): number {
  if ((assignment.scouts ?? 0) <= 0) return 0;
  let p = SCOUT_CAPTURE_BASE
    + SCOUT_CAPTURE_PER_SCOUT * (assignment.scouts ?? 0)
    + SCOUT_AI_KNOWLEDGE_BONUS * state.aiKnowledge;
  if (assignment.axis === 'hiding') p *= (1 - SCOUT_HIDING_REDUCTION);
  return Math.max(0, Math.min(0.80, p));
}

/** Pričakovana varnost za nabiralce. */
export function forageSafetyProbability(state: GameState, assignment: Assignment): number {
  const pRaid = raidProbability(state, assignment.axis);
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

/** Resolve raid — vsi branilci se borijo + uničenje neuporabljenega orožja. */
function resolveRaid(
  state: GameState, assignment: Assignment, rng: RNGState
): { result: RaidResult; rng: RNGState } {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  const p = raidRepelProbability(state, assignment);
  const outcome = outcomeFromP(p);
  const aiForce = Math.floor(state.aiRobots * (1 - state.clanActivity) * RAID_AI_FORCE_PCT);

  let defendersLost = 0, foragersLost = 0, aiRobotsDestroyed = 0;
  switch (outcome) {
    case 'victory':
      defendersLost     = Math.floor(defenders * 0.05);
      foragersLost      = 0;
      aiRobotsDestroyed = Math.floor(aiForce * 0.80);
      break;
    case 'partial':
      defendersLost     = Math.floor(defenders * 0.25);
      foragersLost      = Math.floor(assignment.foragers * 0.15);
      aiRobotsDestroyed = Math.floor(aiForce * 0.35);
      break;
    case 'defeat':
      defendersLost     = Math.floor(defenders * 0.60);
      foragersLost      = Math.floor(assignment.foragers * 0.40);
      aiRobotsDestroyed = Math.floor(aiForce * 0.12);
      break;
    case 'annihilation':
      defendersLost     = defenders;
      foragersLost      = Math.floor(assignment.foragers * 0.70);
      aiRobotsDestroyed = Math.floor(aiForce * 0.03);
      break;
  }

  // Uničenje orožja v skladišču (kar ni v rabi, ko napadejo)
  const weaponsInUse = defenders + assignment.combatants;
  const weaponsIdle  = Math.max(0, state.resources.combat - weaponsInUse);
  let weaponsDestroyed = 0;
  if (weaponsIdle > 0) {
    const [pctRoll, rng2] = rngInt(rng, WEAPON_DESTROY_MIN_PCT * 100, WEAPON_DESTROY_MAX_PCT * 100);
    rng = rng2;
    weaponsDestroyed = Math.floor(weaponsIdle * pctRoll / 100);
  }

  return {
    result: {
      occurred: true, outcome,
      defendersLost, foragersLost, aiRobotsDestroyed, weaponsDestroyed,
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
      material: INITIAL_MATERIAL,
      artifacts: 0,
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
    otherClans: generateOtherClans(),
    expeditions: [],
    completedExpeditions: [],
    weaponWorkshopProgress: 0,
    weaponWorkshopScouts: 0,
    wallProgress: 0,
    wallsBuilt: 0,
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

  // Celotna velikost klana PRED rundo (kamp + misije + odprave) — za pravi populationDelta
  const totalClanBefore = state.population
    + (state.activeMissions ?? []).reduce((s, m) => s + m.assigned, 0)
    + (state.expeditions ?? []).reduce((s, e) => s + e.assigned, 0);

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

  // (izvidniki v kampu nimajo več ujetja — to velja le za odprave na poti)
  const scoutResult: ScoutResult = { captured: false, scoutsLost: 0, effectivenessMult: 1.0 };

  let combat = state.resources.combat;
  let material = state.resources.material ?? 0;
  let artifacts = state.resources.artifacts ?? 0;

  // 3. RAZISKOVALCI — intel + razkrivanje AI drevesa / boost
  const researchers = assignment.researchers ?? assignment.scouts ?? 0;
  const researchObj: 'robots' | 'weakpoints' = assignment.researchObjective ?? 'weakpoints';
  const intelGained = Math.floor(researchers * SCOUT_INTEL_YIELD * rations.strengthMult);
  let intelligence = state.resources.intelligence + intelGained;

  let aiTree = state.aiTree;
  let revealed: string[] = [];
  let mapTiles = state.mapTiles ?? generateMap();
  let otherClans = (state.otherClans ?? generateOtherClans()).map(c => ({ ...c }));
  const workshopEvents: string[] = [];

  if (researchers > 0) {
    if (researchObj === 'weakpoints') {
      const fogEfficiency = assignment.axis === 'espionage' ? M_OS[state.phase].espionage : 0.15;
      const espionageBonus = 1 + 0.20 * espionageLvl;
      const budget = Math.floor(researchers * SCOUT_FOG_YIELD * fogEfficiency * espionageBonus * rations.strengthMult);
      const r = spendIntelOnFog(aiTree, budget);
      aiTree = r.nodes;
      revealed = r.revealed;
    } else if (researchObj === 'robots') {
      const intelBonus = Math.floor(researchers * SCOUT_INTEL_YIELD * 3 * rations.strengthMult);
      intelligence += intelBonus;
    }
  }

  // 4. DELAVCI — delavnica orožja ali gradnja zidu
  const workers = assignment.workers ?? 0;
  const workshopObj: 'weapon' | 'wall' = assignment.workshopObjective ?? 'weapon';
  let weaponWorkshopProgress = state.weaponWorkshopProgress ?? 0;
  let weaponWorkshopScouts = state.weaponWorkshopScouts ?? 0;
  let wallProgress = state.wallProgress ?? 0;
  let wallsBuilt = state.wallsBuilt ?? 0;

  if (workers > 0) {
    if (workshopObj === 'weapon') {
      if (material <= 0) {
        workshopEvents.push(`🔨 Delavnica orožja stoji — ni materiala.`);
      } else {
        weaponWorkshopScouts = workers;
        weaponWorkshopProgress += 1;
        if (weaponWorkshopProgress >= 2) {
          const possible = Math.min(weaponWorkshopScouts, material);
          combat += possible;
          material -= possible;
          workshopEvents.push(`🔨 Delavnica orožja: +${possible} orožja (−${possible} materiala).`);
          weaponWorkshopProgress = 0;
        } else {
          workshopEvents.push(`🔨 Delavnica orožja dela (mesec ${weaponWorkshopProgress}/2)…`);
        }
      }
    } else if (workshopObj === 'wall') {
      if (material <= 0) {
        workshopEvents.push(`🧱 Gradnja zidu stoji — ni materiala.`);
      } else {
        wallProgress += workers;
        const materialCost = Math.min(material, workers);
        material -= materialCost;
        if (wallProgress >= 6) {
          wallsBuilt += 1;
          wallProgress = 0;
          workshopEvents.push(`🧱 Obrambni zid dograjen! Skupaj ${wallsBuilt} zidov, +20 % obrambe (−${materialCost} materiala).`);
        } else {
          workshopEvents.push(`🧱 Gradnja zidu: ${Math.min(6, wallProgress)}/6 (−${materialCost} materiala).`);
        }
      }
    }
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
  let population = state.population;
  let aiRobots = state.aiRobots;
  let aiKnowledge = state.aiKnowledge;
  let combatLog = null;
  let scoutsKilled = scoutResult.scoutsLost;
  const expeditionEvents: string[] = [];   // posebni dogodki (vrnitve, izgube, uničene šibke točke)

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

  // 6b. RAID — AI najde kamp z neko verjetnostjo
  let raidLog: RaidResult | null = null;
  const pRaid = raidProbability(state, assignment.axis);
  const [raidRoll, rngR1] = rngNext(rng); rng = rngR1;
  if (raidRoll < pRaid) {
    const { result: raidRes, rng: rngR2 } = resolveRaid(state, assignment, rng);
    rng = rngR2;
    raidLog = raidRes;
    const defSave = Math.floor(raidRes.defendersLost * 0.10 * defenseLvl);
    const actualDef = Math.max(0, raidRes.defendersLost - defSave);
    const forSave = Math.floor(raidRes.foragersLost  * 0.10 * defenseLvl);
    const actualFor = Math.max(0, raidRes.foragersLost  - forSave);
    population -= actualDef + actualFor;
    combat = Math.max(0, combat - actualDef);
    combat = Math.max(0, combat - raidRes.weaponsDestroyed);
    aiRobots = Math.max(0, aiRobots - raidRes.aiRobotsDestroyed);
    // Branilci poberejo material iz uničenih robotov
    material += raidRes.aiRobotsDestroyed;
    if (defSave > 0 || forSave > 0) {
      raidLog = { ...raidRes, defendersLost: actualDef, foragersLost: actualFor };
    }
    aiKnowledge = Math.min(1, aiKnowledge + (raidRes.outcome === 'victory' ? 0.03 : raidRes.outcome === 'partial' ? 0.07 : 0.15));
  } else {
    raidLog = { occurred: false, outcome: null,
      defendersLost: 0, foragersLost: 0,
      aiRobotsDestroyed: 0, weaponsDestroyed: 0,
      successProbability: raidRepelProbability(state, assignment) };
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
    }
  }

  // 6c2. ODPRAVE NA POTI (scout + mission s path) — tick + sprejem novih
  const incomingExps = assignment.newExpeditions ?? [];
  const oldExps = state.expeditions ?? [];
  const oldCompletedExps = state.completedExpeditions ?? [];
  const tickedExps: Expedition[] = [];
  const finishedExps: Expedition[] = [];

  for (const e of oldExps) {
    const r = tickExpedition(e, mapTiles, aiKnowledge, rng);
    rng = r.rng;
    mapTiles = r.tiles;

    // Najdbe med potjo
    if (r.finds.material > 0) material += r.finds.material;
    if (r.finds.weapons > 0)  combat   += r.finds.weapons;
    if (r.finds.artifacts > 0) artifacts += r.finds.artifacts;

    // Dogodki med potjo (srečanja + najdbe)
    for (const ev of r.events) expeditionEvents.push(`🔭 ${ev}`);

    if (r.exp.status === 'completed' || r.exp.status === 'lost') {
      if (r.exp.status === 'completed') {
        const target = r.exp.path[r.exp.path.length - 1];
        // Navezava stika z drugim klanom, če je odprava dospela na njihov heks
        const arrTile = mapTiles.find(t => t.q === target.q && t.r === target.r);
        if (arrTile?.otherClanId) {
          const ci = otherClans.findIndex(c => c.id === arrTile.otherClanId);
          if (ci >= 0 && !otherClans[ci].allied) {
            otherClans[ci] = { ...otherClans[ci], discovered: true, allied: true };
            expeditionEvents.push(`🤝 ZAVEZNIŠTVO: ${otherClans[ci].label} se nam je pridružil — odslej sodelujemo!`);
          }
        }
        if (r.exp.kind === 'mission') {
          // SPOPAD OB PRIHODU — napadalci udarijo na cilju, preživeli se vrnejo
          const aTier = RATIONS_LEVELS[r.exp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
          let survivors = r.exp.assigned;
          if (r.exp.weakPointId) {
            // Napad na šibko točko AI
            const wpIdx = aiWeakPoints.findIndex(wp => wp.id === r.exp.weakPointId);
            const p = missionSuccessProbability(
              { ...state, resources: { ...state.resources, intelligence } },
              r.exp.weakPointId, survivors, r.exp.rations);
            const [roll, rngA] = rngNext(rng); rng = rngA;
            const wpLabel = wpIdx >= 0 ? aiWeakPoints[wpIdx].label : 'šibka točka';
            if (roll < p && wpIdx >= 0) {
              const lost = Math.round(survivors * (1 - p) * 0.3);
              survivors = Math.max(0, survivors - lost);
              aiWeakPoints[wpIdx] = { ...aiWeakPoints[wpIdx], exploited: true, discovered: true };
              expeditionEvents.push(`💥 ŠIBKA TOČKA UNIČENA: ${wpLabel} — ${lost} padlih, ${survivors} se vrača.`);
            } else {
              const lost = Math.round(survivors * 0.5);
              survivors = Math.max(0, survivors - lost);
              expeditionEvents.push(`✗ Napad na ${wpLabel} ni uspel — ${lost} padlih, ${survivors} se vrača.`);
            }
          } else {
            // Splošni napad na AI robote
            const humanStr = survivors * 1.2 * aTier.strengthMult;
            const aiStr = Math.max(1, aiRobots * 0.05);
            const p = humanStr / (humanStr + aiStr);
            const [roll, rngA] = rngNext(rng); rng = rngA;
            if (roll < p) {
              const destroyed = Math.min(aiRobots, Math.round(survivors * (1 + p)));
              aiRobots = Math.max(0, aiRobots - destroyed);
              material += destroyed;
              const lost = Math.round(survivors * (1 - p) * 0.3);
              survivors = Math.max(0, survivors - lost);
              expeditionEvents.push(`⚔ Napad uspešen na (${target.q},${target.r}): ${destroyed} robotov uničenih, ${lost} padlih, ${survivors} se vrača.`);
            } else {
              const destroyed = Math.min(aiRobots, Math.round(survivors * 0.5));
              aiRobots = Math.max(0, aiRobots - destroyed);
              material += destroyed;
              const lost = Math.round(survivors * 0.6);
              survivors = Math.max(0, survivors - lost);
              expeditionEvents.push(`⚔ Napad odbit na (${target.q},${target.r}): ${destroyed} robotov, a ${lost} padlih, ${survivors} se vrača.`);
            }
          }
          population += Math.max(0, survivors);
        } else {
          expeditionEvents.push(`✓ Izvidniška odprava dospela na (${target.q},${target.r}) — ${r.exp.assigned} se vrača v kamp.`);
          population += r.exp.assigned;
        }
      } else {
        expeditionEvents.push(`☠ Odprava izgubljena — vsi člani so padli.`);
      }
      finishedExps.push(r.exp);
    } else {
      tickedExps.push(r.exp);
    }
  }

  // Sprejmi nove odprave — pop se zmanjša + hrana za pot se odšteje iz zalog kampa
  for (const inp of incomingExps) {
    if (!inp.path || inp.path.length < 2) continue;
    if (inp.assigned < 1) continue;
    const [idRoll, rngId] = rngInt(rng, 1000, 9999); rng = rngId;
    population -= inp.assigned;
    // Hrana za celotno pot vzeta iz zalog upfront
    const months = Math.max(1, inp.path.length - 1);
    const eTier = RATIONS_LEVELS[inp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
    const foodPack = Math.round(inp.assigned * months * eTier.foodMult);
    survival = Math.max(0, survival - foodPack);
    expeditionEvents.push(`🎒 Odprava (${inp.assigned} ljudi, ${months}m) vzela ${foodPack} hrane s seboj.`);
    tickedExps.push({
      id: `exp_${state.totalRounds}_${idRoll}`,
      kind: inp.kind,
      weakPointId: inp.weakPointId,
      path: inp.path,
      currentIndex: 0,
      assigned: inp.assigned,
      rations: inp.rations,
      status: 'traveling',
      monthsElapsed: 0,
      encountersLog: [],
    });
  }

  // Avtomatsko razkrivanje šibkih točk: če je heks z wp dosegel >= 0.50 raziskanost, je discovered
  for (let i = 0; i < aiWeakPoints.length; i++) {
    const wp = aiWeakPoints[i];
    if (wp.discovered) continue;
    const tile = mapTiles.find(t => t.hidesWeakPointId === wp.id);
    if (tile && tile.researchProgress >= 0.50) {
      aiWeakPoints[i] = { ...wp, discovered: true };
    }
  }

  // 6d. MISIJE — tikni aktivne misije + obravnavaj nove razporeditve
  const oldMissions = state.activeMissions ?? [];
  const oldCompleted = state.completedMissions ?? [];
  const tickedMissions: Mission[] = [];
  const newlyCompleted: Mission[] = [];
  const missionRationsMap = assignment.missionRations ?? {};

  for (const m of oldMissions) {
    // Posodobi obroke misije iz trenutne izbire (default na prejšnje)
    const mRationsLvl = missionRationsMap[m.weakPointId] ?? m.rations ?? DEFAULT_RATIONS;
    // Misija ima svojo hrano za celotno trajanje (vzeto upfront ob startu) — brez dodatnih odbitkov tukaj

    // Encounter roll vsak mesec — člani misije so že odšteti iz pop., zato izgube ne tičejo pop.
    const encP = missionEncounterProbability(state, m.assigned);
    const [encRoll, rngM] = rngNext(rng); rng = rngM;
    let assignedNow = m.assigned;
    if (encRoll < encP) {
      const [lossPct, rngMl] = rngInt(rng, 20, 60); rng = rngMl;
      const lost = Math.floor(m.assigned * lossPct / 100);
      combat = Math.max(0, combat - lost);
      assignedNow = Math.max(0, m.assigned - lost);
      if (assignedNow < MISSION_MIN_TEAM) {
        population += assignedNow;  // preživeli se vrnejo v kamp
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
        population += assignedNow;  // preživeli se vrnejo
        newlyCompleted.push({ ...m, assigned: assignedNow, monthsRemaining: 0, rations: mRationsLvl, status: 'success',
          resultNarrative: `Odprava na ${m.weakPointId} uspela.` });
        const idx = aiWeakPoints.findIndex(wp => wp.id === m.weakPointId);
        if (idx >= 0) {
          const wpLabel = aiWeakPoints[idx].label;
          aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true, discovered: true };
          expeditionEvents.push(`💥 ŠIBKA TOČKA UNIČENA: ${wpLabel} — odprava se vrača.`);
        }
      } else {
        const [lossPct, rngL] = rngInt(rng, 30, 70); rng = rngL;
        const lost = Math.floor(assignedNow * lossPct / 100);
        combat = Math.max(0, combat - lost);
        const survivors = Math.max(0, assignedNow - lost);
        population += survivors;  // preživeli se vrnejo
        newlyCompleted.push({ ...m, assigned: survivors, monthsRemaining: 0, rations: mRationsLvl, status: 'failed',
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
    // Hrana za celotno trajanje misije vzeta upfront
    const mFoodCost = Math.round(ppl * dur * mTier.foodMult);
    survival = Math.max(0, survival - mFoodCost);
    population -= ppl;  // ekipa zapusti kamp (kot pri odpravah)
    expeditionEvents.push(`🎒 Misija (${ppl} ljudi, ${dur}m) vzela ${mFoodCost} hrane s seboj.`);
    const sp = missionSuccessProbability({ ...state, resources: { ...state.resources, intelligence } }, wpId, ppl, mRationsLvl);
    tickedMissions.push({ weakPointId: wpId, assigned: ppl, monthsTotal: dur, monthsRemaining: dur,
      successProbability: sp, rations: mRationsLvl, status: 'in_progress' });
  }

  // 6e. DRUGI KLANI — odkritje (raziskan heks) + mesečno sodelovanje (če zavezniki)
  for (let i = 0; i < otherClans.length; i++) {
    const c = otherClans[i];
    if (!c.discovered) {
      const tile = mapTiles.find(t => t.q === c.q && t.r === c.r);
      if (tile && tile.researchProgress >= 0.50) {
        otherClans[i] = { ...c, discovered: true };
        expeditionEvents.push(`📍 ODKRIT KLAN: ${c.label} na (${c.q},${c.r}). Pošlji odpravo do njih za zavezništvo.`);
      }
    }
  }
  let clanAllyBoost = 0;
  for (const c of otherClans) {
    if (!c.allied) continue;
    clanAllyBoost += 0.04;  // zavezniki dvignejo aktivnost klanov (manj AI napadov)
    if (c.specialty === 'food')     { survival += 8; }
    else if (c.specialty === 'material') { material += 4; }
    else if (c.specialty === 'weapons')  { combat += 2; }
    else if (c.specialty === 'people')   { population += 1; }
  }
  if (clanAllyBoost > 0) {
    const gifts = otherClans.filter(c => c.allied).map(c => c.label).join(', ');
    expeditionEvents.push(`🤝 Zavezniki (${gifts}) so poslali pomoč ta mesec.`);
  }

  // 7. Klan aktivnost — krivulja + vedenjski modifikator
  // Hiding lvl bonus: 25 % počasnejši padec na nivo
  // Skrivamo se le če ni ofenzivnih akcij ven (combatants+scouts majhni)
  const isHiding = assignment.axis === 'hiding' && assignment.combatants < 5 && (assignment.researchers ?? 0) < 8;
  const rawClanDelta = isHiding
    ? -CLAN_ACTIVITY_HIDDEN_MODIFIER
    : -CLAN_ACTIVITY_EXPOSURE_MODIFIER;
  const clanDelta = rawClanDelta * Math.max(0, 1 - 0.25 * hidingLvl);
  const clanActivity = Math.max(0, Math.min(1, state.clanActivity + clanDelta + clanAllyBoost));

  // 8. AI surveillance gain (skupna izpostavljenost: combatants + scouts)
  const exposure = (assignment.combatants + (assignment.researchers ?? 0)) / Math.max(1, state.population);
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

  // 10. Statusni check — izumrtje le če je CEL klan mrtev (kamp + misije + odprave)
  const totalClanAfter = finalPopulation
    + tickedMissions.reduce((s, m) => s + m.assigned, 0)
    + tickedExps.reduce((s, e) => s + e.assigned, 0);
  let status: GameState['status'] = state.status;
  if (totalClanAfter <= 0) status = 'defeat_extinction';
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
      material: material - (state.resources.material ?? 0),
    },
    populationDelta: (finalPopulation
      + tickedMissions.reduce((s, m) => s + m.assigned, 0)
      + tickedExps.reduce((s, e) => s + e.assigned, 0)
    ) - totalClanBefore,  // pravi delta klana (samo smrti/rojstva, ne premiki)
    clanActivityDelta: clanActivity - state.clanActivity,
    aiKnowledgeDelta: finalAiKnowledge - state.aiKnowledge,
    revealedNodes: revealed,
    narrative: buildNarrative(assignment, combatLog, raidLog, scoutResult, revealed, phaseComplete, state.phase, [...expeditionEvents, ...workshopEvents]),
  };

  return {
    ...state,
    round,
    phase,
    totalRounds: state.totalRounds + 1,
    population: finalPopulation,
    maxPopulation: finalMaxPopulation,
    resources: { survival, combat, intelligence, material, artifacts },
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
    otherClans,
    expeditions: tickedExps,
    completedExpeditions: [...oldCompletedExps, ...finishedExps],
    weaponWorkshopProgress, weaponWorkshopScouts, wallProgress, wallsBuilt,
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
    if (o === 'victory') parts.push(`AI je napadel kamp, obramba odbila (${raid.defendersLost} branilcev padlo v kampu).`);
    else if (o === 'partial') parts.push(`AI je napadel kamp — odbili smo, a ${raid.defendersLost} branilcev in ${raid.foragersLost} nabiralcev v kampu je padlo.`);
    else if (o === 'defeat') parts.push(`AI je napadel kamp in prebil obrambo — v kampu padlo ${raid.defendersLost} branilcev in ${raid.foragersLost} nabiralcev. Ljudje na odpravah ostali nepoškodovani.`);
    else if (o === 'annihilation') parts.push(`AI je opustošil kamp — vsi branilci so padli, ${raid.foragersLost} nabiralcev je umrlo. Le odprave preživele.`);
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
    raidRepelProbability: raidRepelProbability(state, assignment),
    scoutSuccessProbability: scoutSuccessProbability(state, assignment),
    scoutCaptureProbability: scoutCaptureProbability(state, assignment),
    forageSafetyProbability: forageSafetyProbability(state, assignment),
    intelBonus: intelB,
    weaponCap: weaponCap(state),
    missionPreviews,
  };
}
