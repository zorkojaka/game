// EVOLUCIJA STRATEGIJ — genetski algoritem nad deterministicnim enginom.
// Strategija = genom (razporeditve po fazah + odlocitve). Vsako generacijo:
// turnirska selekcija → krizanje → mutacija; elita prezivi. Fitness = zmage,
// unicene sibke tocke, pobiti roboti, preziveti meseci.
//
// Uporaba:  npm run build && node scripts/evolve.mjs [difficulty=normal] [generacij=12] [populacija=16] [iger/osebek=10] [maxMesecev=72]
// Izhod:    tabela po generacijah + najboljsa strategija (cloveski opis) + scripts/evolution-<diff>.json

import { newGame, processRound } from '../dist/engine/game.js';
import fs from 'node:fs';

const DIFF = process.argv[2] ?? 'normal';
const GENERATIONS = parseInt(process.argv[3] ?? '12', 10);
const POP = parseInt(process.argv[4] ?? '16', 10);
const GAMES = parseInt(process.argv[5] ?? '10', 10);
const MAXM = parseInt(process.argv[6] ?? '72', 10);

// ── heks pomocniki ──
const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const dist = (a,b)=>(Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs((-a.q-a.r)-(-b.q-b.r)))/2;
function greedyPath(from,to){const p=[{q:from.q,r:from.r}];let c={...from},g=0;
while((c.q!==to.q||c.r!==to.r)&&g++<40){let b=null,bd=1e9;for(const[dq,dr]of DIRS){const n={q:c.q+dq,r:c.r+dr};if(n.q<0||n.q>=6||n.r<0||n.r>=5)continue;const d=dist(n,to);if(d<bd){bd=d;b=n;}}if(!b)break;c=b;p.push(c);}return p;}

// ── GENOM ──────────────────────────────────────────────────────────────────────
// 16 razporeditvenih genov (4 obdobja × 4 vloge, 0..1, normalizirano na ~92 % pop)
// + 6 odlocitvenih genov. Vsi geni so v [0,1].
const PHASES = ['find', 'understand', 'eliminate', 'assault'];
const GENE_NAMES = [
  ...PHASES.flatMap(p => [`${p}.def`, `${p}.for`, `${p}.wrk`, `${p}.res`]),
  'scoutCount',    // 0..1 → 0–3 vzporedne izvidnice
  'scoutStealth',  // > 0.5 → skrite (brez orozja, pocasnejse)
  'attackForce',   // 0..1 → 8–20 ljudi na napad
  'attackEarly',   // > 0.5 → napada ze v fazi 2 (sicer sele v fazi 3)
  'wallsTarget',   // 0..1 → 0–8 obzidij
  'rations',       // 0..1 → obroki 2–4
];
const N_GENES = GENE_NAMES.length;

const rnd = () => Math.random();
const randomGenome = () => Array.from({ length: N_GENES }, rnd);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function decode(g) {
  const alloc = {};
  PHASES.forEach((p, i) => {
    const raw = g.slice(i * 4, i * 4 + 4).map(x => x + 0.05);
    const sum = raw.reduce((a, b) => a + b, 0);
    alloc[p] = { def: raw[0]/sum*0.92, for: raw[1]/sum*0.92, wrk: raw[2]/sum*0.92, res: raw[3]/sum*0.92 };
  });
  const o = 16;
  return {
    alloc,
    scoutCount: Math.round(g[o] * 3),
    scoutStealth: g[o+1] > 0.5,
    attackForce: 8 + Math.round(g[o+2] * 12),
    attackEarly: g[o+3] > 0.5,
    wallsTarget: Math.round(g[o+4] * 8),
    rations: 2 + Math.round(g[o+5] * 2),
  };
}

// ── BOT, voden z genomom ───────────────────────────────────────────────────────
function genomeBot(S) {
  return (s) => {
    const pop = Math.max(0, s.population);
    const camp = (s.mapTiles ?? []).find(t => t.isClanCamp) ?? { q: 0, r: 4 };
    const exps = s.expeditions ?? [];
    const ctx = s.totalRounds > 36 ? 'assault' : s.phase;
    const A = S.alloc[ctx];
    const a = { axis: 'obzidje', combatants: 0, rations: S.rations,
      researchObjective: (s.robotsResearchLevel ?? 0) < 1 ? 'robots'
        : (s.weaponResearchLevel ?? 0) < (s.robotsResearchLevel ?? 0) ? 'weapon' : 'robots',
      workshopObjective: (s.wallsBuilt ?? 0) < S.wallsTarget ? 'wall' : 'weapon',
      defenders: Math.min(Math.floor(pop * A.def), Math.floor(s.resources.combat)),
      foragers: Math.floor(pop * A.for),
      workers: Math.floor(pop * A.wrk),
      researchers: Math.floor(pop * A.res) };
    let free = Math.max(0, pop - a.defenders - a.foragers - a.workers - a.researchers
      - exps.reduce((n, e) => n + e.assigned, 0));
    const newExps = [];
    // napad na odkrito sibko tocko
    const wantAttack = S.attackEarly ? s.phase !== 'find' : (s.phase === 'eliminate' || s.totalRounds > 36);
    const missionOut = exps.some(e => e.kind === 'mission');
    const wp = (s.aiWeakPoints ?? []).find(w => w.discovered && !w.exploited);
    if (wp && wantAttack && !missionOut) {
      const tile = (s.mapTiles ?? []).find(t => t.hidesWeakPointId === wp.id);
      const force = Math.min(S.attackForce, free, Math.floor(s.resources.combat));
      if (tile && force >= 8) {
        newExps.push({ kind: 'mission', weakPointId: wp.id, path: greedyPath(camp, tile), assigned: force, rations: 4 });
        free -= force;
      }
    }
    // vzporedne izvidnice
    const scoutsOut = exps.filter(e => e.kind === 'scout').length;
    const targeted = new Set(exps.map(e => { const t = e.path[e.path.length - 1]; return t.q + ',' + t.r; }));
    if (pop > 25 && S.scoutCount > 0) {
      const unexplored = (s.mapTiles ?? [])
        .filter(t => !t.isClanCamp && t.researchProgress < 0.5 && !targeted.has(t.q + ',' + t.r))
        .sort((x, y) => dist(x, camp) - dist(y, camp));
      for (let i = scoutsOut + newExps.filter(e => e.kind === 'scout').length; i < S.scoutCount && free >= 4 && unexplored.length; i++) {
        const tgt = unexplored.shift();
        newExps.push({ kind: 'scout', path: greedyPath(camp, tgt), assigned: 4, rations: 3, stealth: S.scoutStealth });
        free -= 4;
      }
    }
    if (newExps.length) a.newExpeditions = newExps;
    return { assignment: a };
  };
}

