// ─── Core enums ───────────────────────────────────────────────────────────────

export type AIPhase = 'find' | 'understand' | 'eliminate';
// Faza 1: Najti | Faza 2: Razumeti | Faza 3: Iztrebiti

export type HumanAxis = 'obzidje' | 'orozje' | 'roboti';
// Skrivanje | Špijonaža | Obramba

export type Visibility = 'unknown' | 'partial' | 'revealed';
// Megla: neznano | delno | odkrito

// ─── AI tree ──────────────────────────────────────────────────────────────────

export type AINodeRole = 'unit' | 'mechanical' | 'logical';

export interface AITreeNode {
  id: string;
  phase: AIPhase;
  label: string;
  visibility: Visibility;
  strength: number; // 0–100, how strong this node is
  executed: boolean;
  role: AINodeRole;       // 1=enota, 2=mehanska šibka točka, 3=logična šibka točka
  robot: 'scouts' | 'attackers' | 'peopleKillers';  // kateri tip robota zadeva
  insightThreshold: number;  // koliko aiInsight je potrebno za razkritje
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
  otherClanId?: string;   // drug človeški klan na tem polju (zaveznik)
}

// Drugi človeški klani na mapi — najdeš jih z raziskovanjem, z njimi sodeluješ
export type ClanSpecialty = 'food' | 'weapons' | 'material' | 'people';
export interface OtherClan {
  id: string;
  label: string;
  q: number;
  r: number;
  discovered: boolean;   // odkrit (raziskan njihov heks)
  allied: boolean;       // navezan stik (odprava dospela do njih)
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
  encountersLog: string[];        // kratki opisi srečanj/dogodkov med potjo
  stealth?: boolean;              // način skrivanja: trajanje +50 %, srečanja ×0.5, boj +20 %
  returnRemaining?: number;       // ko je status 'returning': mesecev do vrnitve v kamp
  carried?: { material: number; weapons: number; artifacts: number };  // najdbe/plen, ki jih nosijo (dostavljeno šele ob vrnitvi)
}

export interface NewExpeditionInput {
  kind: ExpeditionKind;
  weakPointId?: string;
  path: Array<{ q: number; r: number }>;
  assigned: number;
  rations: number;
  stealth?: boolean;
}

export type ScoutObjective = 'ai_robots' | 'ai_weakpoints' | 'weapon_dev' | 'wall_dev';

export interface ScoutPlan {
  objective: ScoutObjective;
  targetTileIds?: string[];    // če objective='map'
}

export function tileId(t: { q: number; r: number }): string {
  return `${t.q},${t.r}`;
}

export type WorkshopObjective = 'weapon' | 'wall' | 'artifact';
export type ResearchObjective = 'robots' | 'weapon' | 'wall';

export interface Assignment {
  axis: HumanAxis;
  combatants: number;       // NAPAD
  defenders: number;        // OBRAMBA
  foragers: number;         // HRANA
  workers: number;          // DELAVCI — delavnica (orožje/zid)
  researchers: number;      // RAZISKOVALCI — raziskava (AI roboti/ranljivosti)
  workshopObjective?: WorkshopObjective;  // kaj delavci delajo
  researchObjective?: ResearchObjective;  // kaj raziskovalci raziskujejo
  rations: number;
  missionAssignments?: Record<string, number>;
  missionRations?: Record<string, number>;
  newExpeditions?: NewExpeditionInput[];
  // Legacy
  scouts?: number;
  scoutPlan?: ScoutPlan;
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

export type CampArea = 'food' | 'workshop' | 'research' | 'defense';

// Izid AI napada na kamp
export interface RaidResult {
  occurred: boolean;
  outcome: 'victory' | 'partial' | 'defeat' | 'annihilation' | null;
  defendersLost: number;
  foragersLost: number;
  workersLost: number;        // žrtve v delavnici (če prebito)
  researchersLost: number;    // žrtve v raziskavah (če prebito)
  aiRobotsDestroyed: number;
  weaponsDestroyed: number;   // uničeno orožje (skladišče + delavnica)
  survivalDestroyed: number;  // uničena hrana (prehrana prebita)
  materialDestroyed: number;  // uničen material (raziskave prebite)
  wallsDestroyed: number;     // porušene stopnje obzidja (obramba prebita)
  breachedAreas: CampArea[];  // katera območja kampa je AI opustošil
  successProbability: number;
}

/** Razčlemba AI robotov po tipu enote. Vsota = aiRobots. */
export interface AIUnits {
  scouts: number;        // izvidniške enote (faza 1) — ženejo srečanja/odkrivanje
  attackers: number;     // napadalne enote (faza 2) — ženejo raide na kamp
  peopleKillers: number; // people-killer enote (faza 3) — večajo žrtve med napadi
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
  aiRobots: number;         // skupno število robotov (= vsota aiUnits)
  aiUnits: AIUnits;         // razčlemba po tipu enote (evidenca)
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

  // Drugi človeški klani (zavezniki)
  otherClans: OtherClan[];

  // Odprave (izvidniki in misije s potjo)
  expeditions: Expedition[];
  completedExpeditions: Expedition[];

  // Delavnice v kampu — delavec-mesecev na vsako stvar (napredek se ohrani ob preklopu)
  weaponWorkshopProgress: number;     // delavec-mesecev za orožje (vsakih 6 = +1 orožje)
  weaponWorkshopScouts: number;       // legacy, ohranjeno za star state
  wallProgress: number;               // delavec-mesecev za obzidje (vsakih 12 = +1 obzidje)
  wallsBuilt: number;                 // skupno število zgrajenih obzidij
  artifactWorkshopProgress: number;   // delavec-mesecev za artefakt (vsakih 360 = +1 artefakt)

  // Raziskave nadgradenj (vsak level ×2 učinka; 120 raziskovalec-mesecev na level)
  robotsResearchLevel: number;        // roboti: odkrivanje šibkih točk; odklene orožje/obzidje
  robotsResearchProgress: number;
  weaponResearchLevel: number;        // orožje: napad ×2 na level (zaklenjeno za roboti level)
  weaponResearchProgress: number;     // raziskovalec-mesecev proti naslednjemu levelu
  wallResearchLevel: number;          // obzidje: obramba ×2 na level (zaklenjeno za roboti level)
  wallResearchProgress: number;

  // Naše znanje o AI [0,1] — odpira AI drevo (start 1 %, faze do 30/60/90 %)
  aiInsight: number;

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
