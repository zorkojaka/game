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

export interface HexTile {
  q: number;
  r: number;
  visibility: Visibility;
  researchProgress: number;     // 0–1
  fogDensity: number;
  distanceToCore: number;
  isClanCamp: boolean;
  isAICore: boolean;
  hidesWeakPointId?: string;
}

export type ExpeditionKind = 'scout' | 'mission';
export type ExpeditionStatus = 'traveling' | 'completed' | 'lost' | 'returning';

export interface Expedition {
  id: string;
  kind: ExpeditionKind;
  weakPointId?: string;
  path: Array<{ q: number; r: number }>;
  currentIndex: number;
  assigned: number;
  rations: number;
  status: ExpeditionStatus;
  monthsElapsed: number;
  encountersLog: string[];
}

export interface NewExpeditionInput {
  kind: ExpeditionKind;
  weakPointId?: string;
  path: Array<{ q: number; r: number }>;
  assigned: number;
  rations: number;
}

export type ScoutObjective = 'map' | 'ai_robots' | 'ai_weakpoints';

export interface ScoutPlan {
  objective: ScoutObjective;
  targetTileIds?: string[];
}

export function tileId(t: { q: number; r: number }): string {
  return `${t.q},${t.r}`;
}

export interface Assignment {
  axis: HumanAxis;
  combatants: number;
  dayGuard: number;
  nightGuard: number;
  foragers: number;
  scouts: number;
  rations: number;
  missionAssignments?: Record<string, number>;
  missionRations?: Record<string, number>;
  scoutPlan?: ScoutPlan;
  newExpeditions?: NewExpeditionInput[];
}

export interface Mission {
  weakPointId: string;
  assigned: number;
  monthsTotal: number;
  monthsRemaining: number;
  successProbability: number;
  rations: number;
  status: 'in_progress' | 'success' | 'failed' | 'aborted';
  resultNarrative?: string;
}

export interface RaidResult {
  occurred: boolean;
  outcome: 'victory' | 'partial' | 'defeat' | 'annihilation' | null;
  timeOfDay: 'day' | 'night' | null;
  defendersLost: number;
  sleepersLost: number;
  foragersLost: number;
  aiRobotsDestroyed: number;
  weaponsDestroyed: number;
  successProbability: number;
}

export interface ScoutResult {
  captured: boolean;
  scoutsLost: number;
  effectivenessMult: number;
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
  axisHistory: Record<HumanAxis, number>;
  activeMissions: Mission[];
  completedMissions: Mission[];
  consecutiveStarvationMonths: number;
  mapTiles: HexTile[];
  expeditions: Expedition[];
  completedExpeditions: Expedition[];
  rngSeed: number;
  status: 'active' | 'victory' | 'defeat_extinction' | 'defeat_overwhelmed';
  lastRoundLog: RoundLog | null;
}

export interface OddsPreview {
  successProbability: number;
  mAxisModifier: number;
  humanStrength: number;
  aiStrength: number;
  raidProbability: number;
  raidRepelProbability: number;
  raidRepelProbabilityDay: number;
  raidRepelProbabilityNight: number;
  scoutSuccessProbability: number;
  scoutCaptureProbability: number;
  forageSafetyProbability: number;
  intelBonus: number;               // koeficient iz intela [0–MAX]
  weaponCap: number;                // max ljudi v boju (= orožje)
  missionPreviews: Record<string, { successProbability: number; encounterPerMonth: number; monthsTotal: number }>;
}

export interface RoundLog {
  round: number;
  phase: AIPhase;
  assignment: Assignment;
  combat: CombatResult | null;
  raid: RaidResult | null;
  scout: ScoutResult | null;
  resourceDelta: Partial<Resources>;
  populationDelta: number;
  clanActivityDelta: number;
  aiKnowledgeDelta: number;
  revealedNodes: string[];
  narrative: string;
}
