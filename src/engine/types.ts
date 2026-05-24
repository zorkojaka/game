export type AIPhase = 'find' | 'understand' | 'eliminate';

export type HumanAxis = 'hiding' | 'espionage' | 'defense';
export const HUMAN_AXES = ['hiding', 'espionage', 'defense'] as const;

export type Visibility = 'unknown' | 'partial' | 'revealed';

export interface AITreeNode {
  id: string;
  phase: AIPhase;
  label: string;
  visibility: Visibility;
  strength: number;
  executed: boolean;
}

export interface AIWeakPoint {
  id: string;
  label: string;
  discovered: boolean;
  exploited: boolean;
  phase: AIPhase;
}

export interface Resources {
  survival: number;
  combat: number;
  intelligence: number;
}

export interface Assignment {
  axis: HumanAxis;
  combatants: number;
  foragers: number;
  scouts: number;
}

export interface CombatResult {
  humanStrength: number;
  aiStrength: number;
  successProbability: number;
  mAxisModifier: number;
  outcome: 'victory' | 'partial' | 'defeat' | 'annihilation';
  humanLost: number;
  aiRobotsDestroyed: number;
  spoils: Partial<Resources>;
  aiInfoGained: number;
  infoGained: number;
}

export interface PhaseEvent {
  phase: AIPhase;
  label: string;
  narrative: string;
  impact: Partial<Resources & { population: number }>;
}

export type ObjectiveStatus = 'locked' | 'active' | 'disrupted' | 'completed';

export interface AICampaignObjective {
  id: string;
  title: string;
  description: string;
  phase: AIPhase;
  progress: number;
  status: ObjectiveStatus;
  visibility: Visibility;
  threatEffect: string;
  counterOperations: OperationId[];
}

export type OperationId =
  | 'hide_movement'
  | 'sabotage_scanners'
  | 'spread_misinformation'
  | 'fortify_shelters'
  | 'intercept_comms'
  | 'raid_logistics'
  | 'rescue_survivors'
  | 'gather_supplies';

export type OperationPurpose = 'hiding' | 'espionage' | 'defense' | 'survival' | 'strike';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface OperationCost {
  people: number;
  survival?: number;
  combat?: number;
  intelligence?: number;
}

export interface OperationDefinition {
  id: OperationId;
  title: string;
  purpose: OperationPurpose;
  description: string;
  required: OperationCost;
  risk: RiskLevel;
  expectedEffect: string;
  affectedObjective?: string;
}

export interface OperationOutcome {
  operationId: OperationId;
  title: string;
  success: boolean;
  summary: string;
  objectiveId?: string;
  objectiveDelta?: number;
  resourceDelta: Partial<Resources>;
  populationDelta: number;
  moraleDelta: number;
  exposureDelta: number;
  aiKnowledgeDelta: number;
  revealedObjectiveIds: string[];
}

export interface ObjectiveProgressChange {
  objectiveId: string;
  title: string;
  before: number;
  after: number;
  delta: number;
  status: ObjectiveStatus;
}

export interface GameState {
  round: number;
  phase: AIPhase;
  totalRounds: number;

  population: number;
  maxPopulation: number;
  morale: number;
  exposure: number;

  resources: Resources;

  aiPhaseProgress: number;
  aiRobots: number;
  aiKnowledge: number;
  aiTree: AITreeNode[];
  aiWeakPoints: AIWeakPoint[];
  campaignObjectives: AICampaignObjective[];

  clanActivity: number;

  rngSeed: number;
  rngCallCount: number;

  lastRoundLog: RoundLog | null;

  status: 'active' | 'victory' | 'defeat_extinction' | 'defeat_overwhelmed';
  runId: string;
}

export interface RoundLog {
  round: number;
  phase: AIPhase;
  assignment?: Assignment;
  operationIds: OperationId[];
  operationOutcomes: OperationOutcome[];
  combat: CombatResult | null;
  resourceDelta: Partial<Resources>;
  populationDelta: number;
  moraleDelta: number;
  exposureDelta: number;
  clanActivityDelta: number;
  aiKnowledgeDelta: number;
  revealedNodes: string[];
  revealedObjectives: string[];
  objectiveProgress: ObjectiveProgressChange[];
  nextThreat: string | null;
  narrative: string;
}

export interface PlayerAction {
  operationIds: OperationId[];
  targetWeakPoint?: string;
}

export interface OperationPreview {
  operationId: OperationId;
  title: string;
  canRun: boolean;
  reason?: string;
  expectedEffect: string;
  affectedObjective?: string;
  required: OperationCost;
  risk: RiskLevel;
}
