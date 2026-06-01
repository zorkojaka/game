// AI Brain — parametriziran utežni vektor
// MVP: en signal (counter player's most common axis)
// Faza 2: kombinirani signali

import type { AIPhase, HumanAxis, AITreeNode, AIWeakPoint } from './types.js';
import type { RNGState } from './rng.js';
import { rngNext } from './rng.js';

// Genome = utežni vektor, ki določa obnašanje AI
export interface AIGenome {
  // Koliko robotov AI razporedi v napad (0–1)
  aggressiveness: number;
  // Katero os AI preferira za counter
  counterBias: Record<HumanAxis, number>;
  // Hitrost napredka med fazami (1.0 = normalno)
  phaseSpeed: number;
  // Koliko intenzivno AI zbira info o nas (0–1)
  surveillanceIntensity: number;
}

export const DEFAULT_GENOME: AIGenome = {
  aggressiveness: 0.5,
  counterBias: { hiding: 0.33, espionage: 0.33, defense: 0.34 },
  phaseSpeed: 1.0,
  surveillanceIntensity: 0.4,
};

// Axiom history — beležimo playerjev vzorec
export type AxisHistory = Partial<Record<HumanAxis, number>>;

// AI se nauči iz zgodovine — nagna genome proti countri najpogostejše osi
export function adaptGenome(genome: AIGenome, history: AxisHistory): AIGenome {
  const total = Object.values(history).reduce((a, b) => a + b, 0);
  if (total < 3) return genome; // premalo podatkov

  const dominant = (Object.entries(history) as [HumanAxis, number][])
    .sort(([, a], [, b]) => b - a)[0][0];

  const counter: Record<HumanAxis, HumanAxis> = {
    hiding: 'espionage',     // AI kontira skrivanje z boljšim iskanjem
    espionage: 'defense',    // AI kontira špijonažo z zaščito informacij
    defense: 'hiding',       // AI kontira obrambo z izogibanjem soočenju
  };

  const counterAxis = counter[dominant];
  const newBias = { ...genome.counterBias };
  // Povečaj bias za counter os
  newBias[counterAxis] = Math.min(0.7, newBias[counterAxis] + 0.1);
  // Normalizacija
  const sum = Object.values(newBias).reduce((a, b) => a + b, 0);
  (Object.keys(newBias) as HumanAxis[]).forEach(k => { newBias[k] /= sum; });

  return { ...genome, counterBias: newBias };
}

// AI zgenerira vozlišča za drevo (fiksna za MVP, Faza 2+ generirana)
export function generateAITree(): AITreeNode[] {
  return [
    // Faza 1 — Najti (vse začne neznano; drevo se odpira z našim znanjem o AI = aiInsight)
    { id: 'find_drones',    phase: 'find',      label: 'Izvidniški droni',     visibility: 'unknown', strength: 40, executed: false },
    { id: 'find_satellite', phase: 'find',      label: 'Satelitsko mapiranje', visibility: 'unknown', strength: 60, executed: false },
    { id: 'find_sensors',   phase: 'find',      label: 'Senzorska mreža',      visibility: 'unknown', strength: 30, executed: false },
    { id: 'find_agents',    phase: 'find',      label: 'Infiltracijski agenti', visibility: 'unknown', strength: 50, executed: false },
    // Faza 2 — Razumeti
    { id: 'und_patterns',   phase: 'understand', label: 'Analiza vzorcev',     visibility: 'unknown', strength: 55, executed: false },
    { id: 'und_predict',    phase: 'understand', label: 'Predikcijsko jedro',   visibility: 'unknown', strength: 70, executed: false },
    { id: 'und_psych',      phase: 'understand', label: 'Psihološki profil',   visibility: 'unknown', strength: 45, executed: false },
    // Faza 3 — Iztrebiti
    { id: 'eli_strike',     phase: 'eliminate',  label: 'Udarni protokol',     visibility: 'unknown', strength: 80, executed: false },
    { id: 'eli_supply',     phase: 'eliminate',  label: 'Rezanje preskrbe',    visibility: 'unknown', strength: 65, executed: false },
    { id: 'eli_final',      phase: 'eliminate',  label: 'Končna rešitev',       visibility: 'unknown', strength: 90, executed: false },
  ];
}

// Fiksne šibke točke AI (2–3 za MVP)
export function generateAIWeakPoints(): AIWeakPoint[] {
  return [
    {
      id: 'wp_power',
      label: 'Centralni energetski vozlišča',
      discovered: false,
      exploited: false,
      phase: 'find',
    },
    {
      id: 'wp_comm',
      label: 'Komunikacijski protokol AI',
      discovered: false,
      exploited: false,
      phase: 'understand',
    },
    {
      id: 'wp_core',
      label: 'Centralno procesorsko jedro',
      discovered: false,
      exploited: false,
      phase: 'eliminate',
    },
  ];
}

// Koliko se AI-jevo znanje o nas poveča to rundo
export function calcAISurveillanceGain(
  genome: AIGenome,
  clanActivity: number,
  playerExposure: number  // [0,1] — kako izpostavljeni smo bili
): number {
  const base = genome.surveillanceIntensity * playerExposure;
  const clansBlock = clanActivity * 0.5; // drugi klani motijo AI
  return Math.max(0, base - clansBlock) * 0.1; // max 0.1 na rundo
}
