// ─── Vse konstante so tukaj — spreminjaš med testiranjem ─────────────────────
// Razvrstitev: začetno stanje | balans spopada | krivulja klanov | resursi | AI

import type { AIPhase, HumanAxis, AIUnits } from './types.js';

// ─── Strukturne konstante (ne balasiraj) ──────────────────────────────────────
export const ROUNDS_PER_PHASE = 12;
export const NUM_PHASES = 3;
export const TOTAL_ROUNDS = ROUNDS_PER_PHASE * NUM_PHASES;

// ─── Začetno stanje ────────────────────────────────────────────────────────────
export const INITIAL_POPULATION = 80;
export const INITIAL_SURVIVAL = 120;   // meseci hrane/vode
export const INITIAL_COMBAT = 60;      // enote orožja
export const INITIAL_INTELLIGENCE = 10; // začetni intel
export const INITIAL_MATERIAL = 30;     // začetni material za delavnice
export const INITIAL_AI_ROBOTS = 200;

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  AI ENOTE — CENTRALNE NASTAVITVE ZA KALIBRACIJO TEŽAVNOSTI                 ║
// ║  Spreminjaj te vrednosti za uravnoteženje. Vsaka enota: koliko jih pride   ║
// ║  (po fazah), napad (raid), obramba (ko jih napademo), življenje (hp).      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
export interface AIUnitDef {
  arrivalPhase: AIPhase;  // v kateri fazi se pripeljejo
  arrival: number;        // koliko enot
  attack: number;         // ofenzivna moč (raid na kamp)
  defense: number;        // obrambna moč (ko jih igralec napade)
  hp: number;             // vzdržljivost — višji hp = težje uničljive
}
export const AI_UNIT_DEFS: Record<'scouts' | 'attackers' | 'peopleKillers', AIUnitDef> = {
  // faza 1: izvidniki — šibki, a tudi oni napadajo (raidi v fazi 1)
  scouts:        { arrivalPhase: 'find',      arrival: 100, attack: 0.4, defense: 0.5, hp: 1 },
  // faza 2: napadalne enote — močnejši napad
  attackers:     { arrivalPhase: 'understand', arrival: 75,  attack: 1.6, defense: 1.2, hp: 2 },
  // faza 3: people-killer — zelo močna enota
  peopleKillers: { arrivalPhase: 'eliminate',  arrival: 25,  attack: 3.5, defense: 2.6, hp: 4 },
};
// Združljivost s prejšnjimi imeni (en vir: AI_UNIT_DEFS):
export const AI_SCOUTS_INITIAL      = AI_UNIT_DEFS.scouts.arrival;        // 100 (faza 1)
export const AI_ATTACKERS_PHASE2     = AI_UNIT_DEFS.attackers.arrival;     // 75  (faza 2)
export const AI_PEOPLEKILLERS_PHASE3 = AI_UNIT_DEFS.peopleKillers.arrival; // 25  (faza 3)

// Skaliranje srečanj: gosteje ko je izvidnikov, večja možnost srečanja; manj robotov → manj srečanj
export const ENCOUNTER_SCOUT_REFERENCE = AI_UNIT_DEFS.scouts.arrival; // referenca = polno število izvidnikov
export const ENCOUNTER_MIN_FACTOR      = 0.25; // tudi z malo izvidniki ostane nekaj možnosti
// People-killer enote dodatno večajo smrtnost AI napadov (poleg svojega napada)
export const PEOPLEKILLER_LETHALITY_PER_UNIT = 0.012; // +1.2 % žrtev na enoto (do ~+30 % pri 25)
/** Skupna ofenzivna moč danih enot (uporablja se za raide). */
export function aiAttackPower(u: AIUnits): number {
  return (u?.scouts ?? 0) * AI_UNIT_DEFS.scouts.attack
    + (u?.attackers ?? 0) * AI_UNIT_DEFS.attackers.attack
    + (u?.peopleKillers ?? 0) * AI_UNIT_DEFS.peopleKillers.attack;
}
/** Skupna obrambna moč danih enot (ko jih igralec napade). */
export function aiDefensePower(u: AIUnits): number {
  return (u?.scouts ?? 0) * AI_UNIT_DEFS.scouts.defense
    + (u?.attackers ?? 0) * AI_UNIT_DEFS.attackers.defense
    + (u?.peopleKillers ?? 0) * AI_UNIT_DEFS.peopleKillers.defense;
}
/** Povprečni hp prisotnih enot (za pretvorbo škode → uničene enote). */
export function aiAverageHP(u: AIUnits): number {
  const n = (u?.scouts ?? 0) + (u?.attackers ?? 0) + (u?.peopleKillers ?? 0);
  if (n <= 0) return 1;
  const hpSum = (u.scouts) * AI_UNIT_DEFS.scouts.hp
    + (u.attackers) * AI_UNIT_DEFS.attackers.hp
    + (u.peopleKillers) * AI_UNIT_DEFS.peopleKillers.hp;
  return hpSum / n;
}
// Polna ofenzivna moč celotne AI vojske (referenca za skaliranje verjetnosti raida)
export const AI_FULL_ATTACK_POWER =
  AI_UNIT_DEFS.scouts.arrival * AI_UNIT_DEFS.scouts.attack
  + AI_UNIT_DEFS.attackers.arrival * AI_UNIT_DEFS.attackers.attack
  + AI_UNIT_DEFS.peopleKillers.arrival * AI_UNIT_DEFS.peopleKillers.attack;
