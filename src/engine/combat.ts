// Spopad — verjetnost iz razmerja moči + M_os modifikator
// P(uspeh_A) = moč_A / (moč_A + moč_B)
// moč = (osnova) × M_os

import type { CombatResult, GameState, Assignment, AIPhase } from './types.js';
import type { RNGState } from './rng.js';
import { weaponEffectMult } from './difficulty.js';
import { rngNext } from './rng.js';
import {
  COMBAT_BASE_HUMAN_MULTIPLIER,
  COMBAT_EQUIPMENT_MULTIPLIER,
  AI_FOREKNOWLEDGE_BONUS,
  AI_WEAK_POINT_EXPLOIT_BONUS,
  aiDefensePower,
  researchMult,
  LOGICAL_WEAKNESS_COMBAT_BONUS,
  RATIONS_LEVELS,
  DEFAULT_RATIONS,
  INTEL_COMBAT_BONUS_PER_100,
  INTEL_COMBAT_BONUS_MAX,
} from './constants.js';

export function calcHumanStrength(
  assignment: Assignment,
  combatResources: number,
  _phase: AIPhase,
  weaponMult: number = 1
): number {
  // Obroki vplivajo na moč ljudi. M_os je odstranjen — bonusi pridejo iz intela in nadgradenj.
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  // Oprema: omejena s številom ljudi v boju; raziskava orožja podvoji prispevek opreme
  const equipUsed = Math.min(combatResources, assignment.combatants);
  const base = assignment.combatants * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult
    + equipUsed * COMBAT_EQUIPMENT_MULTIPLIER * weaponMult;
  return base;
}

/** Intel bonus kot multiplikator: 1 + bonus */
export function intelCombatMultiplier(intelligence: number): number {
  return 1 + Math.min(INTEL_COMBAT_BONUS_MAX, INTEL_COMBAT_BONUS_PER_100 * (intelligence / 100));
}

/** Razkriti logični bonusi po tipu AI enote. */
export function logicalWeaknessByRobot(state: GameState): Partial<Record<'scouts' | 'attackers' | 'peopleKillers', number>> {
  const out: Partial<Record<'scouts' | 'attackers' | 'peopleKillers', number>> = {};
  for (const n of state.aiTree ?? []) {
    if (n.role !== 'logical' || n.visibility !== 'revealed') continue;
    out[n.robot] = (out[n.robot] ?? 0) + LOGICAL_WEAKNESS_COMBAT_BONUS;
  }
  return out;
}

/** Bonus bojne moči iz razkritih LOGIČNIH šibkih točk prisotnih robotov. */
export function logicalWeaknessBonus(state: GameState): number {
  const units = state.aiUnits ?? { scouts: state.aiRobots, attackers: 0, peopleKillers: 0 };
  const byRobot = logicalWeaknessByRobot(state);
  let bonus = 0;
  if ((units.scouts ?? 0) > 0) bonus += byRobot.scouts ?? 0;
  if ((units.attackers ?? 0) > 0) bonus += byRobot.attackers ?? 0;
  if ((units.peopleKillers ?? 0) > 0) bonus += byRobot.peopleKillers ?? 0;
  return bonus;
}

export function calcAIStrength(
  state: GameState,
  _phase: AIPhase
): number {
  // AI brani z obrambno močjo enot (po tipih)
  const units = state.aiUnits ?? { scouts: state.aiRobots, attackers: 0, peopleKillers: 0 };
  const base = aiDefensePower(units);
  // Bonus, če AI ve za nas
  const foreknowledge = state.aiKnowledge > 0.5 ? AI_FOREKNOWLEDGE_BONUS : 1.0;
  return base * foreknowledge;
}

export function calcSuccessProbability(
  humanStr: number,
  aiStr: number,
  weakPointBonus: number = 0
): number {
  const adjusted = humanStr * (1 + weakPointBonus);
  return adjusted / (adjusted + aiStr);
}

type Outcome = CombatResult['outcome'];

// Kako odločilen mora biti rezultat (razdalja od praga uspeha), da je zmaga "popolna"
// oz. poraz "pokol". Manjše vrednosti = pogostejši ekstremi.
export const DECISIVE_MARGIN = 0.25;

/**
 * Dejanski naključni izid glede na verjetnost uspeha `p`.
 * Vrže RNG: če pade pod p, je uspeh (victory/partial glede na to kako prepričljivo),
 * sicer neuspeh (defeat/annihilation). S tem `successProbability` res pomeni roll,
 * ne deterministične mejne vrednosti. Še vedno seedan/deterministicen za isti seed.
 */