// ── FITNESS ────────────────────────────────────────────────────────────────────
function evaluate(genome, seeds) {
  const S = decode(genome);
  const bot = genomeBot(S);
  let fit = 0, wins = 0, wps = 0, months = 0;
  for (const seed of seeds) {
    let s = newGame(seed, DIFF);
    const robots0 = s.aiRobots;
    let m = 0;
    while (s.status === 'active' && m < MAXM) { m++; s = processRound(s, bot(s)); }
    const exploited = s.aiWeakPoints.filter(w => w.exploited).length;
    const robotsKilled = 1 - Math.max(0, s.aiRobots) / Math.max(1, robots0 + 100);  // groba norma (prihodi)
    if (s.status === 'victory') { wins++; fit += 1000 + (MAXM - m) * 5; }  // hitrejsa zmaga = bolje
    fit += exploited * 120 + robotsKilled * 80 + m;
    wps += exploited; months += m;
  }
  return { fit: fit / seeds.length, wins, wps: wps / seeds.length, months: months / seeds.length };
}

// ── GA ─────────────────────────────────────────────────────────────────────────
function tournament(scored) {
  const a = scored[Math.floor(rnd() * scored.length)];
  const b = scored[Math.floor(rnd() * scored.length)];
  return (a.fit >= b.fit ? a : b).genome;
}
function crossover(a, b) { return a.map((x, i) => (rnd() < 0.5 ? x : b[i])); }
function mutate(g) { return g.map(x => (rnd() < 0.35 ? clamp01(x + (rnd() - 0.5) * 0.3) : x)); }

function describe(S) {
  const pct = (x) => `${Math.round(x * 100)} %`;
  const lines = [];
  for (const p of PHASES) {
    const A = S.alloc[p];
    const label = { find: 'FAZA 1 (išči)', understand: 'FAZA 2 (pripravi)', eliminate: 'FAZA 3 (napadi)', assault: 'TOTALNI NAPAD' }[p];
    lines.push(`  ${label}: obramba ${pct(A.def)} · hrana ${pct(A.for)} · delavnice ${pct(A.wrk)} · raziskave ${pct(A.res)}`);
  }
  lines.push(`  izvidnice: ${S.scoutCount} vzporednih${S.scoutStealth ? ' (skrite, brez orožja)' : ''}`);
  lines.push(`  napad: ${S.attackForce} ljudi, ${S.attackEarly ? 'že od faze 2' : 'šele v fazi 3'}`);
  lines.push(`  obzidje: cilj ${S.wallsTarget} · obroki: ${S.rations}`);
  return lines.join('\n');
}

console.log(`EVOLUCIJA STRATEGIJ — težavnost: ${DIFF}, ${GENERATIONS} generacij × ${POP} osebkov × ${GAMES} iger (max ${MAXM} mes.)\n`);
let population = Array.from({ length: POP }, randomGenome);
let best = null;
const history = [];
for (let gen = 1; gen <= GENERATIONS; gen++) {
  const seeds = Array.from({ length: GAMES }, (_, i) => gen * 1000 + i + 1);
  const scored = population.map(genome => ({ genome, ...evaluate(genome, seeds) }));
  scored.sort((a, b) => b.fit - a.fit);
  const top = scored[0];
  if (!best || top.fit > best.fit) best = { ...top, gen };
  const avg = scored.reduce((s, x) => s + x.fit, 0) / scored.length;
  history.push({ gen, bestFit: Math.round(top.fit), avgFit: Math.round(avg), bestWins: top.wins, bestWp: top.wps });
  console.log(`gen ${String(gen).padStart(2)} | najboljši fitness ${String(Math.round(top.fit)).padStart(5)} | povp ${String(Math.round(avg)).padStart(5)} | zmage najboljšega ${top.wins}/${GAMES} | šibke točke ${top.wps.toFixed(1)}/3`);
  // nova generacija: elita 2 + potomci
  const next = [scored[0].genome, scored[1].genome];
  while (next.length < POP) next.push(mutate(crossover(tournament(scored), tournament(scored))));
  population = next;
}

console.log(`\n🏆 NAJBOLJŠA STRATEGIJA (gen ${best.gen}, fitness ${Math.round(best.fit)}, zmage ${best.wins}/${GAMES}, šibke točke ${best.wps.toFixed(1)}/3):`);
console.log(describe(decode(best.genome)));
fs.writeFileSync(new URL(`./evolution-${DIFF}.json`, import.meta.url),
  JSON.stringify({ difficulty: DIFF, generations: GENERATIONS, history, best: { gen: best.gen, fit: best.fit, wins: best.wins, genome: best.genome, strategy: decode(best.genome) } }, null, 2));
console.log(`\nShranjeno v scripts/evolution-${DIFF}.json`);
