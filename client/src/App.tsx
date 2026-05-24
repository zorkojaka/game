import { useState, useEffect } from 'react';
import type { GameState, HumanAxis, OddsPreview, AITreeNode, AIWeakPoint, RoundLog, CombatResult } from './types';
import { createGame, getGame, playRound, previewOdds } from './api';

// ─── Konstante za UI ─────────────────────────────────────────────────────────

const PHASE_INFO = {
  find:       { label: 'FAZA 1 — AI IŠČE',      color: '#ff8c42', bestAxis: 'hiding'    as HumanAxis },
  understand: { label: 'FAZA 2 — AI RAZUME',     color: '#ff4444', bestAxis: 'espionage' as HumanAxis },
  eliminate:  { label: 'FAZA 3 — AI IZTREBLJA',  color: '#cc1111', bestAxis: 'defense'  as HumanAxis },
};

const AXIS_INFO: Record<HumanAxis, { label: string; desc: string }> = {
  hiding:    { label: 'Skrivanje',  desc: 'Izogibanje AI radarju' },
  espionage: { label: 'Špijonaža', desc: 'Zbiranje informacij o AI' },
  defense:   { label: 'Obramba',   desc: 'Utrjevanje položajev' },
};

// Kopija M_OS iz engine/constants.ts — za UI preview
const M_OS: Record<string, Record<HumanAxis, number>> = {
  find:       { hiding: 1.4, espionage: 1.0, defense: 0.5 },
  understand: { hiding: 0.8, espionage: 1.5, defense: 0.7 },
  eliminate:  { hiding: 0.5, espionage: 0.9, defense: 1.4 },
};

const STORAGE_KEY = 'avh-runId';

// ─── Pomožne funkcije ─────────────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%`; }
function clr(val: number, warn: number, danger: number) {
  if (val <= danger) return '#ff4444';
  if (val <= warn)   return '#ffaa00';
  return '#e0e0e0';
}
function sign(n: number) { return n >= 0 ? `+${n}` : `${n}`; }
function outcomeLabel(o: CombatResult['outcome']) {
  return { victory: '✓ ZMAGA', partial: '~ DELNA ZMAGA', defeat: '✗ PORAZ', annihilation: '☠ POKOL' }[o];
}
function outcomeColor(o: CombatResult['outcome']) {
  return { victory: '#44ff88', partial: '#ffaa00', defeat: '#ff4444', annihilation: '#cc0000' }[o];
}

// ─── Komponente ───────────────────────────────────────────────────────────────