// Spodnja meja faktorja sile pri raidih — tudi v fazi 1 (sami izvidniki, ~16 % polne
// moči) se morajo raidi DOGAJATI, le redkejši/šibkejši so. Brez te meje raidi
// praktično izginejo do faze 3.
export const RAID_FORCE_FLOOR = 0.55;

// ─── Garnizija šibkih točk ──────────────────────────────────────────────────────
// AI del svojih enot razporedi na obrambo šibkih točk. Ko prispejo nove enote
// (faza 2: napadalci, faza 3: people-killerji), se garnizija okrepi; ko igralec
// uničuje robote, oslabi.
export function wpGarrisonUnits(u?: { scouts: number; attackers: number; peopleKillers: number }): number {
  if (!u) return 0;
  return Math.round(u.scouts * 0.05 + u.attackers * 0.15 + u.peopleKillers * 0.30);
}
/** Multiplikator težavnosti napada na šibko točko (1 = brez garnizije). */
export function wpGarrisonMult(u?: { scouts: number; attackers: number; peopleKillers: number }): number {
  return 1 + wpGarrisonUnits(u) / 20;
}
// Stražena polja: heks s šibko točko ali AI jedrom ima več srečanj (straža).
export const GUARD_TILE_ENCOUNTER_MULT = 2.2;
export const NEAR_CORE_ENCOUNTER_MULT  = 1.5;

export const INITIAL_AI_KNOWLEDGE = 0.1; // AI malo ve o nas na začetku

// ─── AI EKONOMIJA — energija iz jedra poganja nadomeščanje enot ───────────────
// AI jedro (= šibka točka 'wp_power', energijsko jedro) daje stalen pritok energije.
// Z energijo AI NADOMEŠČA izgubljene enote (do ciljne velikosti vojske za to fazo) —
// česar prej ni počel, zato je izčrpavanje zdaj pravi izziv. Če igralec uniči jedro,
// pritok strmo pade → izčrpavalna (obrambna) zmaga postane dosegljiva.
export const AI_ENERGY_CORE_WEAKPOINT = 'wp_power';     // katera šibka točka je jedro
export const AI_ENERGY_START = 0;
export const AI_ENERGY_CORE_DESTROYED_MULT = 0.25;      // uničeno jedro → pritok na 25 %
export const AI_ENERGY_PER_LEVEL = 0.5;                 // +50 % pritoka na stopnjo AI nadgradnje
// Cena enote v energiji (≈ sorazmerno z močjo: izvidnik poceni, people-killer drag)
export const AI_UNIT_ENERGY_COST: Record<'scouts' | 'attackers' | 'peopleKillers', number> = {
  scouts: 1, attackers: 4, peopleKillers: 10,
};
// AI sam vlaga PRESEŽEK energije v dvig pritoka (mirror igralčevih raziskav).
export const AI_ENERGY_LEVEL_COST = 60;  // energije za +1 nivo pritoka
export const AI_ENERGY_LEVEL_MAX  = 3;   // največ +150 % pritoka

