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
  survival: number;    // voda + hrana — hranijo populacijo
  combat: number;      // orožje + material — moč v spopadu
  intelligence: number; // info iz raziskav — odgrinja meglo
}

// ─── Assignment — kako razporediš populacijo ta mesec ─────────────────────────

export interface Assignment {
  axis: HumanAxis;          // kateri osi daš fokus
  combatants: number;       // koliko jih pošlješ v spopad/akcijo
  foragers: number;         // iščejo preživetvene vire
  scouts: number;           // špijonaža / research (info vir)
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
