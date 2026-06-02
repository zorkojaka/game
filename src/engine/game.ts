// Glavni game engine — čiste funkcije (state, action) → new state
// Brez side effectov, brez IO

import type { GameState, PlayerAction, RoundLog, Assignment, AIPhase, RaidResult, ScoutResult, HumanAxis, Mission, AIUnits, ResearchObjective, CampArea } from './types.js';
import type { RNGState } from './rng.js';
import { createRNG, rngBool, rngInt, rngNext, seedFromString } from './rng.js';
import { resolveCombat } from './combat.js';
import { revealTreeByInsight, revealNodeRetroactive } from './fog.js';
import { generateMap, generateOtherClans, spendScoutsOnMap, visibilityFromProgress } from './map.js';
import { tickExpedition, returnMonths, roundTripMonths } from './expedition.js';
import { tileId } from './types.js';
import type { Expedition } from './types.js';
import { calcAISurveillanceGain, adaptGenome, generateAITree, generateAIWeakPoints, DEFAULT_GENOME } from './ai-brain.js';
import {
  INITIAL_POPULATION, INITIAL_SURVIVAL, INITIAL_COMBAT, INITIAL_INTELLIGENCE, INITIAL_MATERIAL,
  INITIAL_AI_KNOWLEDGE, INITIAL_CLAN_ACTIVITY,
  AI_SCOUTS_INITIAL, AI_ATTACKERS_PHASE2, AI_PEOPLEKILLERS_PHASE3, PEOPLEKILLER_LETHALITY_PER_UNIT,
  AI_UNIT_DEFS, aiAttackPower, aiDefensePower, AI_FULL_ATTACK_POWER,
  ROUNDS_PER_PHASE, SURVIVAL_PER_PERSON_PER_ROUND, FORAGER_YIELD,
  SCOUT_INTEL_YIELD, SCOUT_FOG_YIELD, CLAN_ACTIVITY_BY_PHASE, CLAN_ACTIVITY_EXPOSURE_MODIFIER,
  CLAN_ACTIVITY_HIDDEN_MODIFIER, PHASE_EVENT_BASE_DAMAGE, PREPARED_DAMAGE_REDUCTION,
  RATIONS_LEVELS, DEFAULT_RATIONS,
  WEAPON_WORKER_MONTHS, WALL_WORKER_MONTHS, ARTIFACT_WORKER_MONTHS,
  WEAPON_MATERIAL_COST, WALL_MATERIAL_COST, ARTIFACT_MATERIAL_COST,
  RESEARCH_LEVEL_WORKER_MONTHS, researchMult,
  INITIAL_AI_INSIGHT, INSIGHT_PER_ROUND, INSIGHT_PHASE_CAP,
  RAID_BASE_CHANCE, RAID_POP_SCALING_MAX, RAID_POP_REFERENCE, RAID_AI_KNOWLEDGE_BONUS,
  RAID_HIDING_REDUCTION, RAID_CLAN_ABSORPTION, RAID_AI_FORCE_PCT, DEFENDER_EQUIPMENT_MULT,
  RAID_BREACH_AREAS, RAID_AREA_PEOPLE_LOSS,
  RAID_DESTROY_FOOD_PCT, RAID_DESTROY_WEAPONS_PCT, RAID_DESTROY_MATERIAL_PCT, RAID_DESTROY_WALL_LEVELS,
  SCOUT_BASE_SUCCESS, SCOUT_INTEL_BONUS_PER_100, SCOUT_ESPIONAGE_BONUS,
  SCOUT_CAPTURE_BASE, SCOUT_CAPTURE_PER_SCOUT, SCOUT_HIDING_REDUCTION, SCOUT_AI_KNOWLEDGE_BONUS,
  SCOUT_PARTIAL_EFFECTIVE, SCOUT_CAPTURED_LOSS_MIN, SCOUT_CAPTURED_LOSS_MAX,
  COMBAT_BASE_HUMAN_MULTIPLIER,
  STARVATION_LOSS_PCT_1ST, STARVATION_LOSS_PCT_2ND, STARVATION_LOSS_PCT_NTH,
  INTEL_COMBAT_BONUS_PER_100, INTEL_COMBAT_BONUS_MAX,
  WEAPON_DESTROY_MIN_PCT, WEAPON_DESTROY_MAX_PCT,
  MISSION_DURATION_MONTHS, MISSION_ENCOUNTER_BASE, MISSION_ENCOUNTER_PER_PERSON,
  MISSION_ENCOUNTER_AI_KNOW, MISSION_WP_DIFFICULTY, MISSION_MIN_TEAM,
} from './constants.js';
import { calcHumanStrength, calcAIStrength, calcSuccessProbability, rollOutcome, logicalWeaknessBonus } from './combat.js';

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