// LABORATORIJ — AI bojne nadgradnje (zrcalo igralčevih raziskav). Zmernejši učinek
// kot igralčev ×2, da AI ne pobegne: ×AI_LAB_MULT_PER_LEVEL na stopnjo.
export const AI_LAB_LEVEL_COST = 80;   // energije za +1 stopnjo (napad ali obramba)
export const AI_LAB_LEVEL_MAX  = 3;
export const AI_LAB_MULT_PER_LEVEL = 1.3;  // ×1.3 na stopnjo (max ~×2.2)
export function aiLabMult(level: number): number {
  return Math.pow(AI_LAB_MULT_PER_LEVEL, Math.max(0, level | 0));
}

// POVELJSTVO — vloge robotov (zrcalo razporeditve ljudi):
// ISKANJE: roboti, dodeljeni iskanju, dvigajo znanje o kampu (najde te → raidi).
export const SEARCH_KNOWLEDGE_PER_ROBOT = 0.0006;  // dvig aiKnowledge na robota/mesec
// PATRULJA: roboti na patrulji večajo verjetnost srečanja TVOJIH odprav na poti.
export const PATROL_ENCOUNTER_PER_ROBOT = 0.004;   // +faktor srečanja na robota
export const PATROL_ENCOUNTER_MAX_MULT  = 2.5;     // zgornja meja množitelja
// Ko AI ve toliko o nas, vidi tudi SKRITE (nerazporejene) ljudi in jih raid lahko doseže.
export const AI_KNOWLEDGE_EXPOSE_HIDDEN = 0.95;  // prej 0.99 — skrivanje je bilo skoraj zastonj
// Če je ob KONCU FAZE cel klan ≤ toliko, je igre konec (kapica na neskončno vračanje preživelih).
export const MIN_CLAN_AT_PHASE_END = 1;

// ─── Populacijska dinamika ─────────────────────────────────────────────────────
export const SURVIVAL_PER_PERSON_PER_ROUND = 1;    // vsak človek poje 1 unit/rundo
export const FORAGER_YIELD = 4;                     // en forager zbere 4 survival/rundo
export const SCOUT_INTEL_YIELD = 8;                 // en scout = 8 intel/rundo
export const SCOUT_FOG_YIELD = 4;                   // en scout = 4 enote za čiščenje megle/rundo
export const SURVIVOR_RESCUE_CHANCE = 0.15;         // verjetnost najdbe novih preživelih

// (M_os modifikator osi odstranjen — os Obzidje/Orožje/Roboti zaenkrat brez mehanskih učinkov)

// ─── Balans spopada ─────────────────────────────────────────────────────────
// Cilj: ~55 % AI zmag (napeto, ne nemogoče)
export const COMBAT_BASE_HUMAN_MULTIPLIER = 1.2; // combatant strength per person
export const COMBAT_EQUIPMENT_MULTIPLIER = 0.8;  // combat resources multiplier
export const AI_ROBOT_STRENGTH = 1.5;            // strength per robot
export const AI_FOREKNOWLEDGE_BONUS = 1.3;       // AI gets this if aiKnowledge > 0.5

// (Stari determinististični pragovi VICTORY/PARTIAL/DEFEAT_THRESHOLD odstranjeni —
//  izid zdaj določa rollOutcome + DECISIVE_MARGIN, glej combat.ts.)

// ─── Krivulja aktivnosti klanov ───────────────────────────────────────────────
// Tarčne vrednosti ob koncu vsake faze (brez zavezniških bonusov):
//   find: 0.60 → 0.55 (−0.05 / 12 rund)
//   understand: 0.55 → 0.38 (−0.17 / 12 rund)
//   eliminate: 0.38 → 0.20 (−0.18 / 12 rund)
export const CLAN_ACTIVITY_BY_PHASE: Record<AIPhase, number> = {
  find:       0.55,
  understand: 0.38,
  eliminate:  0.20,
};

// Hitrost padca klanske aktivnosti po fazi (brez zaveznikov)
export const CLAN_ACTIVITY_DECAY_PER_PHASE: Record<AIPhase, number> = {
  find:       0.0042,  // faza 1: počasen padec (0.60 → ~0.55)
  understand: 0.0142,  // faza 2: hitrejši padec (0.55 → ~0.38)
  eliminate:  0.0150,  // faza 3: najhitrejši padec (0.38 → ~0.20)
};

// (Neuporabljeno — rezervirano za prihodnje: skrivanje kampa zniža P(raid))
export const CLAN_ACTIVITY_EXPOSURE_MODIFIER = 0.004; // legacy — nadomeščeno s CLAN_ACTIVITY_DECAY_PER_PHASE
export const CLAN_ACTIVITY_HIDDEN_MODIFIER = 0.008;   // rezervirano

