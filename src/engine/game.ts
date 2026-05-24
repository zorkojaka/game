import type {
  AICampaignObjective,
  AIPhase,
  GameState,
  ObjectiveProgressChange,
  OperationId,
  OperationOutcome,
  OperationPreview,
  PlayerAction,
  Resources,
  RoundLog,
} from './types.js';
import type { RNGState } from './rng.js';
import { rngBool, rngInt, seedFromString } from './rng.js';
import { generateAICampaignObjectives, generateAITree, generateAIWeakPoints } from './ai-brain.js';
import { getOperationDefinition, OPERATION_DEFINITIONS } from './operations.js';
import {
  BASE_OBJECTIVE_PROGRESS,
  DEFENSE_DAMAGE_REDUCTION,
  EXPOSED_OBJECTIVE_BONUS,
  HIDDEN_OBJECTIVE_PENALTY,
  INITIAL_AI_KNOWLEDGE,
  INITIAL_AI_ROBOTS,
  INITIAL_CLAN_ACTIVITY,
  INITIAL_COMBAT,
  INITIAL_EXPOSURE,
  INITIAL_INTELLIGENCE,
  INITIAL_MORALE,
  INITIAL_POPULATION,
  INITIAL_SURVIVAL,
  SURVIVAL_PER_PERSON_PER_ROUND,
} from './constants.js';

export function newGame(seed?: number): GameState {
  const runId = Date.now().toString(36);
  const rngSeed = seed ?? seedFromString(runId);

  return {
    round: 1,
    phase: 'find',
    totalRounds: 1,
    population: INITIAL_POPULATION,
    maxPopulation: INITIAL_POPULATION,
    morale: INITIAL_MORALE,
    exposure: INITIAL_EXPOSURE,
    resources: {
      survival: INITIAL_SURVIVAL,
      combat: INITIAL_COMBAT,
      intelligence: INITIAL_INTELLIGENCE,
    },
    aiPhaseProgress: 18,
    aiRobots: INITIAL_AI_ROBOTS,
    aiKnowledge: INITIAL_AI_KNOWLEDGE,
    aiTree: generateAITree(),
    aiWeakPoints: generateAIWeakPoints(),
    campaignObjectives: generateAICampaignObjectives(),
    clanActivity: INITIAL_CLAN_ACTIVITY,
    rngSeed,
    rngCallCount: 0,
    lastRoundLog: null,
    status: 'active',
    runId,
  };
}

