// Simulator težavnosti — dva bota na profil:
//  • PASIVNI: statična baza, brez napadov (meri preživetje).
//  • AGRESIVNI: igra po predvidenem loku igre —
//      faza 1: raziskuj mapo (izvidnice), raziskave robotov,
//      faza 2: priprava (obzidje, raziskava orožja, orožje) + prvi napadi,
//      faza 3: napadaj šibke točke do konca.
// Uporaba:  npm run build && node scripts/simulate.mjs [iger=100]
import { newGame, processRound } from '../dist/engine/game.js';
import { DIFFICULTIES } from '../dist/engine/difficulty.js';

const N = parseInt(process.argv[2] ?? '100', 10);
const MAX_ROUNDS = 40;

// ── heks pomočniki (axial, kot engine) ──
const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const dist = (a, b) => (Math.abs(a.q-b.q) + Math.abs(a.r-b.r) + Math.abs((-a.q-a.r)-(-b.q-b.r))) / 2;
function greedyPath(from, to) {
  const path = [{ q: from.q, r: from.r }];
  let cur = { ...from };
  let guard = 0;
  while ((cur.q !== to.q || cur.r !== to.r) && guard++ < 40) {
    let best = null, bd = Infinity;
    for (const [dq, dr] of DIRS) {
      const n = { q: cur.q + dq, r: cur.r + dr };
      if (n.q < 0 || n.q >= 6 || n.r < 0 || n.r >= 5) continue;
      const d = dist(n, to);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) break;
    cur = best; path.push(cur);
  }
  return path;
}

function passiveBot(s, month) {
  const a = { axis: 'obzidje', combatants: 0, defenders: 15, foragers: 22, workers: 6, researchers: 8,
    rations: 3, researchObjective: 'robots', workshopObjective: 'weapon' };
  if (month % 4 === 1 && (s.expeditions ?? []).length === 0 && s.population > 45) {
    a.newExpeditions = [{ kind: 'scout', path: [{ q: 1, r: 4 }, { q: 2, r: 4 }, { q: 2, r: 3 }], assigned: 4, rations: 3 }];
  }
  return { assignment: a };
}

function aggressiveBot(s) {
  const pop = Math.max(0, s.population);
  const camp = (s.mapTiles ?? []).find(t => t.isClanCamp) ?? { q: 0, r: 4 };
  const exps = s.expeditions ?? [];
  const phase = s.phase;

  // razporeditev po fazah (delez preostale populacije)
  let defFrac, forFrac, wrkFrac, resFrac;
  if (phase === 'find')            { defFrac = .15; forFrac = .32; wrkFrac = .12; resFrac = .20; }
  else if (phase === 'understand') { defFrac = .25; forFrac = .30; wrkFrac = .20; resFrac = .15; }
  else                             { defFrac = .28; forFrac = .30; wrkFrac = .15; resFrac = .10; }

  const researchObjective = (s.robotsResearchLevel ?? 0) < 1 ? 'robots'
    : (s.weaponResearchLevel ?? 0) < (s.robotsResearchLevel ?? 0) ? 'weapon' : 'robots';
  const workshopObjective = phase === 'find' ? 'weapon'
    : (s.wallsBuilt ?? 0) < 4 ? 'wall' : 'weapon';

  const a = { axis: 'obzidje', combatants: 0, rations: 3, researchObjective, workshopObjective,
    defenders: Math.min(Math.floor(pop * defFrac), Math.floor(s.resources.combat)),
    foragers: Math.floor(pop * forFrac),
    workers: Math.floor(pop * wrkFrac),
    researchers: Math.floor(pop * resFrac) };

  const newExps = [];
  let free = Math.max(0, pop - a.defenders - a.foragers - a.workers - a.researchers
    - exps.reduce((n, e) => n + e.assigned, 0));

  // NAPAD: na vsako odkrito neunicen tocko (ena misija naenkrat), z mocno silo
  const missionOut = exps.some(e => e.kind === 'mission');
  const targetWp = (s.aiWeakPoints ?? []).find(w => w.discovered && !w.exploited);
  if (targetWp && phase !== 'find' && !missionOut) {
    const tile = (s.mapTiles ?? []).find(t => t.hidesWeakPointId === targetWp.id);
    const force = Math.min(16, free, Math.floor(s.resources.combat));
    if (tile && force >= 8) {
      newExps.push({ kind: 'mission', weakPointId: targetWp.id,
        path: greedyPath(camp, tile), assigned: force, rations: 4 });
      free -= force;
    }
  }

  // IZVIDOVANJE: do 3 VZPOREDNE skrite izvidnice (brez orozja!) na razlicna neraziskana polja
  const scoutsOut = exps.filter(e => e.kind === 'scout').length + newExps.filter(e => e.kind === 'scout').length;
  const targeted = new Set(exps.map(e => { const t = e.path[e.path.length - 1]; return t.q + ',' + t.r; }));
  const wantScouts = phase === 'find' ? 3 : 1;
  if (pop > 25) {
    const unexplored = (s.mapTiles ?? [])
      .filter(t => !t.isClanCamp && t.researchProgress < 0.5 && !targeted.has(t.q + ',' + t.r))
      .sort((x, y) => dist(x, camp) - dist(y, camp));
    for (let i = scoutsOut; i < wantScouts && free >= 4 && unexplored.length; i++) {
      const tgt = unexplored.shift();
      targeted.add(tgt.q + ',' + tgt.r);
      newExps.push({ kind: 'scout', path: greedyPath(camp, tgt), assigned: 4, rations: 3, stealth: true });
      free -= 4;
    }
  }
  if (newExps.length) a.newExpeditions = newExps;
  return { assignment: a };
}

function run(bot, difficulty, n) {
  const out = { victory: 0, defeat_extinction: 0, defeat_overwhelmed: 0, timeout: 0 };
  let sumMonths = 0, sumPop = 0;
  for (let seed = 1; seed <= n; seed++) {
    let s = newGame(seed, difficulty);
    let m = 0;
    while (s.status === 'active' && m < MAX_ROUNDS) { m++; s = processRound(s, bot(s, m)); }
    sumMonths += m; sumPop += Math.max(0, s.population);
    if (s.status === 'active') out.timeout++; else out[s.status] = (out[s.status] ?? 0) + 1;
  }
  return { out, avgM: sumMonths / n, avgP: sumPop / n };
}

console.log(`Simulacija: ${N} iger × profil × bot (max ${MAX_ROUNDS} mes.)\n`);
console.log('profil  | bot       | zmaga | izumrtje | poraz | preživeli | povp.mes | povp.pop');
for (const d of Object.values(DIFFICULTIES)) {
  for (const [name, bot] of [['pasivni', passiveBot], ['agresivni', aggressiveBot]]) {
    const { out, avgM, avgP } = run(bot, d.id, N);
    const pct = (k) => `${Math.round((out[k] ?? 0) / N * 100)} %`.padStart(5);
    console.log(`${d.id.padEnd(7)} | ${name.padEnd(9)} | ${pct('victory')} | ${pct('defeat_extinction').padStart(8)} | ${pct('defeat_overwhelmed')} | ${pct('timeout').padStart(9)} | ${avgM.toFixed(1).padStart(8)} | ${avgP.toFixed(0).padStart(8)}`);
  }
}