// ─── Obroki / rations (1–5) ──────────────────────────────────────────────────
// Učinkuje na: porabo hrane (foodMult), spremembo populacije (pop±) in moč ljudi (strengthMult).
// Moč multiplicira donos foragerjev, izvidnikov in bojno moč combatantov.
export interface RationsTier {
  foodMult: number;     // multiplikator na porabo hrane na osebo
  popMin: number;       // minimalna sprememba populacije (lahko negativna)
  popMax: number;       // maksimalna sprememba populacije
  strengthMult: number; // koliko efektivneje delajo (donos × ta vrednost)
  label: string;
  emoji: string;
}
export const RATIONS_LEVELS: Record<number, RationsTier> = {
  1: { foodMult: 0.50, popMin: -5, popMax: -3, strengthMult: 0.55, label: 'Lakota',   emoji: '💀' },
  2: { foodMult: 0.75, popMin: -2, popMax: -1, strengthMult: 0.80, label: 'Skopo',    emoji: '🥄' },
  3: { foodMult: 1.00, popMin:  0, popMax:  0, strengthMult: 1.00, label: 'Normalno', emoji: '🍽' },
  4: { foodMult: 2.50, popMin:  1, popMax:  3, strengthMult: 1.30, label: 'Dobro',    emoji: '🍞' },
  5: { foodMult: 5.00, popMin:  3, popMax:  6, strengthMult: 1.60, label: 'Obilje',   emoji: '🥩' },
};

// Stopnjevana lakota: če hrana pade pod 0 dva meseca zapored, izgube se podvojijo
export const STARVATION_LOSS_PCT_1ST = 0.25;  // 25 % populacije prvi mesec
export const STARVATION_LOSS_PCT_2ND = 0.50;  // 50 % drugi mesec
export const STARVATION_LOSS_PCT_NTH = 0.75;  // 75 % vsak nadaljnji
export const DEFAULT_RATIONS = 3;

// ─── Fog of war — stroški odkrivanja ─────────────────────────────────────────
export const INTEL_TO_PARTIAL = 30;   // intel potreben za partial visibility
export const INTEL_TO_REVEALED = 80;  // intel potreben za revealed visibility

// ─── Fazni razplet (damage ob AI akciji) ─────────────────────────────────────
export const PHASE_EVENT_BASE_DAMAGE: Record<AIPhase, { survival: number; combat: number; population: number }> = {
  find:      { survival: -20, combat: 0,   population: -5  },  // manjše poizvedbe
  understand: { survival: -30, combat: -15, population: -10 }, // ciljani napadi
  eliminate:  { survival: -50, combat: -30, population: -20 }, // uničujoč udarec
};

// Redukcija posledic, če je player dobro pripravljen (prava os, odkrita šibka točka)
export const PREPARED_DAMAGE_REDUCTION = 0.4; // 40 % manj škode

// ─── AI šibke točke ───────────────────────────────────────────────────────────
export const AI_WEAK_POINT_EXPLOIT_BONUS = 0.25; // +25 % k P(uspeh) pri izkoriščanju šibke točke

// ─── Misije proti šibkim točkam (specializirane odprave) ────────────────────
// Vsaka misija traja nekaj mesecev; vsak mesec obstaja možnost srečanja z AI
export const MISSION_DURATION_MONTHS: Record<string, number> = {
  wp_power: 4,
  wp_comm:  5,
  wp_core:  6,
};
// Bazna verjetnost srečanja na mesec; več ljudi v misiji = bolj vidni
export const MISSION_ENCOUNTER_BASE         = 0.08;  // 8 %
export const MISSION_ENCOUNTER_PER_PERSON   = 0.012; // +1.2 % na vsako osebo nad 5
export const MISSION_ENCOUNTER_AI_KNOW      = 0.10;  // +do 10 % če AI ve veliko
// Faktor moči odprave: kvadratni koren ljudi × moč/oprema
export const MISSION_MIN_TEAM = 3;
// Pri končnem rolu uspeha: P = teamPower / (teamPower + wpDifficulty)
export const MISSION_WP_DIFFICULTY: Record<string, number> = {
  wp_power: 70,
  wp_comm:  90,
  wp_core:  120,
};

// ─── Intel kot koeficient k vsem bojem ─────────────────────────────────────
// Bonus na vse P(zmaga): +5 % na vsakih 100 intela (do max 25 %)
export const INTEL_COMBAT_BONUS_PER_100  = 0.05;
export const INTEL_COMBAT_BONUS_MAX      = 0.25;

