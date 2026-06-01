// Spopad — verjetnost iz razmerja moči + M_os modifikator
// P(uspeh_A) = moč_A / (moč_A + moč_B)
// moč = (osnova) × M_os

import type { CombatResult, GameState, Assignment, AIPhase } from './types.js';
import type { RNGState } from './rng.js';
import { rngNext } from './rng.js';
import {
  COMBAT_BASE_HUMAN_MULTIPLIER,
  COMBAT_EQUIPMENT_MULTIPLIER,
  AI_FOREKNOWLEDGE_BONUS,
  AI_WEAK_POINT_EXPLOIT_BONUS,
  aiDefensePower,
  RATIONS_LEVELS,
  DEFAULT_RATIONS,
  INTEL_COMBAT_BONUS_PER_100,
  INTEL_COMBAT_BONUS_MAX,
} from './constants.js';

export function calcHumanStrength(
  assignment: Assignment,
  combatResources: number,
  _phase: AIPhase
): number {
  // Obroki vplivajo na moč ljudi. M_os je odstranjen — bonusi pridejo iz intela in nadgradenj.
  const tier = RATIONS_LEVELS[assignment.rations ?? DEFAULT_RATIONS] ?? RATIONS_LEVELS[DEFAULT_RATIONS];
  // Oprema: omejena s številom ljudi v boju
  const equipUsed = Math.min(combatResources, assignment.combatants);
  const base = assignment.combatants * COMBAT_BASE_HUMAN_MULTIPLIER * tier.strengthMult
    + equipUsed * COMBAT_EQUIPMENT_MULTIPLIER;
  return base;
}

/** Intel bonus kot multiplikator: 1 + bonus */
export function intelCombatMultiplier(intelligence: number): number {
  return 1 + Math.min(INTEL_COMBAT_BONUS_MAX, INTEL_COMBAT_BONUS_PER_100 * (intelligence / 100));
}

export function calcAIStrength(
  state: GameState,
  _phase: AIPhase
): number {
  // AI brani z obrambno močjo enot (po tipih), filtrirano skozi aktivnost klanov
  const units = state.aiUnits ?? { scouts: state.aiRobots, attackers: 0, peopleKillers: 0 };
  const base = aiDefensePower(units) * (1 - state.clanActivity);
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
export function rollOutcome(p: number, rng: RNGState): { outcome: Outcome; rng: RNGState } {
  const [roll, next] = rngNext(rng);
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
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase) * intelMult;
  const aiStr = calcAIStrength(state, state.phase);
  const weakBonus = exploitingWeakPoint ? AI_WEAK_POINT_EXPLOIT_BONUS : 0;
  const p = calcSuccessProbability(humanStr, aiStr, weakBonus);

  const mAxis = 1.0;  // M_os ni več v bojni moči
  const { outcome, rng: rngAfter } = rollOutcome(p, rng);
  rng = rngAfter;
  const aiRobotsEngaged = Math.floor(state.aiRobots * (1 - state.clanActivity) * 0.3);

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
