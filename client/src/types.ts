// ENOTNI VIR TIPOV — re-export iz enginea (single source of truth).
// NE podvajaj tipov tukaj; uredi jih v src/engine/types.ts.
// (engine types.ts je samostojen, brez runtime importov, zato je re-export varen)
export * from '../../src/engine/types';

// UI-specifičen tip predogleda obetov (ni del enginea):
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