// ─── Orožje ────────────────────────────────────────────────────────────────
// Smrt v napadu/obrambi → izguba orožja (1 orožje na 1 padlega)
// Neuporabljeno orožje ob napadu na kamp → uničenje 20–80 %
export const WEAPON_DESTROY_MIN_PCT = 0.20;
export const WEAPON_DESTROY_MAX_PCT = 0.80;

// ─── Delavnice — delavec-meseci na izdelek ────────────────────────────────
// 1 delavec za 1 izdelek: orožje 6 mes, obzidje 12 mes, artefakt 360 mes (30 let).
// Več delavcev pospeši (vsak prispeva svoj mesec).
export const WEAPON_WORKER_MONTHS   = 6;
export const WALL_WORKER_MONTHS     = 12;
export const ARTIFACT_WORKER_MONTHS = 120;  // prej 360 — skrajšano (10 let z 1 delavcem)
// Material za 1 izdelek
export const WEAPON_MATERIAL_COST   = 1;
export const WALL_MATERIAL_COST     = 4;
export const ARTIFACT_MATERIAL_COST = 20;

// ─── Izvidovanje: raziskava polja na obisk ─────────────────────────────────────
// Raziskava polja je LINEARNA glede na število izvidnikov (brez fiksnega bonusa na
// skupino), tako da je ena skupina N ljudi enakovredna več manjšim skupinam skupaj.
// Zgornjo mejo postavi raziskanost polja (klamp na 1.0 ob obisku).
export const SCOUT_RESEARCH_PER_PERSON = 0.125;  // delež raziskave na osebo na obisk

// ─── Raziskovalne nadgradnje (orožje/obzidje) ──────────────────────────────────
// Vsak level podvoji učinek (napad orožja oz. obramba obzidja).
export const RESEARCH_LEVEL_WORKER_MONTHS = 60;  // raziskovalec-mesecev za naslednji level (npr. 10 razisk. × 6 mes.) — prepolovljeno s 120
export const RESEARCH_EFFECT_MULT = 2;           // ×2 na level
/** Multiplikator učinka pri danem nivoju raziskave (level 0 = ×1, 1 = ×2, 2 = ×4 …). */
export function researchMult(level: number): number {
  return Math.pow(RESEARCH_EFFECT_MULT, Math.max(0, level | 0));
}
// ─── Naše znanje o AI (odpira AI drevo) ────────────────────────────────────────
export const INITIAL_AI_INSIGHT = 0.01;  // na začetku vemo 1 %
// Insight ni več pasiven timer: raziskovalci ga ustvarjajo. Robot research je primarna pot,
// ostale raziskave dajo le manjši stranski napredek, ker ekipa še vedno dela z AI podatki.
export const AI_INSIGHT_PER_RESEARCHER = 0.003;
export const NON_ROBOT_RESEARCH_INSIGHT_FACTOR = 0.15;
export const INSIGHT_PHASE_CAP: Record<AIPhase, number> = {
  find:       0.30, // faza 1 odpre do 30 %
  understand: 0.60, // faza 2 do 60 %
  eliminate:  0.90, // faza 3 do 90 %
};

// Razkrita logična šibkost da takojšen pasiven bonus. Uporabljamo enoten vir,
// da UI lahko jasno pokaže aktivne bonuse in engine uporabi iste vrednosti.
export const LOGICAL_WEAKNESS_COMBAT_BONUS = 0.20;    // splošni napad proti temu tipu robota
export const LOGICAL_WEAKNESS_RAID_DEFENSE_BONUS = 0.15; // obramba pred raid močjo tega tipa
export const LOGICAL_WEAKNESS_ENCOUNTER_REDUCTION = 0.20; // manj srečanj z izvidniki
export const LOGICAL_WEAKNESS_LETHALITY_REDUCTION = 0.15; // manj žrtev pri people-killerjih

