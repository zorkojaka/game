// Simulator težavnosti — odigra N iger na profil s preprostim botom in izpiše izide.
// Uporaba:  npm run build && node scripts/simulate.mjs [iger=100]
import { newGame, processRound } from '../dist/engine/game.js';
import { DIFFICULTIES } from '../dist/engine/difficulty.js';

const N = parseInt(process.argv[2] ?? '100', 10);
const MAX_ROUNDS = 40;

// Preprost bot: stabilna razporeditev + raziskave robotov + občasna izvidnica.
function botAction(s, month) {
  const a = { axis: 'obzidje', combatants: 0, defenders: 15, foragers: 22, workers: 6, researchers: 8,
    rations: 3, researchObjective: 'robots', workshopObjective: 'weapon' };
  if (month % 4 === 1 && (s.expeditions ?? []).length === 0 && s.population > 45) {
    a.newExpeditions = [{ kind: 'scout', path: [{ q: 1, r: 4 }, { q: 2, r: 4 }, { q: 2, r: 3 }], assigned: 4, rations: 3 }];
  }
  return { assignment: a };
}

console.log(`Simulacija: ${N} iger na profil, max ${MAX_ROUNDS} mesecev, bot: statična baza + izvidnice\n`);
for (const d of Object.values(DIFFICULTIES)) {
  const out = { victory: 0, defeat_extinction: 0, defeat_overwhelmed: 0, timeout: 0 };
  let sumMonths = 0, sumPopEnd = 0;
  for (let seed = 1; seed <= N; seed++) {
    let s = newGame(seed, d.id);
    let m = 0;
    while (s.status === 'active' && m < MAX_ROUNDS) { m++; s = processRound(s, botAction(s, m)); }
    sumMonths += m; sumPopEnd += Math.max(0, s.population);
    if (s.status === 'active') out.timeout++;
    else out[s.status] = (out[s.status] ?? 0) + 1;
  }
  const pct = (k) => `${Math.round((out[k] ?? 0) / N * 100)} %`;
  console.log(`${d.id.padEnd(7)} | zmaga ${pct('victory').padStart(5)} | izumrtje ${pct('defeat_extinction').padStart(5)} | poraz ${pct('defeat_overwhelmed').padStart(5)} | preživeli do konca ${pct('timeout').padStart(5)} | povp. mesecev ${(sumMonths / N).toFixed(1)} | povp. pop ob koncu ${(sumPopEnd / N).toFixed(0)}`);
}