/** Verjetnost, da AI najde in napade kamp v tej rundi. Vezana na ofenzivno moč prisotnih enot (tudi izvidniki napadajo). */
export function raidProbability(state: GameState, axis: HumanAxis): number {
  const attackPow = aiAttackPower(readAIUnits(state));
  if (attackPow <= 0) return 0;
  const popFactor = Math.min(1, state.population / RAID_POP_REFERENCE);
  let p = RAID_BASE_CHANCE
    + RAID_POP_SCALING_MAX * popFactor
    + RAID_AI_KNOWLEDGE_BONUS * state.aiKnowledge;
  p *= (1 - state.clanActivity * RAID_CLAN_ABSORPTION);
  p *= Math.min(1, attackPow / AI_FULL_ATTACK_POWER);  // šibkejša/maloštevilna sila → manj raidov
  return Math.max(0, Math.min(1, p));
}

/** Verjetnost, da obramba odbije napad. Vsi branilci so v boju. */
export function raidRepelProbability(state: GameState, assignment: Assignment): number {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  if (defenders <= 0) return 0;
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  const intelB = intelCombatBonus(state);
  const weaponMult = researchMult(state.weaponResearchLevel ?? 0);  // raziskava orožja ×2/level
  const wallMult = researchMult(state.wallResearchLevel ?? 0);      // raziskava obzidja ×2/level
  const wallBonus = 1 + 0.20 * wallMult * (state.wallsBuilt ?? 0);  // vsak zid: +20 % (× raziskava)
  const base = defenders * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult;
  const equip = Math.min(state.resources.combat, defenders) * DEFENDER_EQUIPMENT_MULT * weaponMult;
  const defStr = (base + equip) * (1 + intelB) * wallBonus;
  // Raid izvaja vsa AI sila (vsi tipi enot napadajo) — moč po njihovem napadu
  const aiStr = aiAttackPower(readAIUnits(state)) * (1 - state.clanActivity) * RAID_AI_FORCE_PCT;
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

/** Resolve raid — vsi branilci se borijo + uničenje neuporabljenega orožja. */
function resolveRaid(
  state: GameState, assignment: Assignment, rng: RNGState
): { result: RaidResult; rng: RNGState } {
  const defenders = (assignment.defenders ?? 0) + (assignment.dayGuard ?? 0) + (assignment.nightGuard ?? 0);
  const p = raidRepelProbability(state, assignment);
  const { outcome, rng: rngRoll } = rollOutcome(p, rng);
  rng = rngRoll;
  const aiUnits = readAIUnits(state);
  // Število robotov, ki sodelujejo v raidu (za štetje uničenih) — vsi tipi
  const aiForce = Math.floor(totalAIRobots(aiUnits) * (1 - state.clanActivity) * RAID_AI_FORCE_PCT);
  // People-killer enote (faza 3) povečajo smrtnost med ljudmi
  const lethality = 1 + PEOPLEKILLER_LETHALITY_PER_UNIT * aiUnits.peopleKillers;

  // Front-line žrtve branilcev + uničenje AI po izidu
  const frontFrac:   Record<typeof outcome, number> = { victory: 0.05, partial: 0.25, defeat: 0.60, annihilation: 1.00 };
  const destroyFrac: Record<typeof outcome, number> = { victory: 0.80, partial: 0.35, defeat: 0.12, annihilation: 0.03 };
  let defendersLost = outcome === 'annihilation' ? defenders : Math.floor(defenders * frontFrac[outcome] * lethality);
  const aiRobotsDestroyed = Math.floor(aiForce * destroyFrac[outcome]);

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

  // Žrtve med ljudmi v prebitih območjih (delež dodeljenih tej vlogi)
  const peopleLossFrac = (outcome === 'partial' || outcome === 'defeat' || outcome === 'annihilation')
    ? RAID_AREA_PEOPLE_LOSS[outcome] * lethality : 0;
  const foragersLost    = breachedAreas.includes('food')     ? Math.floor((assignment.foragers ?? 0)    * peopleLossFrac) : 0;
  const workersLost     = breachedAreas.includes('workshop') ? Math.floor((assignment.workers ?? 0)     * peopleLossFrac) : 0;
  const researchersLost = breachedAreas.includes('research') ? Math.floor((assignment.researchers ?? 0) * peopleLossFrac) : 0;
  if (breachedAreas.includes('defense')) {
    defendersLost += Math.floor(defenders * peopleLossFrac);
  }
  defendersLost = Math.min(defenders, defendersLost);

  // Uničenje virov v prebitih območjih (na žive vrednosti se uporabi v processRound)
  return {
    result: {
      occurred: true, outcome,
      defendersLost, foragersLost, workersLost, researchersLost,
      aiRobotsDestroyed, weaponsDestroyed,
      survivalDestroyed: 0, materialDestroyed: 0, wallsDestroyed: 0,
      breachedAreas,
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
    aiRobots: AI_SCOUTS_INITIAL,
    aiUnits: { scouts: AI_SCOUTS_INITIAL, attackers: 0, peopleKillers: 0 },
    aiKnowledge: INITIAL_AI_KNOWLEDGE,
    aiTree: generateAITree(),
    aiWeakPoints: generateAIWeakPoints(),
    clanActivity: INITIAL_CLAN_ACTIVITY,
    axisHistory: { obzidje: 0, orozje: 0, roboti: 0 },
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

  if (researchers > 0) {
    if (researchObj === 'robots') {
      // Roboti: odkrivamo šibke točke; vsak nivo odklene orožje/obzidje iste stopnje
      const intelBonus = Math.floor(researchers * SCOUT_INTEL_YIELD * rations.strengthMult);
      intelligence += intelBonus;
      robotsResearchProgress += researchers;
      while (robotsResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS) {
        robotsResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
        robotsResearchLevel += 1;
        workshopEvents.push(`🔬 Roboti raziskani — stopnja ${robotsResearchLevel}! Odklenjeno Orožje ${robotsResearchLevel} in Obzidje ${robotsResearchLevel}.`);
      }
    } else if (researchObj === 'weapon') {
      // Orožje je zaklenjeno za raziskavo robotov: ne more preseči robotsResearchLevel
      if (weaponResearchLevel >= robotsResearchLevel) {
        workshopEvents.push(`🔒 Orožje ${weaponResearchLevel + 1} zaklenjeno — najprej razišči Robote ${weaponResearchLevel + 1}.`);
      } else {
        weaponResearchProgress += researchers;
        while (weaponResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS && weaponResearchLevel < robotsResearchLevel) {
          weaponResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
          weaponResearchLevel += 1;
          workshopEvents.push(`🔬 Raziskava orožja dokončana — stopnja ${weaponResearchLevel}! Napad orožja ×${researchMult(weaponResearchLevel)}.`);
        }
      }
    } else if (researchObj === 'wall') {
      if (wallResearchLevel >= robotsResearchLevel) {
        workshopEvents.push(`🔒 Obzidje ${wallResearchLevel + 1} zaklenjeno — najprej razišči Robote ${wallResearchLevel + 1}.`);
      } else {
        wallResearchProgress += researchers;
        while (wallResearchProgress >= RESEARCH_LEVEL_WORKER_MONTHS && wallResearchLevel < robotsResearchLevel) {
          wallResearchProgress -= RESEARCH_LEVEL_WORKER_MONTHS;
          wallResearchLevel += 1;
          workshopEvents.push(`🔬 Raziskava obzidja dokončana — stopnja ${wallResearchLevel}! Obramba obzidja ×${researchMult(wallResearchLevel)}.`);
        }
      }
    }
  }

  // Naše znanje o AI (insight) → postopno odpiranje AI drevesa do faznega stropa
  const aiInsight = Math.min(
    INSIGHT_PHASE_CAP[state.phase],
    (state.aiInsight ?? INITIAL_AI_INSIGHT) + INSIGHT_PER_ROUND,
  );
  let aiTree = revealTreeByInsight(state.aiTree, aiInsight);
  const prevRevealed = new Set(state.aiTree.filter(n => n.visibility === 'revealed').map(n => n.id));
  const revealed: string[] = aiTree.filter(n => n.visibility === 'revealed' && !prevRevealed.has(n.id)).map(n => n.id);

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
          workshopEvents.push(`🧱 Obrambno obzidje dograjeno! +${made} obzidje (−${made * WALL_MATERIAL_COST} materiala). Skupaj ${wallsBuilt}, +${20*made} % obrambe. Napredek: ${wallProgress}/${WALL_WORKER_MONTHS}.`);
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
          material -= made * ARTIFACT_MATERIAL_COST;
          artifactWorkshopProgress -= made * ARTIFACT_WORKER_MONTHS;
          workshopEvents.push(`💎 ARTEFAKT IZDELAN! +${made} artefakt (−${made * ARTIFACT_MATERIAL_COST} materiala). Napredek: ${artifactWorkshopProgress}/${ARTIFACT_WORKER_MONTHS}.`);
        } else {
          workshopEvents.push(`💎 Delavnica artefaktov: ${artifactWorkshopProgress}/${ARTIFACT_WORKER_MONTHS} delavec-mesecev.`);
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
  let aiUnits = readAIUnits(state);
  let aiRobots = totalAIRobots(aiUnits);
  const applyDestroy = (n: number) => { aiUnits = destroyAIUnits(aiUnits, n); aiRobots = totalAIRobots(aiUnits); };
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

  // 6b. RAID — AI najde kamp z neko verjetnostjo
  let raidLog: RaidResult | null = null;
  const pRaid = raidProbability(state, assignment.axis);
  const [raidRoll, rngR1] = rngNext(rng); rng = rngR1;
  if (raidRoll < pRaid) {
    const { result: raidRes, rng: rngR2 } = resolveRaid(state, assignment, rng);
    rng = rngR2;
    // Obrambni nivo malo zmanjša žrtve med ljudmi
    const save = (n: number) => n;  // (obrambni bonus osi odstranjen)
    const actualDef = save(raidRes.defendersLost);
    const actualFor = save(raidRes.foragersLost);
    const actualWrk = save(raidRes.workersLost);
    const actualRes = save(raidRes.researchersLost);
    // Žrtve so povsod, kjer je AI prebil — vsaka vloga izgubi svoje ljudi
    population -= actualDef + actualFor + actualWrk + actualRes;
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
      defendersLost: actualDef, foragersLost: actualFor, workersLost: actualWrk, researchersLost: actualRes,
      weaponsDestroyed, survivalDestroyed, materialDestroyed, wallsDestroyed,
    };
    aiKnowledge = Math.min(1, aiKnowledge + (raidRes.outcome === 'victory' ? 0.03 : raidRes.outcome === 'partial' ? 0.07 : 0.15));
  } else {
    raidLog = { occurred: false, outcome: null,
      defendersLost: 0, foragersLost: 0, workersLost: 0, researchersLost: 0,
      aiRobotsDestroyed: 0, weaponsDestroyed: 0,
      survivalDestroyed: 0, materialDestroyed: 0, wallsDestroyed: 0,
      breachedAreas: [],
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
    // POVRATNI LEG — preživeli se vračajo v kamp (odštevanje mesecev)
    if (e.status === 'returning') {
      const rem = (e.returnRemaining ?? 1) - 1;
      if (rem <= 0) {
        population += Math.max(0, e.assigned);
        expeditionEvents.push(`✓ Odprava se je vrnila v kamp — ${e.assigned} ljudi.`);
        finishedExps.push({ ...e, status: 'completed', returnRemaining: 0, monthsElapsed: e.monthsElapsed + 1 });
      } else {
        tickedExps.push({ ...e, returnRemaining: rem, monthsElapsed: e.monthsElapsed + 1 });
      }
      continue;
    }

    const r = tickExpedition(e, mapTiles, aiKnowledge, rng, aiUnits.scouts);
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
        let survivors = r.exp.assigned;
        if (r.exp.kind === 'mission') {
          // SPOPAD OB PRIHODU — napadalci udarijo na cilju, preživeli se nato vračajo
          const aTier = RATIONS_LEVELS[r.exp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
          const stealthBonus = r.exp.stealth ? 1.2 : 1.0;  // +20 % uspeha v boju
          if (r.exp.weakPointId) {
            // Napad na šibko točko AI
            const wpIdx = aiWeakPoints.findIndex(wp => wp.id === r.exp.weakPointId);
            const pBase = missionSuccessProbability(
              { ...state, resources: { ...state.resources, intelligence } },
              r.exp.weakPointId, survivors, r.exp.rations);
            const p = Math.min(0.98, pBase * stealthBonus);
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
            // Splošni napad na AI robote — naša moč raste z orožjem in razkritimi logičnimi šibkostmi
            const humanStr = survivors * 1.2 * aTier.strengthMult * stealthBonus
              * researchMult(state.weaponResearchLevel ?? 0) * (1 + logicalWeaknessBonus(state));
            const aiStr = Math.max(1, aiDefensePower(aiUnits) * 0.05);
            const p = humanStr / (humanStr + aiStr);
            const [roll, rngA] = rngNext(rng); rng = rngA;
            if (roll < p) {
              const destroyed = Math.min(aiRobots, Math.round(survivors * (1 + p)));
              applyDestroy(destroyed);
              material += destroyed;
              const lost = Math.round(survivors * (1 - p) * 0.3);
              survivors = Math.max(0, survivors - lost);
              expeditionEvents.push(`⚔ Napad uspešen na (${target.q},${target.r}): ${destroyed} robotov uničenih, ${lost} padlih, ${survivors} se vrača.`);
            } else {
              const destroyed = Math.min(aiRobots, Math.round(survivors * 0.5));
              applyDestroy(destroyed);
              material += destroyed;
              const lost = Math.round(survivors * 0.6);
              survivors = Math.max(0, survivors - lost);
              expeditionEvents.push(`⚔ Napad odbit na (${target.q},${target.r}): ${destroyed} robotov, a ${lost} padlih, ${survivors} se vrača.`);
            }
          }
        } else {
          expeditionEvents.push(`✓ Izvidniška odprava dospela na (${target.q},${target.r}).`);
        }
        // POVRATEK — preživeli se vračajo (čas glede na pot / sosednost kampa)
        survivors = Math.max(0, survivors);
        const ret = returnMonths(r.exp.path);
        if (survivors <= 0) {
          finishedExps.push(r.exp);
        } else if (ret <= 0) {
          population += survivors;  // zadnji heks je kamp — takoj doma
          finishedExps.push(r.exp);
        } else {
          expeditionEvents.push(`↩ ${survivors} se vrača — še ${ret} mesec(ev) do kampa.`);
          tickedExps.push({ ...r.exp, status: 'returning', assigned: survivors, returnRemaining: ret });
        }
      } else {
        expeditionEvents.push(`☠ Odprava izgubljena — vsi člani so padli.`);
        finishedExps.push(r.exp);
      }
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
    // Hrana za celotno pot TJA IN NAZAJ, vzeta iz zalog upfront
    const months = Math.max(1, roundTripMonths(inp.path));
    const eTier = RATIONS_LEVELS[inp.rations] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
    const foodPack = Math.round(inp.assigned * months * eTier.foodMult);
    survival = Math.max(0, survival - foodPack);
    expeditionEvents.push(`🎒 Odprava (${inp.assigned} ljudi, ${months}m tja+nazaj) vzela ${foodPack} hrane s seboj.`);
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
      stealth: inp.stealth,
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
  // Padec klanske podpore (os skrivanja odstranjena — nevtralen padec)
  const clanDelta = -CLAN_ACTIVITY_EXPOSURE_MODIFIER;
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

  // Fazni prihod novih AI enot (ob prehodu v novo fazo)
  if (phaseComplete) {
    if (phase === 'understand') {
      aiUnits = { ...aiUnits, attackers: aiUnits.attackers + AI_ATTACKERS_PHASE2 };
      aiRobots = totalAIRobots(aiUnits);
      expeditionEvents.push(`🤖 AI je pripeljal ${AI_ATTACKERS_PHASE2} napadalnih enot — pričakuj napade na kamp.`);
    } else if (phase === 'eliminate') {
      aiUnits = { ...aiUnits, peopleKillers: aiUnits.peopleKillers + AI_PEOPLEKILLERS_PHASE3 };
      aiRobots = totalAIRobots(aiUnits);
      expeditionEvents.push(`☠ AI je pripeljal ${AI_PEOPLEKILLERS_PHASE3} people-killer enot — napadi so zdaj smrtonosnejši.`);
    }
  }

  // Zmaga — AI popolnoma iztrebljen (tudi v fazi 1: če pobijemo vse izvidnike, AI ne more nadaljevati),
  // ali vse šibke točke izkoriščene.
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
    aiUnits,
    aiInsight,
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
      parts.push(`AI je napadel kamp, obramba je zdržala${raid.defendersLost > 0 ? ` (${raid.defendersLost} branilcev padlo)` : ''}.`);
    } else {
      const areaLabels: Record<string, string> = { food: 'prehrano', workshop: 'delavnice', research: 'raziskave', defense: 'obrambo' };
      const breached = (raid.breachedAreas ?? []).map(a => areaLabels[a] ?? a);
      // žrtve po vlogah
      const losses: string[] = [];
      if (raid.defendersLost > 0)   losses.push(`${raid.defendersLost} branilcev`);
      if (raid.foragersLost > 0)    losses.push(`${raid.foragersLost} nabiralcev`);
      if (raid.workersLost > 0)     losses.push(`${raid.workersLost} delavcev`);
      if (raid.researchersLost > 0) losses.push(`${raid.researchersLost} raziskovalcev`);
      // uničeni viri
      const damage: string[] = [];
      if (raid.survivalDestroyed > 0) damage.push(`${raid.survivalDestroyed} hrane`);
      if (raid.weaponsDestroyed > 0)  damage.push(`${raid.weaponsDestroyed} orožja`);
      if (raid.materialDestroyed > 0) damage.push(`${raid.materialDestroyed} materiala`);
      if (raid.wallsDestroyed > 0)    damage.push(`${raid.wallsDestroyed} stopnjo obzidja`);
      const verb = o === 'annihilation' ? 'je opustošil kamp' : 'je prebil obrambo';
      let msg = `AI ${verb}`;
      if (breached.length) msg += ` (prizadeta: ${breached.join(', ')})`;
      if (losses.length) msg += ` — padlo ${losses.join(', ')}`;
      if (damage.length) msg += `; uničeno ${damage.join(', ')}`;
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

  return parts.join(' ') || 'Mesec je minil mirno.';
}

// ─── Pomožne funkcije za UI ───────────────────────────────────────────────────

// Izračun obeta za dano dodelitev — UI prikaže pred akcijo
export function previewOdds(state: GameState, assignment: Assignment) {
  const intelB = intelCombatBonus(state);
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase, researchMult(state.weaponResearchLevel ?? 0)) * (1 + intelB) * (1 + logicalWeaknessBonus(state));
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