// TAKTIKA > SREČA: kocka je stisnjena okoli sredine. Roll vedno pade v
// [0.5−LUCK_BAND/2, 0.5+LUCK_BAND/2] = [0.25, 0.75], zato:
//  • prepričljiva premoč (p ≥ 0.75) VEDNO uspe,
//  • šibek poskus (p ≤ 0.25) VEDNO pade,
//  • le v vmesnem pasu odloča naključje boja.
// Strategija (moč obeh strani) torej določa izid; sreča le maje rob.
export const LUCK_BAND = 0.5;
export function tacticalRoll(rng: RNGState): [number, RNGState] {
  const [r, next] = rngNext(rng);
  return [0.5 + (r - 0.5) * LUCK_BAND, next];
}

export function rollOutcome(p: number, rng: RNGState): { outcome: Outcome; rng: RNGState } {
  const [roll, next] = tacticalRoll(rng);
  let outcome: Outcome;
  if (roll < p) {
    outcome = (p - roll) >= DECISIVE_MARGIN ? 'victory' : 'partial';
  } else {
    outcome = (roll - p) >= DECISIVE_MARGIN ? 'annihilation' : 'defeat';
  }
  return { outcome, rng: next };
}

// Plen sorazmeren z marginom zmage (isto za oba)
function calcSpoils(
  outcome: Outcome,
  humanCombatants: number,
  aiRobotsEngaged: number,
  combatResources: number
): Pick<CombatResult, 'spoils' | 'humanLost' | 'aiRobotsDestroyed' | 'aiInfoGained' | 'infoGained'> {
  switch (outcome) {
    case 'victory':
      return {
        humanLost: Math.floor(humanCombatants * 0.05),
        aiRobotsDestroyed: Math.floor(aiRobotsEngaged * 0.9),
        spoils: { combat: Math.floor(combatResources * 0.1), intelligence: 15 },
        aiInfoGained: 0,    // popolna zmaga — AI ne dobi nič
        infoGained: 20,
      };
    case 'partial':
      return {
        humanLost: Math.floor(humanCombatants * 0.20),
        aiRobotsDestroyed: Math.floor(aiRobotsEngaged * 0.5),
        spoils: { combat: Math.floor(combatResources * 0.05), intelligence: 8 },
        aiInfoGained: 0.05, // preživeli roboti prenesejo malo info
        infoGained: 10,
      };
    case 'defeat':
      return {
        humanLost: Math.floor(humanCombatants * 0.55),
        aiRobotsDestroyed: Math.floor(aiRobotsEngaged * 0.2),
        spoils: { intelligence: 3 },
        aiInfoGained: 0.12,
        infoGained: 3,
      };
    case 'annihilation':
      return {
        humanLost: humanCombatants,
        aiRobotsDestroyed: Math.floor(aiRobotsEngaged * 0.05),
        spoils: {},
        aiInfoGained: 0.20,
        infoGained: 0,
      };
  }
}

export function resolveCombat(
  state: GameState,
  assignment: Assignment,
  rng: RNGState,
  exploitingWeakPoint: boolean = false
): { result: CombatResult; rng: RNGState } {
  const intelMult = intelCombatMultiplier(state.resources.intelligence);
  const weaponMult = weaponEffectMult(state.difficulty, state.weaponResearchLevel ?? 0);
  const logicalMult = 1 + logicalWeaknessBonus(state);
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase, weaponMult) * intelMult * logicalMult;
  const aiStr = calcAIStrength(state, state.phase);
  const weakBonus = exploitingWeakPoint ? AI_WEAK_POINT_EXPLOIT_BONUS : 0;
  const p = calcSuccessProbability(humanStr, aiStr, weakBonus);

  const mAxis = 1.0;  // M_os ni več v bojni moči
  const { outcome, rng: rngAfter } = rollOutcome(p, rng);
  rng = rngAfter;
  const aiRobotsEngaged = Math.floor(state.aiRobots * 0.3);

  const { humanLost, aiRobotsDestroyed, spoils, aiInfoGained, infoGained } =
    calcSpoils(outcome, assignment.combatants, aiRobotsEngaged, state.resources.combat);

  return {
    result: {
      humanStrength: humanStr,
      aiStrength: aiStr,
      successProbability: p,
      mAxisModifier: mAxis,
      outcome,
      humanLost,
      aiRobotsDestroyed,
      spoils,
      aiInfoGained,
      infoGained,
    },
    rng,
  };
}
