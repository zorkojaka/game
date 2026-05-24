// ─── Vse konstante so tukaj — spreminjaš med testiranjem ─────────────────────
// Razvrstitev: začetno stanje | balans spopada | krivulja klanov | resursi | AI

import type { AIPhase, HumanAxis } from './types.js';

// ─── Strukturne konstante (ne balasiraj) ──────────────────────────────────────
export const ROUNDS_PER_PHASE = 12;
export const NUM_PHASES = 3;
export const TOTAL_ROUNDS = ROUNDS_PER_PHASE * NUM_PHASES;

// ─── Začetno stanje ────────────────────────────────────────────────────────────
export const INITIAL_POPULATION = 80;
export const INITIAL_SURVIVAL = 120;   // meseci hrane/vode
export const INITIAL_COMBAT = 60;      // enote orožja
export const INITIAL_INTELLIGENCE = 10; // začetni intel
export const INITIAL_AI_ROBOTS = 200;
export const INITIAL_AI_KNOWLEDGE = 0.1; // AI malo ve o nas na začetku
export const INITIAL_CLAN_ACTIVITY = 0.60; // drugi klani aktivni — 60 % AI-ja je zaseden

// ─── Populacijska dinamika ─────────────────────────────────────────────────────
export const SURVIVAL_PER_PERSON_PER_ROUND = 1;    // vsak človek poje 1 unit/rundo
export const FORAGER_YIELD = 4;                     // en forager zbere 4 survival/rundo
export const SCOUT_INTEL_YIELD = 8;                 // en scout = 8 intel/rundo
export const SURVIVOR_RESCUE_CHANCE = 0.15;         // verjetnost najdbe novih preživelih

// ─── M_os — modifikator pravilnosti osi v dani fazi ──────────────────────────
// Vsaka os je učinkovita v "pravi" fazi, manj v napačni
// Vrednosti med 0.4 in 1.5
export const M_OS: Record<AIPhase, Record<HumanAxis, number>> = {
  find: {
    hiding: 1.4,   // PRAVA os — skrivanje med iskanjem je odlično
    espionage: 1.0,
    defense: 0.5,  // Napačna os — braniti se med iskanjem ni smiselno
  },
  understand: {
    hiding: 0.8,
    espionage: 1.5, // PRAVA os — špijonaža med analizo je odlična
    defense: 0.7,
  },
  eliminate: {
    hiding: 0.5,   // Prepozno za skrivanje
    espionage: 0.9,
    defense: 1.4,  // PRAVA os — obramba med iztrebljenjem je ključna
  },
};

// ─── Balans spopada ─────────────────────────────────────────────────────────
// Cilj: ~55 % AI zmag (napeto, ne nemogoče)
export const COMBAT_BASE_HUMAN_MULTIPLIER = 1.2; // combatant strength per person
export const COMBAT_EQUIPMENT_MULTIPLIER = 0.8;  // combat resources multiplier
export const AI_ROBOT_STRENGTH = 1.5;            // strength per robot
export const AI_FOREKNOWLEDGE_BONUS = 1.3;       // AI gets this if aiKnowledge > 0.5

// Prag za izide
export const VICTORY_THRESHOLD = 0.65;     // P > 65 % → victory (AI ujame nič)
export const PARTIAL_THRESHOLD = 0.45;     // P 45–65 % → partial
export const DEFEAT_THRESHOLD = 0.20;      // P 20–45 % → defeat (nekaj preživi)
// P < 20 % → annihilation

// ─── Krivulja aktivnosti klanov ───────────────────────────────────────────────
// Vrednosti ob koncu vsake faze (3 vrednosti)
export const CLAN_ACTIVITY_BY_PHASE: Record<AIPhase, number> = {
  find: 0.55,       // začne ~0.6, konča ~0.55 po fazi 1
  understand: 0.38, // padec med fazo 2
  eliminate: 0.20,  // skoraj sam na koncu
};

// Vedenjski modifikator: koliko izpostavljenost vpliva na krivuljo
export const CLAN_ACTIVITY_EXPOSURE_MODIFIER = 0.004; // per round, aktiven → počasnejši padec
export const CLAN_ACTIVITY_HIDDEN_MODIFIER = 0.008;   // per round, skrit → hitrejši padec

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