export function processRound(state: GameState, action: PlayerAction): GameState {
  if (state.status !== 'active') return state;

  let rng: RNGState = { seed: state.rngSeed, calls: state.rngCallCount };
  const operationIds = [...new Set(action.operationIds)];
  const operations = operationIds
    .map(id => getOperationDefinition(id))
    .filter(operation => operation !== undefined);

  const startingResources = state.resources;
  const startingPopulation = state.population;
  const startingMorale = state.morale;
  const startingExposure = state.exposure;
  const startingAiKnowledge = state.aiKnowledge;

  let resources: Resources = {
    survival: Math.max(0, state.resources.survival - state.population * SURVIVAL_PER_PERSON_PER_ROUND),
    combat: state.resources.combat,
    intelligence: state.resources.intelligence,
  };
  let population = state.population;
  let maxPopulation = state.maxPopulation;
  let morale = state.morale;
  let exposure = state.exposure;
  let aiKnowledge = state.aiKnowledge;
  let aiRobots = state.aiRobots;
  let clanActivity = state.clanActivity;
  let objectives = refreshObjectives(state.campaignObjectives);
  let revealedNodes: string[] = [];
  let revealedObjectives: string[] = [];
  let operationOutcomes: OperationOutcome[] = [];
  let defensePrepared = false;
  const objectiveAdjustments = new Map<string, number>();

  for (const operation of operations) {
    resources = spendOperationCost(resources, operation.required);

    const outcomeBase = {
      operationId: operation.id,
      title: operation.title,
      objectiveId: operation.affectedObjective,
      objectiveDelta: 0,
      resourceDelta: {} as Partial<Resources>,
      populationDelta: 0,
      moraleDelta: 0,
      exposureDelta: 0,
      aiKnowledgeDelta: 0,
      revealedObjectiveIds: [] as string[],
    };

    let success = true;
    if (operation.risk !== 'low') {
      const chance = operation.risk === 'medium'
        ? 0.74 - exposure * 0.18 + morale / 500
        : 0.58 - exposure * 0.22 + morale / 450;
      const [passed, nextRng] = rngBool(rng, clamp(chance, 0.25, 0.9));
      rng = nextRng;
      success = passed;
    }

    let summary = '';

    switch (operation.id) {
      case 'hide_movement': {
        const delta = -12;
        addObjectiveAdjustment(objectiveAdjustments, 'scan_wilderness', delta);
        exposure = clamp(exposure - 0.14, 0, 1);
        aiKnowledge = clamp(aiKnowledge - 0.03, 0, 1);
        resources.intelligence = Math.max(0, resources.intelligence - 2);
        summary = 'Movement discipline cut sensor confidence, but scouts brought back less raw intel.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: 'scan_wilderness',
          objectiveDelta: delta,
          exposureDelta: -0.14,
          aiKnowledgeDelta: -0.03,
          resourceDelta: { intelligence: -2 },
        });
        break;
      }
      case 'sabotage_scanners': {
        const delta = success ? -24 : -8;
        addObjectiveAdjustment(objectiveAdjustments, 'scan_wilderness', delta);
        aiRobots = Math.max(0, aiRobots - (success ? 8 : 2));
        exposure = clamp(exposure + (success ? 0.05 : 0.12), 0, 1);
        if (!success) {
          const [losses, nextRng] = rngInt(rng, 2, 5);
          rng = nextRng;
          population = Math.max(0, population - losses);
          morale = clamp(morale - 4, 0, 100);
          outcomeBase.populationDelta = -losses;
          outcomeBase.moraleDelta = -4;
        }
        summary = success
          ? 'A scanner relay burned before it could upload its sweep package.'
          : 'The cell damaged the relay, but hunter drones followed the retreat.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: 'scan_wilderness',
          objectiveDelta: delta,
          exposureDelta: success ? 0.05 : 0.12,
        });
        break;
      }
      case 'spread_misinformation': {
        const target = firstObjectiveByIds(objectives, ['analyze_patterns', 'build_prediction_model'])?.id ?? 'analyze_patterns';
        const delta = success ? -18 : -6;
        addObjectiveAdjustment(objectiveAdjustments, target, delta);
        aiKnowledge = clamp(aiKnowledge - (success ? 0.06 : 0.02), 0, 1);
        exposure = clamp(exposure + 0.03, 0, 1);
        summary = success
          ? 'False trails polluted AI pattern analysis and forced a model rollback.'
          : 'The lie spread unevenly, buying time but exposing a few relay points.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: target,
          objectiveDelta: delta,
          exposureDelta: 0.03,
          aiKnowledgeDelta: success ? -0.06 : -0.02,
        });
        break;
      }
      case 'fortify_shelters': {
        defensePrepared = true;
        morale = clamp(morale + 5, 0, 100);
        exposure = clamp(exposure + 0.02, 0, 1);
        addObjectiveAdjustment(objectiveAdjustments, 'prepare_strike', -8);
        summary = 'Shelters were hardened and evacuation cells rehearsed the strike protocol.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: 'prepare_strike',
          objectiveDelta: -8,
          moraleDelta: 5,
          exposureDelta: 0.02,
        });
        break;
      }
      case 'intercept_comms': {
        const reveal = revealNextObjective(objectives);
        objectives = reveal.objectives;
        revealedObjectives = [...revealedObjectives, ...reveal.revealedIds];
        resources.intelligence += success ? 12 : 5;
        aiKnowledge = clamp(aiKnowledge + (success ? 0.01 : 0.04), 0, 1);
        const target = reveal.revealedIds[0] ?? activeObjective(objectives)?.id;
        if (target) addObjectiveAdjustment(objectiveAdjustments, target, success ? -10 : -3);
        summary = success
          ? 'Intercepted tasking bursts exposed the next AI campaign package.'
          : 'Static hid most of the burst, but the clan still recovered fragments.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: target,
          objectiveDelta: success ? -10 : -3,
          resourceDelta: { intelligence: success ? 12 : 5 },
          aiKnowledgeDelta: success ? 0.01 : 0.04,
          revealedObjectiveIds: reveal.revealedIds,
        });
        break;
      }
      case 'raid_logistics': {
        const target = firstObjectiveByIds(objectives, ['locate_bases', 'prepare_strike'])?.id ?? activeObjective(objectives)?.id;
        const delta = success ? -20 : -6;
        if (target) addObjectiveAdjustment(objectiveAdjustments, target, delta);
        aiRobots = Math.max(0, aiRobots - (success ? 14 : 4));
        exposure = clamp(exposure + (success ? 0.08 : 0.16), 0, 1);
        if (!success) {
          const [losses, nextRng] = rngInt(rng, 3, 7);
          rng = nextRng;
          population = Math.max(0, population - losses);
          morale = clamp(morale - 5, 0, 100);
          outcomeBase.populationDelta = -losses;
          outcomeBase.moraleDelta = -5;
        }
        summary = success
          ? 'The convoy was stripped before reinforcement drones reached the objective line.'
          : 'The raid scattered a convoy, but return fire cost the clan dearly.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          objectiveId: target,
          objectiveDelta: delta,
          exposureDelta: success ? 0.08 : 0.16,
        });
        break;
      }
      case 'rescue_survivors': {
        const [found, nextRng] = rngInt(rng, success ? 4 : 1, success ? 8 : 4);
        rng = nextRng;
        population += found;
        maxPopulation = Math.max(maxPopulation, population);
        morale = clamp(morale + (success ? 6 : 2), 0, 100);
        exposure = clamp(exposure + 0.09, 0, 1);
        summary = success
          ? 'A trapped group reached the shelter network before AI harvest teams arrived.'
          : 'Only a few survivors made it through the search cordon.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          populationDelta: found,
          moraleDelta: success ? 6 : 2,
          exposureDelta: 0.09,
        });
        break;
      }
      case 'gather_supplies': {
        resources.survival += 52;
        resources.combat += 4;
        exposure = clamp(exposure + 0.04, 0, 1);
        summary = 'Scavengers returned with water filters, rations, batteries, and usable metal.';
        operationOutcomes.push({
          ...outcomeBase,
          success,
          summary,
          resourceDelta: { survival: 52, combat: 4 },
          exposureDelta: 0.04,
        });
        break;
      }
    }
  }

  let progressChanges: ObjectiveProgressChange[] = [];
  const active = activeObjective(objectives);
  if (active) {
    const before = active.progress;
    const modelBonus = objectives.some(o => o.id === 'build_prediction_model' && o.status === 'completed') ? 5 : 0;
    const baseDelta = BASE_OBJECTIVE_PROGRESS
      + Math.round(exposure * EXPOSED_OBJECTIVE_BONUS)
      + modelBonus
      - (exposure < 0.25 ? HIDDEN_OBJECTIVE_PENALTY : 0);
    addObjectiveAdjustment(objectiveAdjustments, active.id, baseDelta);
    progressChanges.push({
      objectiveId: active.id,
      title: active.title,
      before,
      after: before,
      delta: baseDelta,
      status: active.status,
    });
  }

  const applied = applyObjectiveAdjustments(objectives, objectiveAdjustments);
  objectives = applied.objectives;
  progressChanges = mergeProgressChanges(progressChanges, applied.progressChanges);

  const completions = completeObjectives(objectives);
  objectives = completions.objectives;
  progressChanges = mergeProgressChanges(progressChanges, completions.progressChanges);

  const threat = applyCompletedThreats(completions.completed, {
    resources,
    population,
    morale,
    exposure,
    aiKnowledge,
    defensePrepared,
  });
  resources = threat.resources;
  population = threat.population;
  morale = threat.morale;
  exposure = threat.exposure;
  aiKnowledge = threat.aiKnowledge;

  if (resources.survival <= 0) {
    const [starveDelta, nextRng] = rngInt(rng, 2, 7);
    rng = nextRng;
    population = Math.max(0, population - starveDelta);
    morale = clamp(morale - 6, 0, 100);
  }

  aiKnowledge = clamp(aiKnowledge + Math.max(0, exposure - 0.35) * 0.08, 0, 1);
  clanActivity = clamp(clanActivity - 0.004 - exposure * 0.004, 0, 1);

  const phase = currentCampaignPhase(objectives);
  const aiPhaseProgress = activeObjective(objectives)?.progress ?? 100;
  const finalStatus = determineStatus(state.status, population, aiKnowledge, exposure, objectives, aiRobots);
  const nextVisibleThreat = nextThreat(objectives);
  const narrative = buildNarrative(operationOutcomes, completions.completed, threat.summaries, nextVisibleThreat);

  const log: RoundLog = {
    round: state.round,
    phase,
    operationIds,
    operationOutcomes,
    combat: null,
    resourceDelta: {
      survival: resources.survival - startingResources.survival,
      combat: resources.combat - startingResources.combat,
      intelligence: resources.intelligence - startingResources.intelligence,
    },
    populationDelta: population - startingPopulation,
    moraleDelta: morale - startingMorale,
    exposureDelta: exposure - startingExposure,
    clanActivityDelta: clanActivity - state.clanActivity,
    aiKnowledgeDelta: aiKnowledge - startingAiKnowledge,
    revealedNodes,
    revealedObjectives,
    objectiveProgress: progressChanges,
    nextThreat: nextVisibleThreat,
    narrative,
  };

  return {
    ...state,
    round: state.round + 1,
    phase,
    totalRounds: state.totalRounds + 1,
    population,
    maxPopulation,
    morale,
    exposure,
    resources,
    aiPhaseProgress,
    aiRobots,
    aiKnowledge,
    campaignObjectives: objectives,
    clanActivity,
    rngCallCount: rng.calls,
    lastRoundLog: log,
    status: finalStatus,
  };
}

