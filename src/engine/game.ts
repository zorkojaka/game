// Glavni game engine — čiste funkcije (state, action) → new state
// Brez side effectov, brez IO

import type { GameState, PlayerAction, RoundLog, Assignment, AIPhase } from './types.js';
import type { RNGState } from './rng.js';
import { createRNG, rngBool, rngInt, seedFromString } from './rng.js';
import { resolveCombat } from './combat.js';
import { spendIntelOnFog, revealNodeRetroactive } from './fog.js';
import { calcAISurveillanceGain, adaptGenome, generateAITree, generateAIWeakPoints, DEFAULT_GENOME } from './ai-brain.js';
import {
  INITIAL_POPULATION, INITIAL_SURVIVAL, INITIAL_COMBAT, INITIAL_INTELLIGENCE,
  INITIAL_AI_ROBOTS, INITIAL_AI_KNOWLEDGE, INITIAL_CLAN_ACTIVITY,
  ROUNDS_PER_PHASE, SURVIVAL_PER_PERSON_PER_ROUND, FORAGER_YIELD,
  SCOUT_INTEL_YIELD, SCOUT_FOG_YIELD, CLAN_ACTIVITY_BY_PHASE, CLAN_ACTIVITY_EXPOSURE_MODIFIER,
  CLAN_ACTIVITY_HIDDEN_MODIFIER, PHASE_EVENT_BASE_DAMAGE, PREPARED_DAMAGE_REDUCTION,
  M_OS,
} from './constants.js';
import { calcHumanStrength, calcAIStrength, calcSuccessProbability } from './combat.js';

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
  const { assignment, targetWeakPoint } = action;

  // 1. Preživetveni resursi — populacija poje hrano
  const survivalCost = state.population * SURVIVAL_PER_PERSON_PER_ROUND;
  let survival = state.resources.survival - survivalCost;

  // 2. Forageri zbirajo preživetvene vire
  const foraged = assignment.foragers * FORAGER_YIELD;
  survival += foraged;
  survival = Math.max(0, survival);

  // 3. Scouts generirajo intel
  const intelGained = assignment.scouts * SCOUT_INTEL_YIELD;
  let intelligence = state.resources.intelligence + intelGained;

  // 4. Megla — izvidniki čistijo megle glede na os
  // Espionage os: daje M_os bonus, ostali imajo 15 % bazne učinkovitosti
  const fogEfficiency = assignment.axis === 'espionage' ? M_OS[state.phase].espionage : 0.15;
  const fogBudget = Math.floor(assignment.scouts * SCOUT_FOG_YIELD * fogEfficiency);
  const { nodes: aiTree, revealed } = spendIntelOnFog(state.aiTree, fogBudget);
  // Ni odbitka intela — megla se čisti s časom izvidnikov, ne z intelom

  // 5. Šibke točke — odkrijemo, če smo dovolj razkrili sosednje vozlišče
  const aiWeakPoints = state.aiWeakPoints.map(wp => {
    if (wp.discovered) return wp;
    const relatedRevealed = aiTree.some(n => n.phase === wp.phase && n.visibility === 'revealed');
    return relatedRevealed ? { ...wp, discovered: true } : wp;
  });

  // 6. Spopad (če pošljemo combatante)
  let combat = state.resources.combat;
  let population = state.population;
  let aiRobots = state.aiRobots;
  let aiKnowledge = state.aiKnowledge;
  let combatLog = null;

  const isExploiting = targetWeakPoint
    ? aiWeakPoints.some(wp => wp.id === targetWeakPoint && wp.discovered)
    : false;

  if (assignment.combatants > 0) {
    const { result, rng: rngAfter } = resolveCombat(state, assignment, rng, isExploiting);
    rng = rngAfter;
    combatLog = result;

    population -= result.humanLost;
    aiRobots = Math.max(0, aiRobots - result.aiRobotsDestroyed);
    aiKnowledge = Math.min(1, aiKnowledge + result.aiInfoGained);
    intelligence += result.infoGained;
    combat = Math.max(0, combat + (result.spoils.combat ?? 0));
    intelligence += result.spoils.intelligence ?? 0;

    // Šibka točka izkoriščena
    if (isExploiting && result.outcome === 'victory') {
      const idx = aiWeakPoints.findIndex(wp => wp.id === targetWeakPoint);
      if (idx >= 0) aiWeakPoints[idx] = { ...aiWeakPoints[idx], exploited: true };
    }
  }

  // 7. Klan aktivnost — krivulja + vedenjski modifikator
  const isHiding = assignment.axis === 'hiding' && assignment.combatants < 5;
  const clanDelta = isHiding
    ? -CLAN_ACTIVITY_HIDDEN_MODIFIER
    : -CLAN_ACTIVITY_EXPOSURE_MODIFIER;
  const clanActivity = Math.max(0, state.clanActivity + clanDelta);

  // 8. AI surveillance gain
  const exposure = assignment.combatants / Math.max(1, state.population);
  const aiKnowledgeGain = calcAISurveillanceGain(DEFAULT_GENOME, clanActivity, exposure);
  const finalAiKnowledge = Math.min(1, aiKnowledge + aiKnowledgeGain);

  // 9. Populacija umre brez hrane
  let finalPopulation = population;
  if (survival <= 0) {
    const [starveDelta, rngAfter] = rngInt(rng, 2, 8);
    rng = rngAfter;
    finalPopulation = Math.max(0, population - starveDelta);
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
    resourceDelta: {
      survival: survival - state.resources.survival,
      combat: combat - state.resources.combat,
      intelligence: intelligence - state.resources.intelligence,
    },
    populationDelta: finalPopulation - state.population,
    clanActivityDelta: clanActivity - state.clanActivity,
    aiKnowledgeDelta: finalAiKnowledge - state.aiKnowledge,
    revealedNodes: revealed,
    narrative: buildNarrative(assignment, combatLog, revealed, phaseComplete, state.phase),
  };

  return {
    ...state,
    round,
    phase,
    totalRounds: state.totalRounds + 1,
    population: finalPopulation,
    resources: { survival, combat, intelligence },
    aiPhaseProgress: phaseComplete ? 0 : aiPhaseProgress,
    aiRobots,
    aiKnowledge: finalAiKnowledge,
    aiTree: finalTree,
    aiWeakPoints,
    clanActivity,
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
  revealed: string[],
  phaseComplete: boolean,
  phase: AIPhase
): string {
  const parts: string[] = [];

  if (combat) {
    const outcome = combat.outcome;
    if (outcome === 'victory') parts.push('Zmaga v spopadu — AI je utrpel velike izgube.');
    else if (outcome === 'partial') parts.push('Delna zmaga — preživeli smo, a z žrtvami.');
    else if (outcome === 'defeat') parts.push('Poraz — umaknili smo se z izgubami.');
    else parts.push('Pokol — borci so padli do zadnjega.');
  }

  if (revealed.length > 0) {
    parts.push(`Špijoni so razkrili ${revealed.length} novo(e) vozlišče(a) v AI načrtu.`);
  }

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
export function previewOdds(state: GameState, assignment: Assignment): {
  successProbability: number;
  mAxisModifier: number;
  humanStrength: number;
  aiStrength: number;
} {
  const humanStr = calcHumanStrength(assignment, state.resources.combat, state.phase);
  const aiStr = calcAIStrength(state, state.phase);
  const p = calcSuccessProbability(humanStr, aiStr);
  return {
    successProbability: p,
    mAxisModifier: M_OS[state.phase][assignment.axis],
    humanStrength: humanStr,
    aiStrength: aiStr,
  };
}
