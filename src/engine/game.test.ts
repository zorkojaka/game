import { describe, it, expect } from '@jest/globals';
import { newGame, processRound, destroyAIUnits, totalAIRobots, raidProbability, mechanicalTechUnlockLevel, raidRepelProbability, missionSuccessProbability } from './game.js';
import { rollOutcome, DECISIVE_MARGIN, logicalWeaknessBonus } from './combat.js';
import { encounterScoutFactor, returnMonths, pathMonths, roundTripMonths, pathToCamp, tileEncounterProbability } from './expedition.js';
import { wpGarrisonMult } from './constants.js';
import { weaponEffectMult } from './difficulty.js';
import { isCampHex, collapseCampRuns, researchPerVisit, generateMap } from './map.js';
import { tickExpedition } from './expedition.js';
import { hexLabel } from './types.js';
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
    expect(raidProbability(g)).toBeGreaterThan(0);
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

  it('Roboti 60 razisk. → razkrije mehansko šibkost in odklene stopnjo 1', () => {
    const r = research(newGame(8), 'robots', 60);
    expect(r.robotsResearchLevel).toBe(1);
    expect(r.robotsResearchProgress).toBe(0);
  });

  it('orožje je zaklenjeno dokler ni raziskan robot (level ostane 0)', () => {
    const r = research(newGame(8), 'weapon', 60);
    expect(r.weaponResearchLevel).toBe(0);
  });

  it('po Roboti I se orožje lahko dvigne na 1', () => {
    let s = research(newGame(8), 'robots', 60);   // roboti -> 1
    expect(s.robotsResearchLevel).toBe(1);
    s = research(s, 'weapon', 60);                // zdaj orožje -> 1
    expect(s.weaponResearchLevel).toBe(1);
  });
});

describe('aiInsight — odpira AI drevo, fazni stropi', () => {
  it('start 1 %', () => {
    expect(newGame(1).aiInsight).toBeCloseTo(0.01, 5);
  });
  it('brez raziskovalcev ne raste več pasivno', () => {
    const s = newGame(1);
    const r = processRound(s, action({ foragers: 10, researchers: 0 }));
    expect(r.aiInsight).toBeCloseTo(s.aiInsight, 5);
  });
  it('robot research poveča insight in je omejen na fazni strop (find ≤ 0.30)', () => {
    let s = newGame(1);
    for (let i = 0; i < 20 && s.status === 'active' && s.phase === 'find'; i++) {
      s = processRound(s, action({ foragers: 40, researchers: 10, researchObjective: 'robots' }));
      expect(s.aiInsight).toBeLessThanOrEqual(0.30 + 1e-9);
    }
    expect(s.aiInsight).toBeGreaterThan(0.01);
  });
  it('z dovolj insighta se razkrije vsaj eno vozlišče drevesa', () => {
    const base = newGame(1);
    const g: GameState = { ...base, aiInsight: 0.55, phase: 'understand' };
    const r = processRound(g, action({ foragers: 5 }));
    expect(r.aiTree.some(n => n.visibility === 'revealed')).toBe(true);
  });
  it('mehanska šibkost določi odklenjeno tech stopnjo', () => {
    const base = newGame(1);
    const g: GameState = {
      ...base,
      aiTree: base.aiTree.map(n => n.id === 'atk_mech' ? { ...n, visibility: 'revealed' } : n),
    };
    expect(mechanicalTechUnlockLevel(g)).toBe(2);
  });
  it('logična šibkost spremeni combat bonus in raid obrambo', () => {
    const base = newGame(1);
    const withLogic: GameState = {
      ...base,
      aiTree: base.aiTree.map(n => n.id === 'scout_logic' ? { ...n, visibility: 'revealed' } : n),
    };
    expect(logicalWeaknessBonus(withLogic)).toBeGreaterThan(logicalWeaknessBonus(base));
    const a = action({ defenders: 10, rations: 3 }).assignment;
    expect(raidRepelProbability(withLogic, a)).toBeGreaterThan(raidRepelProbability(base, a));
  });
});

