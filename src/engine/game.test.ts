import { describe, it, expect } from '@jest/globals';
import { newGame, processRound, destroyAIUnits, totalAIRobots, raidProbability } from './game.js';
import { rollOutcome, DECISIVE_MARGIN } from './combat.js';
import { encounterScoutFactor } from './expedition.js';
import { createRNG } from './rng.js';
import type { PlayerAction, GameState } from './types.js';

function action(over: Partial<PlayerAction['assignment']> = {}): PlayerAction {
  return {
    assignment: {
      axis: 'obzidje',
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

describe('AI enote po fazah (scouts/attackers/peopleKillers)', () => {
  it('faza 1 (find): samo 100 izvidniških enot = aiRobots', () => {
    const g = newGame(1);
    expect(g.aiUnits).toEqual({ scouts: 100, attackers: 0, peopleKillers: 0 });
    expect(g.aiRobots).toBe(100);
  });

  it('prehod v understand pripelje 75 napadalnih enot', () => {
    const g: GameState = { ...newGame(2), aiPhaseProgress: 11, round: 12 };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.phase).toBe('understand');
    expect(r.aiUnits.attackers).toBe(75);
    expect(r.aiRobots).toBe(r.aiUnits.scouts + 75 + r.aiUnits.peopleKillers);
  });

  it('prehod v eliminate pripelje 25 people-killer enot', () => {
    const g: GameState = { ...newGame(2), phase: 'understand', aiPhaseProgress: 11, round: 12,
      aiUnits: { scouts: 100, attackers: 75, peopleKillers: 0 }, aiRobots: 175 };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.phase).toBe('eliminate');
    expect(r.aiUnits.peopleKillers).toBe(25);
  });

  it('faza 1 ima raide (tudi izvidniki napadajo) — verjetnost > 0', () => {
    const g = newGame(123);
    expect(raidProbability(g, 'roboti')).toBeGreaterThan(0);
  });

  it('uničenje vseh robotov = zmaga tudi v fazi 1 (varovalo odstranjeno)', () => {
    const base = newGame(5);
    const g: GameState = { ...base, aiUnits: { scouts: 0, attackers: 0, peopleKillers: 0 }, aiRobots: 0 };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.status).toBe('victory');
  });
});

describe('destroyAIUnits — porazdeljeno uničenje', () => {
  it('odšteje natanko count in nikoli pod 0', () => {
    const u = { scouts: 100, attackers: 75, peopleKillers: 25 };
    const r = destroyAIUnits(u, 40);
    expect(totalAIRobots(r)).toBe(160);
    expect(r.scouts).toBeGreaterThanOrEqual(0);
    expect(r.attackers).toBeGreaterThanOrEqual(0);
    expect(r.peopleKillers).toBeGreaterThanOrEqual(0);
  });
  it('uničenje več kot obstaja → vse na 0', () => {
    const r = destroyAIUnits({ scouts: 10, attackers: 0, peopleKillers: 0 }, 999);
    expect(totalAIRobots(r)).toBe(0);
  });
});

describe('encounterScoutFactor — manj izvidnikov → manj srečanj', () => {
  it('pri polnem številu ~1, pri 0 = minimum, monotono', () => {
    expect(encounterScoutFactor(100)).toBeCloseTo(1, 5);
    expect(encounterScoutFactor(0)).toBeLessThan(encounterScoutFactor(50));
    expect(encounterScoutFactor(50)).toBeLessThan(encounterScoutFactor(100));
  });
});

describe('raziskave: roboti odklepajo orožje/obzidje', () => {
  const research = (g: GameState, obj: 'robots' | 'weapon' | 'wall', n: number) =>
    processRound(g, { assignment: { axis: 'roboti', combatants: 0, defenders: 0, foragers: 0, workers: 0, researchers: n, rations: 3, researchObjective: obj } });

  it('Roboti 120 razisk. → stopnja 1', () => {
    expect(research(newGame(8), 'robots', 120).robotsResearchLevel).toBe(1);
  });

  it('orožje je zaklenjeno dokler ni raziskan robot (level ostane 0)', () => {
    const r = research(newGame(8), 'weapon', 120);
    expect(r.weaponResearchLevel).toBe(0);
  });

  it('po Roboti I se orožje lahko dvigne na 1', () => {
    let s = research(newGame(8), 'robots', 120);   // roboti -> 1
    expect(s.robotsResearchLevel).toBe(1);
    s = research(s, 'weapon', 120);                // zdaj orožje -> 1
    expect(s.weaponResearchLevel).toBe(1);
  });
});

describe('aiInsight — odpira AI drevo, fazni stropi', () => {
  it('start 1 %', () => {
    expect(newGame(1).aiInsight).toBeCloseTo(0.01, 5);
  });
  it('raste po rundi in je omejen na fazni strop (find ≤ 0.30)', () => {
    let s = newGame(1);
    for (let i = 0; i < 20 && s.status === 'active' && s.phase === 'find'; i++) {
      s = processRound(s, action({ foragers: 40 }));
      expect(s.aiInsight).toBeLessThanOrEqual(0.30 + 1e-9);
    }
  });
  it('z dovolj insighta se razkrije vsaj eno vozlišče drevesa', () => {
    const base = newGame(1);
    const g: GameState = { ...base, aiInsight: 0.55, phase: 'understand' };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.aiTree.some(n => n.visibility === 'revealed')).toBe(true);
  });
});

describe('raid — preboj obrambe opustoši območja', () => {
  it('število prebitih območij ustreza izidu (victory 0 … annihilation 4)', () => {
    const expectedByOutcome: Record<string, number> = { victory: 0, partial: 1, defeat: 2, annihilation: 4 };
    let found = false;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      let s: GameState = { ...newGame(seed), phase: 'understand', aiPhaseProgress: 1,
        aiUnits: { scouts: 100, attackers: 75, peopleKillers: 0 }, aiRobots: 175, aiKnowledge: 0.7 };
      for (let i = 0; i < 12 && s.status === 'active'; i++) {
        s = processRound(s, action({ foragers: 30, defenders: 1, workers: 2, researchers: 2, rations: 3 }));
        const r = s.lastRoundLog?.raid;
        if (r?.occurred && r.outcome) {
          expect(r.breachedAreas.length).toBe(expectedByOutcome[r.outcome]);
          found = true; break;
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('axisHistory (#6 — vir za CompletedRun)', () => {
  it('izbrana os se inkrementira', () => {
    const g = newGame(3);
    const r = processRound(g, action({ axis: 'roboti', foragers: 5 }));
    expect(r.axisHistory.roboti).toBe((g.axisHistory.roboti ?? 0) + 1);
  });
});
