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
  counterBias: { obzidje: 0.33, orozje: 0.33, roboti: 0.34 },
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
    obzidje: 'orozje',
    orozje: 'roboti',
    roboti: 'obzidje',
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
// AI drevo = 3×3 matrika: 3 tipi robotov (po fazah) × 3 stopnje
// (1) kateri robot je prišel, (2) mehanska šibka točka, (3) logična šibka točka.
// Vse začne neznano; odpira se z našim znanjem o AI (aiInsight); fazni stropi 0.30/0.60/0.90.
export function generateAITree(): AITreeNode[] {
  return [
    // Faza 1 — Najti · IZVIDNIKI (scouts)
    { id: 'scout_unit',  phase: 'find',      robot: 'scouts',        role: 'unit',       label: 'Izvidniške enote',            visibility: 'unknown', strength: 30, executed: false, insightThreshold: 0.10 },
    { id: 'scout_mech',  phase: 'find',      robot: 'scouts',        role: 'mechanical', label: 'Mehanska šibka točka izvidnikov', visibility: 'unknown', strength: 30, executed: false, insightThreshold: 0.20 },
    { id: 'scout_logic', phase: 'find',      robot: 'scouts',        role: 'logical',    label: 'Logična šibka točka izvidnikov',  visibility: 'unknown', strength: 30, executed: false, insightThreshold: 0.30 },
    // Faza 2 — Razumeti · NAPADALCI (attackers)
    { id: 'atk_unit',    phase: 'understand', robot: 'attackers',    role: 'unit',       label: 'Napadalne enote',             visibility: 'unknown', strength: 60, executed: false, insightThreshold: 0.40 },
    { id: 'atk_mech',    phase: 'understand', robot: 'attackers',    role: 'mechanical', label: 'Mehanska šibka točka napadalcev', visibility: 'unknown', strength: 60, executed: false, insightThreshold: 0.50 },
    { id: 'atk_logic',   phase: 'understand', robot: 'attackers',    role: 'logical',    label: 'Logična šibka točka napadalcev',  visibility: 'unknown', strength: 60, executed: false, insightThreshold: 0.60 },
    // Faza 3 — Iztrebiti · PEOPLE-KILLERJI (peopleKillers)
    { id: 'pk_unit',     phase: 'eliminate',  robot: 'peopleKillers', role: 'unit',       label: 'People-killer enote',         visibility: 'unknown', strength: 90, executed: false, insightThreshold: 0.70 },
    { id: 'pk_mech',     phase: 'eliminate',  robot: 'peopleKillers', role: 'mechanical', label: 'Mehanska šibka točka people-killerjev', visibility: 'unknown', strength: 90, executed: false, insightThreshold: 0.80 },
    { id: 'pk_logic',    phase: 'eliminate',  robot: 'peopleKillers', role: 'logical',    label: 'Logična šibka točka people-killerjev',  visibility: 'unknown', strength: 90, executed: false, insightThreshold: 0.90 },
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