function PhaseHeader({ game }: { game: GameState }) {
  const info = PHASE_INFO[game.phase];
  const progress = (game.round - 1) / 12;
  return (
    <div className="phase-header">
      <div className="phase-title" style={{ color: info.color }}>
        {info.label}
      </div>
      <div className="phase-meta">
        <span>Mesec {game.round}/12</span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress * 100}%`, background: info.color }} />
        </div>
        <span className="dim">Skupaj {game.totalRounds}/36</span>
      </div>
    </div>
  );
}

function ResourceBar({ game }: { game: GameState }) {
  const { resources: r } = game;
  const survWarn = game.population * 4;
  const survDanger = game.population * 2;
  return (
    <div className="resource-bar">
      <Stat icon="👥" label="Populacija"  val={`${game.population}/${game.maxPopulation}`} color={clr(game.population, game.maxPopulation * 0.3, game.maxPopulation * 0.15)} />
      <Stat icon="🍞" label="Hrana/Voda"  val={r.survival}  color={clr(r.survival, survWarn, survDanger)} />
      <Stat icon="⚔"  label="Orožje"      val={r.combat}    color={clr(r.combat, 30, 10)} />
      <Stat icon="👁"  label="Intel"       val={r.intelligence} />
      <div className="res-sep" />
      <Stat icon="🤖" label="AI roboti"   val={game.aiRobots} color="#ff6666" />
      <Stat icon="🧠" label="AI ve o nas" val={pct(game.aiKnowledge)} color={clr(1 - game.aiKnowledge, 0.6, 0.4)} />
      <Stat icon="🌍" label="Klani aktiv" val={pct(game.clanActivity)} color={clr(game.clanActivity, 0.4, 0.2)} />
    </div>
  );
}

function Stat({ icon, label, val, color }: { icon: string; label: string; val: string | number; color?: string }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-val" style={{ color: color ?? '#e0e0e0' }}>{val}</span>
    </div>
  );
}

function AITreePanel({ nodes }: { nodes: AITreeNode[] }) {
  const byPhase = {
    find:       nodes.filter(n => n.phase === 'find'),
    understand: nodes.filter(n => n.phase === 'understand'),
    eliminate:  nodes.filter(n => n.phase === 'eliminate'),
  };
  const revealed = nodes.filter(n => n.visibility === 'revealed').length;
  return (
    <div className="panel">
      <h3>AI DREVO <span className="dim">({revealed}/{nodes.length} odkritih)</span></h3>
      {(Object.entries(byPhase) as [string, AITreeNode[]][]).map(([phase, pnodes]) => (
        <div key={phase} className="tree-phase">
          <div className="tree-phase-label" style={{ color: PHASE_INFO[phase as keyof typeof PHASE_INFO].color }}>
            {PHASE_INFO[phase as keyof typeof PHASE_INFO].label}
          </div>
          {pnodes.map(n => (
            <div key={n.id} className={`tree-node vis-${n.visibility} ${n.executed ? 'executed' : ''}`}>
              {n.visibility === 'unknown' && <><span className="fog">░░░</span> <span className="dim">[zakrito]</span></>}
              {n.visibility === 'partial' && <><span className="fog-partial">▒▒</span> {n.label} <span className="dim">[delno]</span></>}
              {n.visibility === 'revealed' && <><span className="revealed-mark">▓</span> {n.label} <span className="strength">str:{n.strength}</span>{n.executed && <span className="executed-mark"> [IZVEDEN]</span>}</>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function WeakPointsPanel({ weakPoints, target, onTarget }: {
  weakPoints: AIWeakPoint[];
  target: string;
  onTarget: (id: string) => void;
}) {
  return (
    <div className="panel">
      <h3>ŠIBKE TOČKE AI</h3>
      {weakPoints.map(wp => (
        <div key={wp.id} className={`wp-item ${wp.exploited ? 'exploited' : wp.discovered ? 'discovered' : ''}`}>
          <span className="wp-icon">{wp.exploited ? '✓' : wp.discovered ? '★' : '○'}</span>
          <span className="wp-label">
            {wp.discovered ? wp.label : `??? [${PHASE_INFO[wp.phase].label.split('—')[0].trim()}]`}
          </span>
          {wp.discovered && !wp.exploited && (
            <button
              className={`wp-target-btn ${target === wp.id ? 'active' : ''}`}
              onClick={() => onTarget(target === wp.id ? '' : wp.id)}
            >
              {target === wp.id ? '🎯 CILJ' : 'Ciljaj'}
            </button>
          )}
          {wp.exploited && <span className="wp-done">UNIČENO</span>}
        </div>
      ))}
      <div className="dim small" style={{ marginTop: 8 }}>
        Odkrij z inteligence, exploitaj z bojem.
      </div>
    </div>
  );
}

function NumberInput({ label, val, onChange, max, yield_label }: {
  label: string; val: number; onChange: (n: number) => void; max: number; yield_label: string;
}) {
  return (
    <div className="num-row">
      <span className="num-label">{label}</span>
      <button className="num-btn" onClick={() => onChange(Math.max(0, val - 5))}>−5</button>
      <button className="num-btn" onClick={() => onChange(Math.max(0, val - 1))}>−</button>
      <span className="num-val">{val}</span>
      <button className="num-btn" onClick={() => onChange(Math.min(max, val + 1))}>+</button>
      <button className="num-btn" onClick={() => onChange(Math.min(max, val + 5))}>+5</button>
      <span className="num-yield dim">{yield_label}</span>
    </div>
  );
}

function AssignmentPanel({ game, axis, onAxis, combatants, onCombatants, foragers, onForagers, scouts, onScouts }: {
  game: GameState;
  axis: HumanAxis; onAxis: (a: HumanAxis) => void;
  combatants: number; onCombatants: (n: number) => void;
  foragers: number;   onForagers:   (n: number) => void;
  scouts: number;     onScouts:     (n: number) => void;
}) {
  const pop = game.population;
  const assigned = combatants + foragers + scouts;
  const free = pop - assigned;
  const over = free < 0;
  const survBalance = foragers * 4 - game.population;

  return (
    <div className="panel">
      <h3>RAZPOREDI ENOTE</h3>

      {/* Axis selector */}
      <div className="section-label">Strategijska os:</div>
      <div className="axis-group">
        {(Object.keys(AXIS_INFO) as HumanAxis[]).map(a => {
          const mVal = M_OS[game.phase][a];
          const isRight = PHASE_INFO[game.phase].bestAxis === a;
          return (
            <button
              key={a}
              className={`axis-btn ${axis === a ? 'selected' : ''} ${isRight ? 'right-axis' : ''}`}
              onClick={() => onAxis(a)}
            >
              <span className="axis-name">{AXIS_INFO[a].label}</span>
              <span className="axis-mos" style={{ color: isRight ? '#44ff88' : mVal < 0.8 ? '#ff4444' : '#ffaa00' }}>
                ×{mVal}
              </span>
            </button>
          );
        })}
      </div>
      <div className="axis-hint dim small">
        {AXIS_INFO[axis].desc} · M_os: ×{M_OS[game.phase][axis]}
        {PHASE_INFO[game.phase].bestAxis === axis
          ? ' ✓ PRAVILNA OS ZA TO FAZO'
          : ` (idealna: ${AXIS_INFO[PHASE_INFO[game.phase].bestAxis].label})`}
      </div>

      {/* People allocation */}
      <div className="section-label" style={{ marginTop: 12 }}>Razporeditev ({pop} ljudi):</div>
      <NumberInput label="⚔ Borci"      val={combatants} onChange={onCombatants} max={pop} yield_label={`→ +${(combatants * 1.2).toFixed(0)} moč`} />
      <NumberInput label="🌾 Nabiralci"  val={foragers}   onChange={onForagers}   max={pop} yield_label={`→ ${sign(survBalance)} hrana`} />
      <NumberInput label="🔭 Izvidniki"  val={scouts}     onChange={onScouts}     max={pop} yield_label={`→ +${scouts * 8} intel`} />

      <div className={`people-total ${over ? 'over' : ''}`}>
        {over
          ? <span style={{ color: '#ff4444' }}>⚠ Prekoračeno za {-free} ljudi!</span>
          : <span className="dim">Prosti: <b style={{ color: '#e0e0e0' }}>{free}</b> / {pop}</span>
        }
        <span className="dim" style={{ marginLeft: 16 }}>Jedo: −{game.population} hrane/mesec</span>
      </div>
    </div>
  );
}

function OddsPanel({ odds, combatants }: { odds: OddsPreview | null; combatants: number }) {
  if (combatants === 0) {
    return (
      <div className="panel dim small" style={{ padding: '8px 12px' }}>
        Ni spopada to rundo — borci = 0.
      </div>
    );
  }
  if (!odds) return <div className="panel dim small" style={{ padding: '8px 12px' }}>Računam obet…</div>;

  const p = odds.successProbability;
  const outcome = p >= 0.65 ? 'Pričakovan izid: ZMAGA' : p >= 0.45 ? 'Pričakovan izid: DELNA ZMAGA' : p >= 0.2 ? 'Pričakovan izid: PORAZ' : 'Pričakovan izid: POKOL';
  const barColor = p >= 0.65 ? '#44ff88' : p >= 0.45 ? '#ffaa00' : '#ff4444';

  return (
    <div className="panel">
      <h3>BOJNI OBET</h3>
      <div className="odds-bar-wrap">
        <div className="odds-bar">
          <div className="odds-fill" style={{ width: `${p * 100}%`, background: barColor }} />
        </div>
        <span className="odds-pct" style={{ color: barColor }}>{Math.round(p * 100)}%</span>
      </div>
      <div className="odds-details dim small">
        <span>Človeška moč: {odds.humanStrength.toFixed(1)}</span>
        <span>AI moč: {odds.aiStrength.toFixed(1)}</span>
        <span>M_os: ×{odds.mAxisModifier}</span>
      </div>
      <div className="small" style={{ marginTop: 4, color: barColor }}>{outcome}</div>
    </div>
  );
}

function RoundLogPanel({ log }: { log: RoundLog }) {
  const { combat: c } = log;
  return (
    <div className="round-log">
      <h3>ZADNJI MESEC (M{log.round}, {PHASE_INFO[log.phase].label.split('—')[0].trim()})</h3>
      <p className="narrative">{log.narrative}</p>
      <div className="log-grid">
        {c && (
          <div className="log-section">
            <div className="log-title">Spopad</div>
            <div style={{ color: outcomeColor(c.outcome) }}>{outcomeLabel(c.outcome)}</div>
            <div className="dim small">Uspešnost: {Math.round(c.successProbability * 100)}%</div>
            {c.humanLost > 0 && <div className="delta-neg">−{c.humanLost} borcev</div>}
            {c.aiRobotsDestroyed > 0 && <div className="delta-pos">−{c.aiRobotsDestroyed} AI robotov</div>}
            {c.infoGained > 0 && <div className="delta-pos">+{c.infoGained} intel iz spopada</div>}
          </div>
        )}
        <div className="log-section">
          <div className="log-title">Spremembe</div>
          {log.populationDelta !== 0 && <div className={log.populationDelta > 0 ? 'delta-pos' : 'delta-neg'}>{sign(log.populationDelta)} populacija</div>}
          {(log.resourceDelta.survival ?? 0) !== 0 && <div className={((log.resourceDelta.survival ?? 0) > 0) ? 'delta-pos' : 'delta-neg'}>{sign(log.resourceDelta.survival ?? 0)} hrana</div>}
          {(log.resourceDelta.combat ?? 0) !== 0 && <div className={((log.resourceDelta.combat ?? 0) > 0) ? 'delta-pos' : 'delta-neg'}>{sign(log.resourceDelta.combat ?? 0)} orožje</div>}
          {(log.resourceDelta.intelligence ?? 0) !== 0 && <div className="delta-pos">{sign(log.resourceDelta.intelligence ?? 0)} intel</div>}
          {log.aiKnowledgeDelta !== 0 && <div className="delta-neg">AI izve: +{Math.round(log.aiKnowledgeDelta * 100)}%</div>}
        </div>
        {log.revealedNodes.length > 0 && (
          <div className="log-section">
            <div className="log-title">Odkrito</div>
            <div className="delta-pos">{log.revealedNodes.length} novih AI vozlišč!</div>
          </div>
        )}
      </div>
    </div>
  );
}

function GameOverScreen({ game, onNew, loading }: { game: GameState; onNew: () => void; loading: boolean }) {
  const won = game.status === 'victory';
  const exploited = game.aiWeakPoints.filter(wp => wp.exploited).length;
  const revealed  = game.aiTree.filter(n => n.visibility === 'revealed').length;
  return (
    <div className="gameover">
      <h1 style={{ color: won ? '#44ff88' : '#ff4444', fontSize: '2.5rem' }}>
        {won ? '✓ ZMAGA' : '✗ KONEC LINIJE'}
      </h1>
      <p className="dim" style={{ marginTop: 8 }}>
        {game.status === 'defeat_extinction' && 'Populacija je padla na nič. Klan je izumrl.'}
        {game.status === 'defeat_overwhelmed' && 'AI je pridobil popolno sliko o nas. Preveč vemo za preživetje.'}
        {won && 'Klan je uspel ustaviti AI. Človeštvo preživi.'}
      </p>
      <div className="gameover-stats">
        <div><span className="dim">Skupaj rund:</span> {game.totalRounds}/36</div>
        <div><span className="dim">Faza:</span> {PHASE_INFO[game.phase].label}</div>
        <div><span className="dim">Populacija:</span> {game.population}/{game.maxPopulation}</div>
        <div><span className="dim">AI drevo odkrito:</span> {revealed}/{game.aiTree.length}</div>
        <div><span className="dim">Šibke točke uničene:</span> {exploited}/{game.aiWeakPoints.length}</div>
        <div><span className="dim">Seed (za replay):</span> <code>{game.rngSeed}</code></div>
      </div>
      <button className="new-game-btn" onClick={onNew} disabled={loading} style={{ marginTop: 24 }}>
        {loading ? 'Nalagam...' : '↺ Nova linija'}
      </button>
    </div>
  );
}

// ─── Glavna komponenta ────────────────────────────────────────────────────────

export default function App() {
  const [game, setGame]           = useState<GameState | null>(null);
  const [loading, setLoading]     = useState(false);
  const [axis, setAxis]           = useState<HumanAxis>('hiding');
  const [combatants, setCombatants] = useState(0);
  const [foragers, setForagers]   = useState(20);
  const [scouts, setScouts]       = useState(15);
  const [targetWP, setTargetWP]   = useState('');
  const [odds, setOdds]           = useState<OddsPreview | null>(null);

  // Naloži shranjeno igro
  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) {
      getGame(id).then(g => { setGame(g); }).catch(() => localStorage.removeItem(STORAGE_KEY));
    }
  }, []);

  // Live preview obeta (debounced 300ms)
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const t = setTimeout(() => {
      previewOdds(game.runId, { axis, combatants, foragers, scouts })
        .then(setOdds)
        .catch(() => setOdds(null));
    }, 300);
    return () => clearTimeout(t);
  }, [game?.runId, axis, combatants, foragers, scouts]);

  const handleNewGame = async () => {
    setLoading(true);
    try {
      const g = await createGame();
      setGame(g);
      localStorage.setItem(STORAGE_KEY, g.runId);
      // Nastavi smiselne začetne vrednosti za fazo 1
      setAxis('hiding'); setCombatants(0); setForagers(20); setScouts(15); setTargetWP('');
    } finally { setLoading(false); }
  };

  const handlePlayRound = async () => {
    if (!game || loading) return;
    setLoading(true);
    try {
      const { state } = await playRound(game.runId, {
        assignment: { axis, combatants, foragers, scouts },
        targetWeakPoint: targetWP || undefined,
      });
      setGame(state);
      setOdds(null);
    } finally { setLoading(false); }
  };

  const assigned = combatants + foragers + scouts;
  const over = game ? assigned > game.population : false;

  // ── Start ekran ──
  if (!game && !loading) {
    return (
      <div className="start-screen">
        <h1>⚠ AI vs Humanity</h1>
        <p className="dim" style={{ marginTop: 8, maxWidth: 480 }}>
          AI je prevzel Zemljo. Vodiš zadnji človeški klan. Preberaj AI-jev skrivni načrt,
          preden ga izvede — ali izumri.
        </p>
        <div className="start-legend">
          <div>🎯 <b>Faza 1</b> — AI išče preživele. Skrij se.</div>
          <div>🎯 <b>Faza 2</b> — AI analizira vzorce. Špijoniraj.</div>
          <div>🎯 <b>Faza 3</b> — AI udari. Brani se.</div>
          <div style={{ marginTop: 8 }}>Vsaka faza = 12 mesecev. Skupaj 36 mesecev.</div>
        </div>
        <button className="new-game-btn" onClick={handleNewGame}>Začni igro →</button>
      </div>
    );
  }

  if (loading && !game) {
    return <div className="start-screen dim">Nalagam…</div>;
  }

  if (game && game.status !== 'active') {
    return <GameOverScreen game={game} onNew={handleNewGame} loading={loading} />;
  }

  if (!game) return null;

  return (
    <div className="game">
      <PhaseHeader game={game} />
      <ResourceBar game={game} />

      <div className="game-columns">
        {/* Levi stolpec: AI info */}
        <div className="col-left">
          <AITreePanel nodes={game.aiTree} />
          <WeakPointsPanel weakPoints={game.aiWeakPoints} target={targetWP} onTarget={setTargetWP} />
        </div>

        {/* Desni stolpec: Razporejanje + izvedba */}
        <div className="col-right">
          <AssignmentPanel
            game={game}
            axis={axis} onAxis={setAxis}
            combatants={combatants} onCombatants={setCombatants}
            foragers={foragers}     onForagers={setForagers}
            scouts={scouts}         onScouts={setScouts}
          />
          <OddsPanel odds={odds} combatants={combatants} />

          {targetWP && (
            <div className="target-notice">
              🎯 Ciljaš šibko točko: <b>{game.aiWeakPoints.find(w => w.id === targetWP)?.label}</b>
              <button className="clear-target" onClick={() => setTargetWP('')}>✕</button>
            </div>
          )}

          <button
            className="execute-btn"
            onClick={handlePlayRound}
            disabled={loading || over}
          >
            {loading ? '⏳ Izvajam...' : '▶  Izvedi mesec'}
          </button>
          <button className="new-game-btn secondary" onClick={handleNewGame} disabled={loading}>
            ↺ Nova igra
          </button>
        </div>
      </div>

      {game.lastRoundLog && <RoundLogPanel log={game.lastRoundLog} />}
    </div>
  );
}
