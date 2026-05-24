export type AIPhase = 'find' | 'understand' | 'eliminate';
export type HumanAxis = 'hiding' | 'espionage' | 'defense';
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

export interface RoundLog {
  round: number;
  phase: AIPhase;
  assignment: Assignment;
  combat: CombatResult | null;
  resourceDelta: Partial<Resources>;
  populationDelta: number;
  clanActivityDelta: number;
  aiKnowledgeDelta: number;
  revealedNodes: string[];
  narrative: string;
}

export interface GameState {
  runId: string;
  round: number;
  phase: AIPhase;
  totalRounds: number;
  population: number;
  maxPopulation: number;
  resources: Resources;
  aiPhaseProgress: number;
  aiRobots: number;
  aiKnowledge: number;
  aiTree: AITreeNode[];
  aiWeakPoints: AIWeakPoint[];
  clanActivity: number;
  rngSeed: number;
  status: 'active' | 'victory' | 'defeat_extinction' | 'defeat_overwhelmed';
  lastRoundLog: RoundLog | null;
}

export interface OddsPreview {
  successProbability: number;
  mAxisModifier: number;
  humanStrength: number;
  aiStrength: number;
}
