import { describe, it, expect } from '@jest/globals';
import { newGame, processRound } from './game.js';
import { rollOutcome, DECISIVE_MARGIN } from './combat.js';
import { createRNG } from './rng.js';
import type { PlayerAction, GameState } from './types.js';

function action(over: Partial<PlayerAction['assignment']> = {}): PlayerAction {
  return {
    assignment: {
      axis: 'hiding',
      combatants: 0, defenders: 0, foragers: 0, workers: 0, researchers: 0,
      rations: 3,
      ...over,
    },
  };
}

describe('processRound — determinizem', () => {
  it('isti seed + ista akcija → identičen rezultat', () => {
    const g = newGame(42);
    const a = action({ foragers: 5 });
    const r1 = processRound(g, a);
    const r2 = processRound(g, a);
    expect(r2).toEqual(r1);
  });

  it('rngCallCount monotono narašča (poraba RNG)', () => {
    const g = newGame(7);
    const r = processRound(g, action({ foragers: 3 }));
    expect(r.rngCallCount).toBeGreaterThanOrEqual(g.rngCallCount);
  });
});

describe('rollOutcome — dejanski RNG roll (#8/#9)', () => {
  it('p=1 vedno uspeh (victory/partial), p=0 vedno neuspeh (defeat/annihilation)', () => {
    let rng = createRNG(1);
    for (let i = 0; i < 100; i++) {
      const win = rollOutcome(1, rng);
      expect(['victory', 'partial']).toContain(win.outcome);
      rng = win.rng;
      const lose = rollOutcome(0, rng);
      expect(['defeat', 'annihilation']).toContain(lose.outcome);
      rng = lose.rng;
    }
  });

  it('porabi natanko en RNG klic', () => {
    const rng = createRNG(123);
    const { rng: after } = rollOutcome(0.5, rng);
    expect(after.calls).toBe(rng.calls + 1);
  });

  it('p=0.5 daje mešanico izidov (ni determinističen)', () => {
    let rng = createRNG(99);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = rollOutcome(0.5, rng);
      seen.add(r.outcome);
      rng = r.rng;
    }
    // pri p=0.5 pričakujemo vsaj uspeh in neuspeh (ne le ene mejne vrednosti)
    const hasWin = seen.has('victory') || seen.has('partial');
    const hasLose = seen.has('defeat') || seen.has('annihilation');
    expect(hasWin && hasLose).toBe(true);
  });

  it('DECISIVE_MARGIN je razumna meja (0,1)', () => {
    expect(DECISIVE_MARGIN).toBeGreaterThan(0);
    expect(DECISIVE_MARGIN).toBeLessThan(1);
  });
});

describe('fazni prehod (#phase)', () => {
  it('ob dopolnitvi faze find → understand in reset napredka', () => {
    const g: GameState = { ...newGame(5), aiPhaseProgress: 11, round: 12 };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.phase).toBe('understand');
    expect(r.aiPhaseProgress).toBe(0);
  });
});

describe('lakota (#starvation)', () => {
  it('brez hrane populacija pade in šteje stradanje', () => {
    const base = newGame(11);
    const g: GameState = { ...base, resources: { ...base.resources, survival: 0 } };
    const before = g.population;
    const r = processRound(g, action({ foragers: 0, rations: 3 }));
    expect(r.consecutiveStarvationMonths).toBe(1);
    expect(r.population).toBeLessThan(before);
  });
});

describe('axisHistory (#6 — vir za CompletedRun)', () => {
  it('izbrana os se inkrementira', () => {
    const g = newGame(3);
    const r = processRound(g, action({ axis: 'defense', foragers: 5 }));
    expect(r.axisHistory.defense).toBe((g.axisHistory.defense ?? 0) + 1);
  });
});