// ─── AI napad na kamp (raid) ─────────────────────────────────────────────────
// P(raid) = base + popScaling * popFactor + aiKnowBonus * aiKnow
// modificirano z osjo (hiding -50 %) in klansko aktivnostjo (drugi klani odvračajo)
// ─── Tempo raidov po obdobjih ───────────────────────────────────────────────────
// AI napade kamp načrtovano: ob vstopu v obdobje se izžreba število napadov in se
// razporedijo po mesecih. Po 36. mesecu (konec 3. faze) AI VE, kje je kamp —
// totalni napadi 8–10 na leto. Igra se nadaljuje: utrjen kamp lahko zmelje
// vse robote in zmaga z obrambo.
export const RAID_COUNT_BY_PHASE: Record<'find' | 'understand' | 'eliminate', [number, number]> = {
  find: [1, 3], understand: [2, 4], eliminate: [4, 6],
};
export const ASSAULT_RAIDS_PER_YEAR: [number, number] = [8, 10];

export const RAID_BASE_CHANCE          = 0.05;  // 5 % minimum
export const RAID_POP_SCALING_MAX      = 0.20;  // +do 20 % glede na velikost
export const RAID_POP_REFERENCE        = 100;   // pop za max scaling
export const RAID_AI_KNOWLEDGE_BONUS   = 0.15;  // +do 15 % če AI ve veliko
export const RAID_HIDING_REDUCTION     = 0.50;  // hiding os razpolovi verjetnost
export const RAID_AI_FORCE_PCT         = 0.20;  // 20 % efektivne AI sile sodeluje pri raidu (prej 0.50 × klanski davek ~0.40)
export const DEFENDER_EQUIPMENT_MULT   = 0.40;  // obrambno orožje učinkuje manj kot ofenzivno

// ─── Preboj obrambe: koliko območij kampa AI opustoši po izidu raida ───────────
// (več kot prebije obrambo → več območij; "vsa" pri popolnem porazu)
export const RAID_BREACH_AREAS: Record<'victory' | 'partial' | 'defeat' | 'annihilation', number> = {
  victory: 0,        // obramba zdržala
  partial: 1,        // malo prebije → eno območje
  defeat: 2,         // več prebije → dve območji
  annihilation: 4,   // zelo prebije → vsa območja
};
// Žrtve so ZVEZNE: skalirajo z MOČJO PREBOJA (1 − verjetnost odbitja = AI premoč).
// Močnejša obramba → manjši preboj → manj žrtev; šibka obramba → AI "tolče naprej".
// Množitelji premoči po izidu (delež = mult × premoč, omejeno na ljudi v coni):
export const RAID_FRONT_LOSS_MULT: Record<'victory' | 'partial' | 'defeat', number> = {
  victory: 0.10, partial: 0.55, defeat: 1.20,   // annihilation = vsi branilci (dominacija)
};
export const RAID_AREA_LOSS_MULT: Record<'partial' | 'defeat', number> = {
  partial: 0.40, defeat: 0.85,                  // annihilation = fiksno spodaj
};
export const RAID_AREA_LOSS_ANNIHILATION = 0.70; // AI dominacija: 70 % ljudi v vsaki coni
// Delež uničenega vira na prebito območje
export const RAID_DESTROY_FOOD_PCT     = 0.25; // prehrana → hrana
export const RAID_DESTROY_WEAPONS_PCT  = 0.20; // delavnice → orožje
export const RAID_DESTROY_MATERIAL_PCT = 0.30; // raziskave → material
export const RAID_DESTROY_WALL_LEVELS  = 1;    // obramba → poruši toliko stopenj obzidja

// ─── Izvidniške misije — uspeh in ujetje ─────────────────────────────────────
export const SCOUT_BASE_SUCCESS        = 0.80;  // 80 % baza
export const SCOUT_INTEL_BONUS_PER_100 = 0.10;  // +10 % uspeha na 100 intela
export const SCOUT_ESPIONAGE_BONUS     = 0.10;  // +10 % če os = espionage
export const SCOUT_CAPTURE_BASE        = 0.07;  // 7 % bazna verjetnost srečanja (prej 5 % — srečanja so bila preredka)
export const SCOUT_CAPTURE_PER_SCOUT   = 0.004; // +0.4 % za vsakega scoutsa (več → bolj vidni)
export const SCOUT_HIDING_REDUCTION    = 0.50;  // hiding os razpolovi verjetnost ujetja
export const SCOUT_AI_KNOWLEDGE_BONUS  = 0.20;  // +do 20 % ujetja če AI ve veliko
export const SCOUT_PARTIAL_EFFECTIVE   = 0.60;  // če misija delno spodleti, donos × 0.6
export const SCOUT_CAPTURED_LOSS_MIN   = 0.20;  // pri ujetju izgubimo 20–50 % izvidnikov
export const SCOUT_CAPTURED_LOSS_MAX   = 0.50;
