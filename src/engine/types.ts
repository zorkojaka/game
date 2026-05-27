// ─── Core enums ───────────────────────────────────────────────────────────────

export type AIPhase = 'find' | 'understand' | 'eliminate';
// Faza 1: Najti | Faza 2: Razumeti | Faza 3: Iztrebiti

export type HumanAxis = 'hiding' | 'espionage' | 'defense';
// Skrivanje | Špijonaža | Obramba

export type Visibility = 'unknown' | 'partial' | 'revealed';
// Megla: neznano | delno | odkrito

// ─── AI tree ──────────────────────────────────────────────────────────────────

export interface AITreeNode {
  id: string;
  phase: AIPhase;
  label: string;
  visibility: Visibility;
  strength: number; // 0–100, how strong this node is
  executed: boolean;
}

// Fiksne šibke točke AI (endgame cilji)
export interface AIWeakPoint {
  id: string;
  label: string;
  discovered: boolean;
  exploited: boolean;
  phase: AIPhase; // v kateri fazi postane relevantna
}

// ─── Resources ────────────────────────────────────────────────────────────────

export interface Resources {
  survival: number;     // voda + hrana
  combat: number;       // orožje
  intelligence: number; // intel
  material: number;     // surovina iz robotov
  artifacts: number;    // redki artefakti — vsak lahko uniči eno šibko točko
}

// ─── Assignment — kako razporediš populacijo ta mesec ─────────────────────────

// ─── Heksa mapa ──────────────────────────────────────────────────────────────
// Pointy-top heks, axial koordinate (q, r)
export interface HexTile {
  q: number;
  r: number;
  visibility: Visibility;        // izpeljana iz researchProgress (za backward compat)
  researchProgress: number;       // 0–1, kontinuirano stanje raziskanosti
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
  encountersLog: string[];        // kratki opisi srečanj/dogodkov med potjo
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
  targetTileIds?: string[];    // če objective='map'
}

export function tileId(t: { q: number; r: number }): string {
  return `${t.q},${t.r}`;
}

export interface Assignment {
  axis: HumanAxis;
  combatants: number;       // NAPAD
  defenders: number;        // OBRAMBA (enotna, brez dan/noč razdelitve)
  foragers: number;
  scouts: number;
  rations: number;
  missionAssignments?: Record<string, number>;
  missionRations?: Record<string, number>;
  scoutPlan?: ScoutPlan;
  newExpeditions?: NewExpeditionInput[];
  // Uporabi 1 artefakt za uničenje izbrane šibke točke
  useArtifactOnWpId?: string;
  // Legacy (ne uporabljati — ohranjeno za stara state-a)
  dayGuard?: number;
  nightGuard?: number;
}

export interface Mission {
  weakPointId: string;
  assigned: number;            // ljudje vključeni
  monthsTotal: number;         // koliko mesecev traja
  monthsRemaining: number;     // do konca
  successProbability: number;  // izračunana ob startu (informativno)
  rations: number;             // 1–5 obroki ekipe (vpliva na moč in stroške)
  status: 'in_progress' | 'success' | 'failed' | 'aborted';
  resultNarrative?: string;
}

// Izid AI napada na kamp
export interface RaidResult {
  occurred: boolean;
  outcome: 'victory' | 'partial' | 'defeat' | 'annihilation' | null;
  defendersLost: number;
  foragersLost: number;
  aiRobotsDestroyed: number;
  weaponsDestroyed: number;
  successProbability: number;
}

// Izid izvidniške misije
export interface ScoutResult {
  captured: boolean;          // ali jih je AI ujel
  scoutsLost: number;
  effectivenessMult: number;  // koliko intela/megle so prinesli (1.0 polno, 0.5 polovičen ipd.)
}

// ─── Combat result ────────────────────────────────────────────────────────────

export interface CombatResult {
  humanStrength: number;
  aiStrength: number;
  successProbability: number; // P(human wins) = humanStr / (humanStr + aiStr)
  mAxisModifier: number;      // M_os za izbrano os v tej fazi
  outcome: 'victory' | 'partial' | 'defeat' | 'annihilation';
  humanLost: number;
  aiRobotsDestroyed: number;
  spoils: Partial<Resources>;  // plen sorazmeren z marginom zmage
  aiInfoGained: number;        // koliko AI izve o nas iz tega spopada
  infoGained: number;          // koliko mi izvemo o AI
}

// ─── Phase transition event ───────────────────────────────────────────────────

export interface PhaseEvent {
  phase: AIPhase;
  label: string;         // npr. "AI požge Zemljo"
  narrative: string;     // zgodbovni opis prehoda
  impact: Partial<Resources & { population: number }>;
}

// ─── Full game state (deterministic) ─────────────────────────────────────────

export interface GameState {
  // Čas
  round: number;       // 1–12 znotraj faze
  phase: AIPhase;
  totalRounds: number; // globalni štetec (1–36)

  // Populacija
  population: number;
  maxPopulation: number;

  // Resursi
  resources: Resources;

  // AI
  aiPhaseProgress: number;  // 0–12, koliko rund je AI v tej fazi porabil
  aiRobots: number;
  aiKnowledge: number;      // [0,1] koliko AI ve o nas
  aiTree: AITreeNode[];
  aiWeakPoints: AIWeakPoint[];

  // Drugi klani (abstraktirano)
  clanActivity: number; // [0,1] — davek na AI silo

  // Človekova zgodovina osi — koliko rund je bila izbrana vsaka os
  // Določa odklenjene noduse v Človekovem drevesu napredka
  axisHistory: Record<HumanAxis, number>;

  // Aktivne misije proti AI šibkim točkam (timer odprave)
  activeMissions: Mission[];
  completedMissions: Mission[];

  // Stopnjevana lakota — koliko zaporednih mesecev je hrana padla pod 0
  consecutiveStarvationMonths: number;

  // Heksa mapa
  mapTiles: HexTile[];

  // Odprave (izvidniki in misije s potjo)
  expeditions: Expedition[];
  completedExpeditions: Expedition[];

  // Delavnice v kampu — izvidniki, ki delajo na razvoju orožja ali zidu
  weaponWorkshopProgress: number;  // skupna scout-meseca; vsakič ko >= scoutsAtStart * 2 → produciraj
  weaponWorkshopScouts: number;    // št. izvidnikov ob startu tekoče delavnice
  wallProgress: number;            // scout-meseci na zidu (6 scout-mesecev = 1 zid)
  wallsBuilt: number;              // skupno število zgrajenih zidov

  // RNG (determinizem)
  rngSeed: number;
  rngCallCount: number;

  // Log zadnje runde
  lastRoundLog: RoundLog | null;

  // Ali je igra končana
  status: 'active' | 'victory' | 'defeat_extinction' | 'defeat_overwhelmed';
  runId: string;  // unikatni ID za to linijo igre
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
  revealedNodes: string[];  // ID-ji odkritih AI vozlišč
  narrative: string;
}

// ─── Player action ────────────────────────────────────────────────────────────

export interface PlayerAction {
  assignment: Assignment;
  targetWeakPoint?: string; // če hočeš ciljati specifično šibko točko
}