export function previewOperations(state: GameState, operationIds: OperationId[]): OperationPreview[] {
  const selected = new Set<OperationId>();
  let people = 0;
  let survival = state.resources.survival;
  let combat = state.resources.combat;
  let intelligence = state.resources.intelligence;

  return operationIds.map(id => {
    const definition = getOperationDefinition(id);
    if (!definition) {
      return {
        operationId: id,
        title: id,
        canRun: false,
        reason: 'Unknown operation',
        expectedEffect: '',
        required: { people: 0 },
        risk: 'low',
      };
    }

    selected.add(id);
    people += definition.required.people;
    survival -= definition.required.survival ?? 0;
    combat -= definition.required.combat ?? 0;
    intelligence -= definition.required.intelligence ?? 0;

    const reason =
      selected.size > 3 ? 'Only three operations can run each month'
        : people > state.population ? 'Not enough available people'
        : survival < 0 ? 'Not enough survival resources'
        : combat < 0 ? 'Not enough combat resources'
        : intelligence < 0 ? 'Not enough intel'
        : undefined;

    return {
      operationId: definition.id,
      title: definition.title,
      canRun: reason === undefined,
      reason,
      expectedEffect: definition.expectedEffect,
      affectedObjective: definition.affectedObjective,
      required: definition.required,
      risk: definition.risk,
    };
  });
}