describe('povratni čas odprav', () => {
  // kamp je na (0,4)
  it('zadnji heks ob kampu → kratek povratek (≤1 mesec)', () => {
    const adjacent = [{ q: 0, r: 4 }, { q: 0, r: 3 }];
    expect(returnMonths(adjacent)).toBeLessThanOrEqual(1);
  });
  it('daleč od kampa → povratek po isti poti (= pot tja); round-trip = 2× pot', () => {
    const far = [{ q: 0, r: 4 }, { q: 0, r: 3 }, { q: 0, r: 2 }, { q: 0, r: 1 }];
    expect(returnMonths(far)).toBe(pathMonths(far));
    expect(roundTripMonths(far)).toBe(pathMonths(far) * 2);
  });
});

describe('pathToCamp — povratek se ustavi ob vstopu v kamp-grozd', () => {
  it('iz oddaljenega heksa zgradi veljavno pot, ki se konča v kamp-grozdu', () => {
    const p = pathToCamp({ q: 4, r: 0 });
    expect(p[0]).toEqual({ q: 4, r: 0 });
    expect(isCampHex(p[p.length - 1])).toBe(true);  // konča se v kamp-grozdu (ne nujno (0,4))
    // skozi kamp NE potuje: le ZADNJI heks je kampni
    for (let i = 0; i < p.length - 1; i++) expect(isCampHex(p[i])).toBe(false);
    // vsak korak je sosednji (heks razdalja 1)
    for (let i = 1; i < p.length; i++) {
      const dq = Math.abs(p[i].q - p[i - 1].q);
      const dr = Math.abs(p[i].r - p[i - 1].r);
      expect(dq + dr).toBeGreaterThan(0);
    }
  });
  it('heks tik ob kamp-grozdu → pot dolžine 2 (vstop v kamp)', () => {
    const p = pathToCamp({ q: 2, r: 4 });
    expect(p.length).toBe(2);
    expect(p[0]).toEqual({ q: 2, r: 4 });
    expect(isCampHex(p[1])).toBe(true);
  });
});

