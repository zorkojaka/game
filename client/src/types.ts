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
  material: number;
  artifacts: number;
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
  otherClanId?: string;
}

export type ClanSpecialty = 'food' | 'weapons' | 'material' | 'people';
export interface OtherClan {
  id: string;
  label: string;
  q: number;
  r: number;
  discovered: boolean;
  allied: boolean;
  specialty: ClanSpecialty;
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

export type ScoutObjective = 'ai_robots' | 'ai_weakpoints' | 'weapon_dev' | 'wall_dev';

export interface ScoutPlan {
  objective: ScoutObjective;
  targetTileIds?: string[];
}

export function tileId(t: { q: number; r: number }): string {
  return `${t.q},${t.r}`;
}

export type WorkshopObjective = 'weapon' | 'wall';
export type ResearchObjective = 'robots' | 'weakpoints';

export interface Assignment {
  axis: HumanAxis;
  combatants: number;
  defenders: number;
  foragers: number;
  workers: number;
  researchers: number;
  workshopObjective?: WorkshopObjective;
  researchObjective?: ResearchObjective;
  rations: number;
  missionAssignments?: Record<string, number>;
  missionRations?: Record<string, number>;
  newExpeditions?: NewExpeditionInput[];
  useArtifactOnWpId?: string;
  scouts?: number;
  scoutPlan?: ScoutPlan;
  dayGuard?: number;
  nightGuard?: number;
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
  defendersLost: number;
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
  otherClans: OtherClan[];
  expeditions: Expedition[];
  completedExpeditions: Expedition[];
  weaponWorkshopProgress: number;
  weaponWorkshopScouts: number;
  wallProgress: number;
  wallsBuilt: number;
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