export { OPERATION_DEFINITIONS };

function spendOperationCost(resources: Resources, cost: { survival?: number; combat?: number; intelligence?: number }): Resources {
  return {
    survival: Math.max(0, resources.survival - (cost.survival ?? 0)),
    combat: Math.max(0, resources.combat - (cost.combat ?? 0)),
    intelligence: Math.max(0, resources.intelligence - (cost.intelligence ?? 0)),
  };
}

function refreshObjectives(objectives: AICampaignObjective[]): AICampaignObjective[] {
  const refreshed = objectives.map(objective =>
    objective.status === 'disrupted' ? { ...objective, status: 'active' as const } : { ...objective }
  );
  return unlockNextObjective(refreshed);
}

function unlockNextObjective(objectives: AICampaignObjective[]): AICampaignObjective[] {
  const hasActive = objectives.some(objective => objective.status === 'active' || objective.status === 'disrupted');
  if (hasActive) return objectives;
  const idx = objectives.findIndex(objective => objective.status === 'locked');
  if (idx < 0) return objectives;
  return objectives.map((objective, i) =>
    i === idx
      ? { ...objective, status: 'active', visibility: objective.visibility === 'unknown' ? 'partial' : objective.visibility }
      : objective
  );
}

function activeObjective(objectives: AICampaignObjective[]): AICampaignObjective | undefined {
  return objectives.find(objective => objective.status === 'active' || objective.status === 'disrupted');
}