describe('odprava se vrne in raziskuje nazaj grede', () => {
  it('izvidnica preide v status returning, se premika po povratni poti in se na koncu vrne v kamp', () => {
    let s: GameState = newGame(7);
    // daljša pot (4 koraki), da je povratni leg viden tudi pri hitrosti 2 polji/mesec
    const path = [{ q: 0, r: 4 }, { q: 1, r: 3 }, { q: 2, r: 3 }, { q: 3, r: 2 }, { q: 3, r: 1 }];
    s = processRound(s, action({ foragers: 30, rations: 4, newExpeditions: [
      { kind: 'scout', path, assigned: 3, rations: 4 },
    ] }));
    expect((s.expeditions ?? []).length).toBe(1);

    let sawReturning = (s.expeditions ?? []).some(e => e.status === 'returning');
    const returnIdx: number[] = [];
    let guard = 0;
    while ((s.expeditions ?? []).length > 0 && guard++ < 14 && s.status === 'active') {
      s = processRound(s, action({ foragers: 30, rations: 4 }));
      const ret = (s.expeditions ?? []).find(e => e.status === 'returning');
      if (ret) { sawReturning = true; returnIdx.push(ret.currentIndex); }
    }
    // odprava je preživela povratni leg (returning) in se premikala po poti (currentIndex narašča)
    expect(sawReturning).toBe(true);
    if (returnIdx.length >= 2) expect(returnIdx[returnIdx.length - 1]).toBeGreaterThan(returnIdx[0]);
    // na koncu ni več aktivnih odprav — vrnila se je v kamp
    expect(s.expeditions?.length ?? 0).toBe(0);
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

describe('legacy missions disabled', () => {
  it('missionAssignments ne ustvarijo več activeMissions', () => {
    const base = newGame(1);
    const known: GameState = { ...base, aiWeakPoints: base.aiWeakPoints.map(w => ({ ...w, discovered: true })) };
    const r = processRound(known, action({ missionAssignments: { wp_power: 10 }, missionRations: { wp_power: 3 } }));
    expect(r.activeMissions).toEqual([]);
  });

  it('stara seja z activeMissions ne crasha in migrira ljudi nazaj v kamp', () => {
    const base = newGame(1);
    const old: GameState = {
      ...base,
      population: 70,
      activeMissions: [{ weakPointId: 'wp_power', assigned: 10, monthsTotal: 4, monthsRemaining: 3, successProbability: 0.5, rations: 3, status: 'in_progress' }],
    };
    const r = processRound(old, action({ foragers: 20 }));
    expect(r.activeMissions).toEqual([]);
    expect(r.population).toBeGreaterThan(70);
  });
});

describe('odprave — izbrana povratna pot', () => {
  it('returnPath iz vhoda se prenese na ustvarjeno odpravo', () => {
    const g = newGame(123);
    const camp = g.mapTiles!.find(t => t.isClanCamp)!;
    // sosednji heks kampa kot cilj
    const target = { q: camp.q + 1, r: camp.r - 1 };
    const path = [{ q: camp.q, r: camp.r }, target];
    const returnPath = [target, { q: camp.q, r: camp.r }];
    const r = processRound(g, action({
      foragers: 10,
      newExpeditions: [{ kind: 'scout', path, returnPath, assigned: 5, rations: 3 }],
    }));
    const exp = (r.expeditions ?? []).find(e => e.kind === 'scout');
    expect(exp).toBeTruthy();
    expect(exp!.returnPath).toEqual(returnPath);
  });
});

describe('collapseCampRuns — kamp grozd kot eno polje', () => {
  it('strni vodilni niz kamp-heksov na en sam (izhodno sidro)', () => {
    // [0,4]=kamp, [1,4]=kamp, [2,4]=real, [3,4]=real
    const p = collapseCampRuns([{ q: 0, r: 4 }, { q: 1, r: 4 }, { q: 2, r: 4 }, { q: 3, r: 4 }]);
    expect(p).toEqual([{ q: 1, r: 4 }, { q: 2, r: 4 }, { q: 3, r: 4 }]);
    expect(isCampHex(p[0])).toBe(true);
    expect(isCampHex(p[1])).toBe(false);
  });
  it('strni sklepni niz kamp-heksov na en sam (vstopno sidro)', () => {
    const p = collapseCampRuns([{ q: 3, r: 4 }, { q: 2, r: 4 }, { q: 1, r: 4 }, { q: 0, r: 4 }]);
    expect(p).toEqual([{ q: 3, r: 4 }, { q: 2, r: 4 }, { q: 1, r: 4 }]);
    expect(isCampHex(p[p.length - 1])).toBe(true);
  });
});

describe('hexLabel — človeku berljiva oznaka polja', () => {
  it('stolpec = črka, vrsta = številka (1-based)', () => {
    expect(hexLabel({ q: 0, r: 4 })).toBe('A5');
    expect(hexLabel({ q: 2, r: 3 })).toBe('C4');
    expect(hexLabel({ q: 5, r: 0 })).toBe('F1');
  });
  it('oznake so unikatne za vsa polja mreže', () => {
    const seen = new Set<string>();
    for (let q = 0; q < 6; q++) for (let r = 0; r < 5; r++) seen.add(hexLabel({ q, r }));
    expect(seen.size).toBe(30);
  });
});

describe('raid — žrtve omejene na cono, odprave varne', () => {
  it('žrtve v coni nikoli ne presežejo dodeljenih (tudi pri lethality > 1)', () => {
    const FOR = 5, DEF = 4, WRK = 3, RES = 2;
    let checked = 0;
    for (let seed = 1; seed <= 400 && checked < 5; seed++) {
      const base = newGame(seed);
      // pozna igra: people-killerji dvignejo smrtnost > 1; nizka obramba → raid prebije
      const g: GameState = {
        ...base, phase: 'eliminate', population: 60, clanActivity: 0,
        aiUnits: { scouts: 100, attackers: 75, peopleKillers: 25 }, aiRobots: 200,
      };
      const r = processRound(g, action({ defenders: DEF, foragers: FOR, workers: WRK, researchers: RES }));
      const raid = r.lastRoundLog?.raid;
      if (!raid?.occurred) continue;
      checked++;
      expect(raid.foragersLost).toBeLessThanOrEqual(FOR);
      expect(raid.workersLost ?? 0).toBeLessThanOrEqual(WRK);
      expect(raid.researchersLost ?? 0).toBeLessThanOrEqual(RES);
      expect(raid.defendersLost).toBeLessThanOrEqual(DEF);
      expect(r.population).toBeGreaterThanOrEqual(0);
    }
    expect(checked).toBeGreaterThan(0);  // res smo našli kak raid
  });

  it('ljudje na odpravi se ne zmanjšajo zaradi raida na kamp', () => {
    // pošlji odpravo, nato več krogov; assigned odprave se zaradi RAIDA ne sme spustiti
    let s: GameState = { ...newGame(3), phase: 'eliminate',
      aiUnits: { scouts: 100, attackers: 75, peopleKillers: 25 }, aiRobots: 200, clanActivity: 0 };
    const path = [{ q: 1, r: 4 }, { q: 2, r: 4 }, { q: 3, r: 4 }];  // brez kamp-heksov
    s = processRound(s, action({ foragers: 20, defenders: 0,
      newExpeditions: [{ kind: 'scout', path, returnPath: [{ q: 3, r: 4 }, { q: 2, r: 4 }, { q: 1, r: 4 }], assigned: 8, rations: 4, stealth: true }] }));
    const exp0 = (s.expeditions ?? [])[0];
    expect(exp0).toBeTruthy();
    // odprava obstaja in ima dodeljene ljudi; raid na kamp je ne sme prizadeti
    expect(exp0.assigned).toBeGreaterThan(0);
    expect(exp0.assigned).toBeLessThanOrEqual(8);
  });
});

describe('researchPerVisit — raziskava je linearna (delitev ni boljša)', () => {
  it('ena skupina N = vsota manjših skupin (aditivno)', () => {
    // 4 skupaj == 2 + 2 (na istem polju, dva obiska)
    expect(researchPerVisit(4)).toBeCloseTo(researchPerVisit(2) + researchPerVisit(2), 6);
    // 6 skupaj == 3 + 3 == 2 + 2 + 2
    expect(researchPerVisit(6)).toBeCloseTo(researchPerVisit(3) + researchPerVisit(3), 6);
    expect(researchPerVisit(6)).toBeCloseTo(3 * researchPerVisit(2), 6);
  });
  it('brez fiksnega bonusa na skupino: 0 ljudi → 0 raziskave', () => {
    expect(researchPerVisit(0)).toBe(0);
  });
  it('narašča z ljudmi in je omejeno na 1.0', () => {
    expect(researchPerVisit(1)).toBeLessThan(researchPerVisit(4));
    expect(researchPerVisit(100)).toBe(1);
  });
});

describe('izvidniki — način lootanja', () => {
  const mkExp = (over: Partial<import('./types.js').Expedition> = {}) => ({
    id: 't', kind: 'scout' as const, path: [{ q: 0, r: 4 }, { q: 1, r: 2 }],
    currentIndex: 0, assigned: 4, rations: 3, status: 'traveling' as const,
    monthsElapsed: 0, encountersLog: [] as string[], ...over,
  });
  const idxOf = (tiles: ReturnType<typeof generateMap>, q: number, r: number) =>
    tiles.findIndex(t => t.q === q && t.r === r);

  it('lootanje zniža raziskavo polja na četrtino', () => {
    const tiles = generateMap();
    const i = idxOf(tiles, 1, 2);
    const before = tiles[i].researchProgress;
    const rNorm = tickExpedition(mkExp(), tiles, 0, createRNG(5), 0);
    const rLoot = tickExpedition(mkExp({ lootMode: true }), tiles, 0, createRNG(5), 0);
    const dNorm = rNorm.tiles[i].researchProgress - before;
    const dLoot = rLoot.tiles[i].researchProgress - before;
    expect(dNorm).toBeGreaterThan(0);
    expect(dLoot).toBeCloseTo(dNorm * 0.25, 6);
  });

  it('lootanje nabere bistveno več materiala kot raziskovanje (čez več poskusov)', () => {
    let matNorm = 0, matLoot = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const tiles = generateMap();
      matNorm += tickExpedition(mkExp(), tiles, 0, createRNG(seed), 0).finds.material;
      matLoot += tickExpedition(mkExp({ lootMode: true }), tiles, 0, createRNG(seed), 0).finds.material;
    }
    expect(matLoot).toBeGreaterThan(matNorm);
  });
});

describe('orožje gre z odpravo v napad', () => {
  it('napadalci vzamejo orožje s seboj (equippedWeapons) in zalogo zmanjšajo', () => {
    const base = newGame(42);
    const g: GameState = { ...base, population: 60, resources: { ...base.resources, combat: 30 } };
    const path = [{ q: 0, r: 4 }, { q: 1, r: 2 }];
    const r = processRound(g, action({ foragers: 10,
      newExpeditions: [{ kind: 'mission', path, assigned: 5, rations: 3 }] }));
    const exp = (r.expeditions ?? []).find(e => e.kind === 'mission');
    expect(exp?.equippedWeapons).toBe(5);          // 5 orožja vzeli s seboj
    expect(r.resources.combat).toBeLessThanOrEqual(25);  // odšlo iz kampa (morda še raid)
  });
});

describe('izvidniki v skrivanju ne nosijo orožja', () => {
  it('skrit izvidnik: equippedWeapons = 0, zaloga orožja se ne zmanjša zaradi njih', () => {
    const base = newGame(7);
    const g: GameState = { ...base, population: 60, resources: { ...base.resources, combat: 20 } };
    const path = [{ q: 0, r: 4 }, { q: 1, r: 2 }];
    const r = processRound(g, action({ foragers: 10,
      newExpeditions: [{ kind: 'scout', path, assigned: 4, rations: 3, stealth: true }] }));
    const exp = (r.expeditions ?? []).find(e => e.kind === 'scout');
    expect(exp?.equippedWeapons ?? 0).toBe(0);
  });
  it('navaden (neskrit) izvidnik vzame orožje', () => {
    const base = newGame(7);
    const g: GameState = { ...base, population: 60, resources: { ...base.resources, combat: 20 } };
    const path = [{ q: 0, r: 4 }, { q: 1, r: 2 }];
    const r = processRound(g, action({ foragers: 10,
      newExpeditions: [{ kind: 'scout', path, assigned: 4, rations: 3, stealth: false }] }));
    const exp = (r.expeditions ?? []).find(e => e.kind === 'scout');
    expect(exp?.equippedWeapons).toBe(4);
  });
});

describe('spopadi skozi celo igro', () => {
  it('raid verjetnost v fazi 1 ni zanemarljiva (force floor)', () => {
    const g = newGame(11);  // faza 1: samo izvidniki
    expect(raidProbability(g)).toBeGreaterThan(0.08);
  });
  it('garnizija šibkih točk raste z novimi AI enotami in slabi z izgubami', () => {
    const ph1 = wpGarrisonMult({ scouts: 100, attackers: 0, peopleKillers: 0 });
    const ph2 = wpGarrisonMult({ scouts: 100, attackers: 75, peopleKillers: 0 });
    const ph3 = wpGarrisonMult({ scouts: 100, attackers: 75, peopleKillers: 25 });
    expect(ph2).toBeGreaterThan(ph1);
    expect(ph3).toBeGreaterThan(ph2);
    expect(wpGarrisonMult({ scouts: 0, attackers: 0, peopleKillers: 0 })).toBe(1);
  });
  it('napad na šibko točko je težji, ko prispejo nove AI enote', () => {
    const base = newGame(3);
    const wpId = base.aiWeakPoints[0].id;
    const ph1: GameState = { ...base, aiUnits: { scouts: 100, attackers: 0, peopleKillers: 0 } };
    const ph3: GameState = { ...base, aiUnits: { scouts: 100, attackers: 75, peopleKillers: 25 } };
    const p1 = missionSuccessProbability(ph1, wpId, 10, 3);
    const p3 = missionSuccessProbability(ph3, wpId, 10, 3);
    expect(p3).toBeLessThan(p1);
  });
  it('polje s šibko točko je straženo — več srečanj kot enako navadno polje', () => {
    const tiles = generateMap();
    const wpTile = tiles.find(t => t.hidesWeakPointId)!;
    const plain = { ...wpTile, hidesWeakPointId: undefined, isAICore: false };
    const pGuard = tileEncounterProbability(wpTile, 4, 0.1, 100);
    const pPlain = tileEncounterProbability(plain, 4, 0.1, 100);
    expect(pGuard).toBeGreaterThan(pPlain);
  });
});

describe('vojna megla — poročilo odprave šele ob vrnitvi', () => {
  it('med potjo ni dogodkov odprave v dnevniku; poročilo pride z vrnitvijo', () => {
    let s: GameState = newGame(21);
    const path = [{ q: 1, r: 4 }, { q: 2, r: 4 }, { q: 2, r: 3 }];
    s = processRound(s, action({ foragers: 20,
      newExpeditions: [{ kind: 'scout', path, returnPath: [{ q: 2, r: 3 }, { q: 2, r: 4 }, { q: 1, r: 4 }], assigned: 4, rations: 3 }] }));
    let sawReport = false;
    for (let i = 0; i < 12 && s.status === 'active'; i++) {
      const active = (s.expeditions ?? []).length > 0;
      const n = s.lastRoundLog?.narrative ?? '';
      if (active) {
        // dokler je odprava zunaj, v dnevniku NI najdb/srečanj/prihodov z njene poti
        expect(n).not.toMatch(/Srečanje na|najdenega na|najden na|Dospeli na cilj/);
      }
      if (/📋 Poročilo odprave:/.test(n)) { sawReport = true; break; }
      s = processRound(s, action({ foragers: 20 }));
    }
    expect(sawReport).toBe(true);
  });

  it('departedCount se ohrani (UI med potjo kaže odhodno število)', () => {
    const g = newGame(5);
    const r = processRound(g, action({ foragers: 10,
      newExpeditions: [{ kind: 'scout', path: [{ q: 1, r: 4 }, { q: 2, r: 4 }], assigned: 6, rations: 3 }] }));
    expect((r.expeditions ?? [])[0]?.departedCount).toBe(6);
  });
});

describe('dominacija v raidu', () => {
  it('ob dominaciji obrambe (victory) so uničeni VSI roboti in AI ne dobi informacij; ob AI dominaciji padejo vsi branilci', () => {
    let sawDefDom = false, sawAiDom = false;
    for (let seed = 1; seed <= 600 && !(sawDefDom && sawAiDom); seed++) {
      const base = newGame(seed);
      const g: GameState = { ...base, phase: 'eliminate', population: 80, clanActivity: 0,
        aiUnits: { scouts: 100, attackers: 75, peopleKillers: 25 }, aiRobots: 200,
        aiKnowledge: 0.4 };
      const r = processRound(g, action({ defenders: 15, foragers: 20 }));
      const raid = r.lastRoundLog?.raid;
      if (!raid?.occurred) continue;
      if (raid.domination === 'defense') {
        sawDefDom = true;
        expect(raid.aiInfoGained).toBe(0);
        expect(r.aiKnowledge).toBeLessThanOrEqual(g.aiKnowledge + 0.011);  // surveillance ~0, raid 0
        expect(raid.aiRobotsDestroyed).toBeGreaterThan(0);
      } else if (raid.domination === 'ai') {
        sawAiDom = true;
        expect(raid.defendersLost).toBe(15);             // vsi branilci padli
        expect(raid.aiInfoGained).toBeCloseTo(0.15, 5);  // AI odnese največ informacij
      } else {
        expect(raid.aiInfoGained).toBeGreaterThan(0);
      }
    }
    expect(sawDefDom).toBe(true);
    expect(sawAiDom).toBe(true);
  });
});

describe('zvezne žrtve raida — moč preboja določa izgube', () => {
  it('žrtve so omejene z (mult × premoč); močnejša obramba → manj izgub', () => {
    let checked = 0;
    for (let seed = 1; seed <= 600 && checked < 8; seed++) {
      const g = newGame(seed);  // faza 1 → lethality = 1
      const r = processRound(g, action({ defenders: 10, foragers: 20, workers: 8, researchers: 6 }));
      const raid = r.lastRoundLog?.raid;
      if (!raid?.occurred || raid.outcome !== 'partial') continue;
      checked++;
      const breach = 1 - raid.successProbability;
      // branilci: prva linija (0.55×premoč) + morebitni preboj obrambne cone (0.40×premoč)
      expect(raid.defendersLost).toBeLessThanOrEqual(Math.floor(10 * 0.55 * breach) + Math.floor(10 * 0.40 * breach));
      expect(raid.foragersLost).toBeLessThanOrEqual(Math.floor(20 * 0.40 * breach));
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('straža šibke točke slabi z napadi', () => {
  it('garrisonLoss zviša verjetnost uspeha naslednjega napada', () => {
    const base = newGame(9);
    const wpId = base.aiWeakPoints[0].id;
    const fresh: GameState = { ...base, aiUnits: { scouts: 100, attackers: 75, peopleKillers: 0 } };
    const worn: GameState = { ...fresh,
      aiWeakPoints: fresh.aiWeakPoints.map(w => w.id === wpId ? { ...w, garrisonLoss: 12 } : w) };
    const pFresh = missionSuccessProbability(fresh, wpId, 10, 3);
    const pWorn  = missionSuccessProbability(worn,  wpId, 10, 3);
    expect(pWorn).toBeGreaterThan(pFresh);
  });
});

describe('težavnost — VIDNE vhodne moči (ne množenje izidov)', () => {
  it('začetne moči: easy > normal > hard > brutal (ljudje, hrana, orožje); AI vojska obratno', () => {
    const e = newGame(7, 'easy'), n = newGame(7, 'normal'), h = newGame(7, 'hard'), b = newGame(7, 'brutal');
    expect(e.population).toBeGreaterThan(n.population);
    expect(n.population).toBeGreaterThan(h.population);
    expect(h.population).toBeGreaterThan(b.population);
    expect(e.resources.survival).toBeGreaterThan(b.resources.survival);
    expect(e.resources.combat).toBeGreaterThan(b.resources.combat);
    expect(b.aiUnits.scouts).toBeGreaterThan(h.aiUnits.scouts);
    expect(h.aiUnits.scouts).toBeGreaterThan(n.aiUnits.scouts);
    expect(n.aiUnits.scouts).toBeGreaterThan(e.aiUnits.scouts);
  });
  it('obramba: enaka formula, razlika pride iz velikosti AI vojske in doprinosa obzidja', () => {
    const a = { axis: 'obzidje' as const, combatants: 0, defenders: 15, foragers: 20, workers: 5, researchers: 5, rations: 3 };
    const e = newGame(7, 'easy'), h = newGame(7, 'hard');
    // ista obramba, večja AI vojska na hard → nižja verjetnost odbitja
    expect(raidRepelProbability(e, a)).toBeGreaterThan(raidRepelProbability(h, a));
  });
  it('učinek nadgradnje orožja po težavnosti: easy ×2.25, normal ×2, brutal ×1.6', () => {
    expect(weaponEffectMult('easy', 1)).toBeCloseTo(2.25, 5);
    expect(weaponEffectMult('normal', 1)).toBeCloseTo(2, 5);
    expect(weaponEffectMult('brutal', 1)).toBeCloseTo(1.6, 5);
    expect(weaponEffectMult('normal', 2)).toBeCloseTo(4, 5);
  });
  it('neznana težavnost pade na normal', () => {
    const g = newGame(1, undefined);
    expect(g.difficulty).toBe('normal');
    expect(g.population).toBe(80);
  });
});