function firstObjectiveByIds(objectives: AICampaignObjective[], ids: string[]): AICampaignObjective | undefined {
  return ids
    .map(id => objectives.find(objective => objective.id === id && objective.status !== 'completed'))
    .find(objective => objective !== undefined);
}

function revealNextObjective(objectives: AICampaignObjective[]): { objectives: AICampaignObjective[]; revealedIds: string[] } {
  const idx = objectives.findIndex(objective => objective.visibility !== 'revealed');
  if (idx < 0) return { objectives, revealedIds: [] };
  return {
    objectives: objectives.map((objective, i) =>
      i === idx ? { ...objective, visibility: 'revealed' } : objective
    ),
    revealedIds: [objectives[idx].id],
  };
}

function addObjectiveAdjustment(adjustments: Map<string, number>, objectiveId: string, delta: number): void {
  adjustments.set(objectiveId, (adjustments.get(objectiveId) ?? 0) + delta);
}

function applyObjectiveAdjustments(
  objectives: AICampaignObjective[],
  adjustments: Map<string, number>
): { objectives: AICampaignObjective[]; progressChanges: ObjectiveProgressChange[] } {
  const progressChanges: ObjectiveProgressChange[] = [];
  const nextObjectives = objectives.map(objective => {
    const delta = adjustments.get(objective.id) ?? 0;
    if (delta === 0 || objective.status === 'locked' || objective.status === 'completed') return objective;

    const before = objective.progress;
    const after = clamp(before + delta, 0, 100);
    const status = delta < -8 && after < 100 ? 'disrupted' : objective.status;
    progressChanges.push({
      objectiveId: objective.id,
      title: objective.title,
      before,
      after,
      delta: after - before,
      status,
    });
    return { ...objective, progress: after, status };
  });

  return { objectives: nextObjectives, progressChanges };
}

function completeObjectives(objectives: AICampaignObjective[]): {
  objectives: AICampaignObjective[];
  completed: AICampaignObjective[];
  progressChanges: ObjectiveProgressChange[];
} {
  const completed: AICampaignObjective[] = [];
  let nextObjectives = objectives.map(objective => {
    if (objective.status !== 'completed' && objective.progress >= 100) {
      const next = { ...objective, progress: 100, status: 'completed' as const, visibility: 'revealed' as const };
      completed.push(next);
      return next;
    }
    return objective;
  });
  nextObjectives = unlockNextObjective(nextObjectives);
  return { objectives: nextObjectives, completed, progressChanges: [] };
}

function applyCompletedThreats(
  completed: AICampaignObjective[],
  state: {
    resources: Resources;
    population: number;
    morale: number;
    exposure: number;
    aiKnowledge: number;
    defensePrepared: boolean;
  }
): {
  resources: Resources;
  population: number;
  morale: number;
  exposure: number;
  aiKnowledge: number;
  summaries: string[];
} {
  let { resources, population, morale, exposure, aiKnowledge } = state;
  const reduction = state.defensePrepared ? DEFENSE_DAMAGE_REDUCTION : 0;
  const damage = (value: number) => Math.ceil(value * (1 - reduction));
  const summaries: string[] = [];

  for (const objective of completed) {
    if (objective.id === 'scan_wilderness') {
      exposure = clamp(exposure + 0.14, 0, 1);
      aiKnowledge = clamp(aiKnowledge + 0.05, 0, 1);
      summaries.push('AI scanner coverage tightened around the clan routes.');
    }
    if (objective.id === 'analyze_patterns') {
      aiKnowledge = clamp(aiKnowledge + 0.12, 0, 1);
      morale = clamp(morale - damage(4), 0, 100);
      summaries.push('AI pattern analysis made the clan more predictable.');
    }
    if (objective.id === 'identify_leaders') {
      population = Math.max(0, population - damage(3));
      morale = clamp(morale - damage(10), 0, 100);
      aiKnowledge = clamp(aiKnowledge + 0.12, 0, 1);
      summaries.push('AI leader targeting hit command cells and morale.');
    }
    if (objective.id === 'build_prediction_model') {
      aiKnowledge = clamp(aiKnowledge + 0.08, 0, 1);
      summaries.push('AI prediction models will accelerate later objectives.');
    }
    if (objective.id === 'locate_bases') {
      resources = { ...resources, survival: Math.max(0, resources.survival - damage(28)) };
      population = Math.max(0, population - damage(5));
      exposure = clamp(exposure + 0.12, 0, 1);
      summaries.push('AI located parts of the shelter network and struck supply reserves.');
    }
    if (objective.id === 'prepare_strike') {
      population = Math.max(0, population - damage(exposure > 0.55 ? 18 : 9));
      resources = {
        ...resources,
        survival: Math.max(0, resources.survival - damage(36)),
        combat: Math.max(0, resources.combat - damage(14)),
      };
      morale = clamp(morale - damage(18), 0, 100);
      summaries.push('The extermination strike landed against known clan infrastructure.');
    }
  }

  return { resources, population, morale, exposure, aiKnowledge, summaries };
}

function currentCampaignPhase(objectives: AICampaignObjective[]): AIPhase {
  const active = activeObjective(objectives);
  if (active) return active.phase;
  const lastCompleted = [...objectives].reverse().find(objective => objective.status === 'completed');
  return lastCompleted?.phase ?? 'find';
}

function determineStatus(
  current: GameState['status'],
  population: number,
  aiKnowledge: number,
  exposure: number,
  objectives: AICampaignObjective[],
  aiRobots: number
): GameState['status'] {
  if (population <= 0) return 'defeat_extinction';
  const finalStrike = objectives.find(objective => objective.id === 'prepare_strike');
  if (finalStrike?.status === 'completed' && (aiKnowledge >= 0.82 || exposure >= 0.72)) return 'defeat_overwhelmed';
  if (aiKnowledge >= 1.0) return 'defeat_overwhelmed';
  if (aiRobots <= 0) return 'victory';
  return current;
}

function nextThreat(objectives: AICampaignObjective[]): string | null {
  const visible = objectives.find(objective =>
    objective.status !== 'completed' && objective.visibility !== 'unknown'
  );
  return visible ? `${visible.title}: ${visible.threatEffect}` : null;
}

function buildNarrative(
  outcomes: OperationOutcome[],
  completed: AICampaignObjective[],
  threatSummaries: string[],
  nextVisibleThreat: string | null
): string {
  const successful = outcomes.filter(outcome => outcome.success).length;
  const disrupted = outcomes.filter(outcome => (outcome.objectiveDelta ?? 0) < -8).length;
  const parts = [
    `${outcomes.length} operation(s) executed; ${successful} achieved their primary effect.`,
  ];
  if (disrupted > 0) parts.push(`${disrupted} AI objective track(s) were disrupted.`);
  if (completed.length > 0) {
    parts.push(`AI completed: ${completed.map(objective => objective.title).join(', ')}.`);
  }
  parts.push(...threatSummaries);
  if (nextVisibleThreat) parts.push(`Next visible threat: ${nextVisibleThreat}`);
  return parts.join(' ');
}

function mergeProgressChanges(
  a: ObjectiveProgressChange[],
  b: ObjectiveProgressChange[]
): ObjectiveProgressChange[] {
  const merged = new Map<string, ObjectiveProgressChange>();
  for (const change of [...a, ...b]) {
    const existing = merged.get(change.objectiveId);
    if (!existing) {
      merged.set(change.objectiveId, change);
      continue;
    }
    merged.set(change.objectiveId, {
      ...change,
      before: existing.before,
      delta: change.after - existing.before,
    });
  }
  return [...merged.values()];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
