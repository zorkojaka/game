import { useState, useEffect } from 'react';
import type { GameState, HumanAxis, OddsPreview, AITreeNode, AIWeakPoint, RoundLog, CombatResult } from './types';
import { createGame, getGame, playRound, previewOdds } from './api';

// ─── Konstante ───────────────────────────────────────────────────────────────

const PHASE = {
  find:       { num: 1, label: 'AI IŠČE',      full: 'FAZA 1 — AI IŠČE',      color: '#e06c30', bestAxis: 'hiding'    as HumanAxis },
  understand: { num: 2, label: 'AI RAZUME',    full: 'FAZA 2 — AI RAZUME',    color: '#cc3333', bestAxis: 'espionage' as HumanAxis },
  eliminate:  { num: 3, label: 'AI IZTREBLJA', full: 'FAZA 3 — AI IZTREBLJA', color: '#991111', bestAxis: 'defense'  as HumanAxis },
};

const AXIS: Record<HumanAxis, { label: string; icon: string; desc: string }> = {
  hiding:    { label: 'Skrivanje',  icon: '👁‍🗨', desc: 'Zmanjšuje AI nadzor' },
  espionage: { label: 'Špijonaža', icon: '🕵',  desc: 'Odkriva AI načrte' },
  defense:   { label: 'Obramba',   icon: '🛡',   desc: 'Zmanjšuje bojne izgube' },
};

const M_OS: Record<string, Record<HumanAxis, number>> = {
  find:       { hiding: 1.4, espionage: 1.0, defense: 0.5 },
  understand: { hiding: 0.8, espionage: 1.5, defense: 0.7 },
  eliminate:  { hiding: 0.5, espionage: 0.9, defense: 1.4 },
};

const STORAGE_KEY = 'avh-runId';

// ─── Pomožne funkcije ─────────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(n * 100)}%`;
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function barColor(ratio: number) {
  if (ratio <= 0.2) return '#cc2222';
  if (ratio <= 0.4) return '#cc7700';
  return '#22884d';
}
function outcomeColor(o: CombatResult['outcome']) {
  return { victory: '#22cc66', partial: '#ffaa00', defeat: '#ee4444', annihilation: '#991111' }[o];
}
function outcomeLabel(o: CombatResult['outcome']) {
  return { victory: '✓ ZMAGA', partial: '〜 DELNA ZMAGA', defeat: '✗ PORAZ', annihilation: '☠ POKOL' }[o];
}

// ─── Sub-komponente ───────────────────────────────────────────────────────────

/** Tanka barvna progresivna vrstica */
function Bar({ ratio, color, height = 6 }: { ratio: number; color?: string; height?: number }) {
  const c = color ?? barColor(ratio);
  return (
    <div className="bar-track" style={{ height }}>
      <div className="bar-fill" style={{ width: `${Math.min(100, ratio * 100)}%`, background: c }} />
    </div>
  );
}

/** En resurs: ikona + oznaka + vrstica + vrednost */
function ResStat({ icon, label, value, max, color }: { icon: string; label: string; value: number; max: number; color?: string }) {
  const ratio = max > 0 ? value / max : 0;
  const c = color ?? barColor(ratio);
  return (
    <div className="res-stat">
      <div className="res-head">
        <span className="res-icon">{icon}</span>
        <span className="res-label">{label}</span>
        <span className="res-value" style={{ color: c }}>{value}</span>
      </div>
      <Bar ratio={ratio} color={c} />
    </div>
  );
}

/** Faza header: badge, oznaka, pike za mesece */
function PhaseHeader({ game }: { game: GameState }) {
  const p = PHASE[game.phase];
  return (
    <header className="phase-header">
      <div className="ph-badge" style={{ borderColor: p.color, color: p.color }}>{p.num}</div>
      <div className="ph-body">
        <div className="ph-label" style={{ color: p.color }}>{p.full}</div>
        <div className="ph-rounds">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={`round-dot ${i < game.round - 1 ? 'done' : i === game.round - 1 ? 'current' : ''}`}
              style={i === game.round - 1 ? { borderColor: p.color, background: p.color } : {}}
            />
          ))}
          <span className="ph-total dim">·  {game.totalRounds}/36</span>
        </div>
      </div>
      <div className="ph-ai-know">
        <div className="pak-label dim">AI ve o nas</div>
        <div className="pak-value" style={{ color: game.aiKnowledge > 0.6 ? '#cc2222' : '#888' }}>
          {pct(game.aiKnowledge)}
        </div>
        <Bar ratio={game.aiKnowledge} color={game.aiKnowledge > 0.6 ? '#cc2222' : '#444'} height={4} />
      </div>
    </header>
  );
}

/** Resursna vrstica — dve skupini: človeški / AI */
function ResourceRow({ game }: { game: GameState }) {
  const r = game.resources;
  const popMax = game.maxPopulation;
  const survMax = Math.max(r.survival, game.population * 8);
  const combMax = Math.max(r.combat, 100);
  const intelMax = Math.max(r.intelligence, 200);
  const robotMax = 200;
  return (
    <div className="resource-row">
      <div className="res-group">
        <ResStat icon="👥" label="Populacija"  value={game.population} max={popMax} />
        <ResStat icon="🍞" label="Hrana/Voda"  value={r.survival}      max={survMax} />
        <ResStat icon="⚔"  label="Orožje"      value={r.combat}        max={combMax} />
        <ResStat icon="👁"  label="Intel"       value={r.intelligence}  max={intelMax} color="#5588ff" />
      </div>
      <div className="res-divider" />
      <div className="res-group enemy">
        <ResStat icon="🤖" label="AI roboti"    value={game.aiRobots}          max={robotMax} color="#bb3333" />
        <ResStat icon="🌍" label="Klani aktiv"  value={Math.round(game.clanActivity * 100)} max={100} />
      </div>
    </div>
  );
}

/** Kartica posameznega AI vozlišča */
function NodeCard({ node, flash }: { node: AITreeNode; flash?: boolean }) {
  if (node.visibility === 'unknown') {
    return (
      <div className="node-card unknown">
        <div className="nc-noise" />
        <div className="nc-content">
          <span className="nc-fog-text">░ ??? ░</span>
        </div>
      </div>
    );
  }
  if (node.visibility === 'partial') {
    // Pokaži le prvo besedo + "…" in ocenjen razpon moči
    const firstWord = node.label.split(' ')[0];
    const lo = Math.max(1,  Math.floor(node.strength * 0.7));
    const hi = Math.ceil(node.strength * 1.35);
    return (
      <div className="node-card partial">
        <div className="nc-content">
          <span className="nc-label-partial">{firstWord}…</span>
          <div className="nc-partial-row">
            <span className="nc-badge-partial">DELNO</span>
            <span className="nc-str-range">~{lo}–{hi}</span>
          </div>
        </div>
      </div>
    );
  }
  // revealed
  return (
    <div className={`node-card revealed ${node.executed ? 'executed' : ''} ${flash ? 'just-revealed' : ''}`}
         style={{ borderColor: node.executed ? '#cc2222' : PHASE[node.phase].color }}>
      <div className="nc-content">
        <span className="nc-label">{node.label}</span>
        <div className="nc-str-row">
          <Bar ratio={node.strength / 100} color={node.executed ? '#cc2222' : PHASE[node.phase].color} height={3} />
          <span className="nc-str-num">{node.strength}</span>
        </div>
        {node.executed && <span className="nc-exec-tag">IZVEDEN</span>}
      </div>
    </div>
  );
}

/** AI drevo — vse faze */
function AITree({ nodes }: { nodes: AITreeNode[] }) {
  const phases: Array<keyof typeof PHASE> = ['find', 'understand', 'eliminate'];
  const revealed = nodes.filter(n => n.visibility === 'revealed').length;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>AI NAČRTOVALNO DREVO</h3>
        <span className="panel-badge">{revealed}/{nodes.length}</span>
      </div>
      {phases.map(ph => (
        <div key={ph} className="tree-section">
          <div className="tree-ph-label" style={{ color: PHASE[ph].color }}>
            ▸ {PHASE[ph].full}
          </div>
          <div className="node-grid">
            {nodes.filter(n => n.phase === ph).map(n => <NodeCard key={n.id} node={n} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Šibke točke */
function WeakPoints({ wps, target, onTarget }: { wps: AIWeakPoint[]; target: string; onTarget: (id: string) => void }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ŠIBKE TOČKE AI</h3>
        <span className="panel-badge">{wps.filter(w => w.exploited).length}/{wps.length} uničenih</span>
      </div>
      {wps.map(wp => (
        <div key={wp.id} className={`wp-card ${wp.exploited ? 'exploited' : wp.discovered ? 'discovered' : 'hidden'}`}>
          <div className="wp-icon">{wp.exploited ? '✓' : wp.discovered ? '◆' : '?'}</div>
          <div className="wp-body">
            <div className="wp-name">{wp.discovered ? wp.label : `[ZAKRITO — ${PHASE[wp.phase].label}]`}</div>
            {wp.discovered && !wp.exploited && (
              <div className="dim small">{PHASE[wp.phase].full}</div>
            )}
          </div>
          {wp.discovered && !wp.exploited && (
            <button className={`wp-btn ${target === wp.id ? 'active' : ''}`}
                    onClick={() => onTarget(target === wp.id ? '' : wp.id)}>
              {target === wp.id ? '🎯 CILJ' : 'Ciljaj'}
            </button>
          )}
          {wp.exploited && <span className="wp-done-tag">UNIČENO</span>}
        </div>
      ))}
    </div>
  );
}

/** Vizualna razporeditev populacije */
function PeopleBar({ pop, combatants, foragers, scouts }: { pop: number; combatants: number; foragers: number; scouts: number }) {
  const free = Math.max(0, pop - combatants - foragers - scouts);
  const over = pop - combatants - foragers - scouts < 0;
  if (pop === 0) return null;
  return (
    <div className="people-bar-wrap">
      <div className={`people-bar ${over ? 'over' : ''}`}>
        {combatants > 0 && <div className="pb-seg combat" style={{ flex: combatants }} title={`Borci: ${combatants}`} />}
        {foragers   > 0 && <div className="pb-seg forage" style={{ flex: foragers }}   title={`Nabiralci: ${foragers}`} />}
        {scouts     > 0 && <div className="pb-seg scout"  style={{ flex: scouts }}     title={`Izvidniki: ${scouts}`} />}
        {free       > 0 && <div className="pb-seg free"   style={{ flex: free }}       title={`Prosti: ${free}`} />}
      </div>
      <div className="pb-legend">
        <span className="pbl combat">⚔ {combatants}</span>
        <span className="pbl forage">🌾 {foragers}</span>
        <span className="pbl scout">🔭 {scouts}</span>
        <span className={`pbl free ${over ? 'danger' : ''}`}>{over ? `⚠ +${-free}` : `prosti ${free}`}</span>
      </div>
    </div>
  );
}

/** En slider za razporejanje */
function SliderRow({ icon, label, val, onChange, max, yieldText }: {
  icon: string; label: string; val: number; onChange: (n: number) => void;
  max: number; yieldText: string;
}) {
  const pctFill = max > 0 ? (val / max * 100).toFixed(1) : '0';
  return (
    <div className="slider-row">
      <div className="sr-head">
        <span>{icon} {label}</span>
        <span className="sr-val">{val}</span>
        <span className="sr-yield dim">{yieldText}</span>
      </div>
      <input
        type="range" min={0} max={max} value={val} step={1}
        onChange={e => onChange(+e.target.value)}
        style={{ '--pct': `${pctFill}%` } as React.CSSProperties}
      />
    </div>
  );
}

/** Os: 3 gumbi z M_os */
function AxisSelector({ phase, selected, onSelect }: { phase: keyof typeof PHASE; selected: HumanAxis; onSelect: (a: HumanAxis) => void }) {
  const bestAxis = PHASE[phase].bestAxis;
  return (
    <div className="axis-group">
      {(Object.keys(AXIS) as HumanAxis[]).map(a => {
        const m = M_OS[phase][a];
        const isRight = bestAxis === a;
        const mColor = isRight ? '#22cc66' : m < 0.8 ? '#cc3333' : '#cc8800';
        return (
          <button key={a} className={`axis-btn ${selected === a ? 'sel' : ''} ${isRight ? 'right' : ''}`} onClick={() => onSelect(a)}>
            <span className="ab-icon">{AXIS[a].icon}</span>
            <span className="ab-label">{AXIS[a].label}</span>
            <span className="ab-mos" style={{ color: mColor }}>×{m}</span>
            {isRight && <span className="ab-right-tag">IDEALNA</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Odds: visuals */
function OddsDisplay({ odds, combatants }: { odds: OddsPreview | null; combatants: number }) {
  if (combatants === 0) {
    return (
      <div className="odds-panel no-combat">
        <span className="dim">Brez spopada — nastavi borce za bojni obet</span>
      </div>
    );
  }
  if (!odds) return <div className="odds-panel no-combat dim">Računam obet…</div>;

  const p = odds.successProbability;
  const c = p >= 0.65 ? '#22cc66' : p >= 0.45 ? '#ffaa00' : '#cc3333';
  const label = p >= 0.65 ? 'ZMAGA VERJETNA' : p >= 0.45 ? 'NEGOTOV IZID' : p >= 0.2 ? 'PORAZ VERJETEN' : 'KATASTROFA';

  return (
    <div className="odds-panel">
      <div className="odds-body">
        <div className="odds-gauge">
          <OddsArc p={p} color={c} />
        </div>
        <div className="odds-details">
          <div className="odds-label" style={{ color: c }}>{label}</div>
          <div className="odds-row dim small"><span>Naši:</span><span style={{ color: '#e0e0e0' }}>{odds.humanStrength.toFixed(1)}</span></div>
          <div className="odds-row dim small"><span>AI:</span><span style={{ color: '#cc3333' }}>{odds.aiStrength.toFixed(1)}</span></div>
          <div className="odds-row dim small"><span>M_os:</span><span style={{ color: '#888' }}>×{odds.mAxisModifier}</span></div>
        </div>
      </div>
      {/* Dual bar: nasi vs AI */}
      <div className="odds-vs-bar">
        <div className="ovb-human" style={{ flex: odds.humanStrength, background: c }} />
        <div className="ovb-ai"    style={{ flex: odds.aiStrength, background: '#441111' }} />
      </div>
      <div className="odds-vs-labels small dim">
        <span>ČLOVEŠKA MOČ</span><span>AI MOČ</span>
      </div>
    </div>
  );
}

/** SVG polkrožni gauge za odds */
function OddsArc({ p, color }: { p: number; color: string }) {
  const r = 40;
  const circ = Math.PI * r; // ~125.7
  const filled = p * circ;
  return (
    <svg viewBox="0 0 100 56" className="odds-svg">
      {/* BG arc */}
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#1e1e1e" strokeWidth="10" strokeLinecap="butt"/>
      {/* Fill arc */}
      <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${filled} ${circ}`} strokeLinecap="butt"/>
      {/* Pct text */}
      <text x="50" y="46" textAnchor="middle" fill={color}
            fontSize="17" fontFamily="'Courier New', monospace" fontWeight="bold">
        {Math.round(p * 100)}%
      </text>
    </svg>
  );
}

/** Log zadnjega meseca */
function RoundLog({ log }: { log: RoundLog }) {
  const c = log.combat;
  return (
    <div className="round-log">
      <div className="rl-head">
        <h3>MESEC {log.round} · {PHASE[log.phase].full}</h3>
      </div>
      <p className="rl-narrative">{log.narrative}</p>
      <div className="rl-cols">
        {c && (
          <div className="rl-section">
            <div className="rl-sec-title">Spopad</div>
            <div className="rl-outcome" style={{ color: outcomeColor(c.outcome) }}>
              {outcomeLabel(c.outcome)}
            </div>
            <div className="rl-odds dim small">{Math.round(c.successProbability * 100)}% uspešnost</div>
            {c.humanLost > 0       && <div className="rl-neg">− {c.humanLost} borcev</div>}
            {c.aiRobotsDestroyed>0  && <div className="rl-pos">− {c.aiRobotsDestroyed} AI robotov</div>}
            {c.infoGained > 0      && <div className="rl-pos">+ {c.infoGained} intel</div>}
          </div>
        )}
        <div className="rl-section">
          <div className="rl-sec-title">Resursi</div>
          {log.populationDelta !== 0 && <div className={log.populationDelta > 0 ? 'rl-pos' : 'rl-neg'}>{sign(log.populationDelta)} populacija</div>}
          {(log.resourceDelta.survival    ?? 0) !== 0 && <div className={(log.resourceDelta.survival    ?? 0) > 0 ? 'rl-pos' : 'rl-neg'}>{sign(log.resourceDelta.survival    ?? 0)} hrana</div>}
          {(log.resourceDelta.combat      ?? 0) !== 0 && <div className={(log.resourceDelta.combat      ?? 0) > 0 ? 'rl-pos' : 'rl-neg'}>{sign(log.resourceDelta.combat      ?? 0)} orožje</div>}
          {(log.resourceDelta.intelligence?? 0) !== 0 && <div className="rl-pos">{sign(log.resourceDelta.intelligence ?? 0)} intel</div>}
        </div>
        {(log.revealedNodes.length > 0 || log.aiKnowledgeDelta !== 0) && (
          <div className="rl-section">
            <div className="rl-sec-title">Intel</div>
            {log.revealedNodes.length > 0 && <div className="rl-pos">+ {log.revealedNodes.length} AI vozlišč odkritih</div>}
            {log.aiKnowledgeDelta !== 0 && <div className="rl-neg">AI izve: +{Math.round(log.aiKnowledgeDelta * 100)}%</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Start screen */
function StartScreen({ onNew, loading }: { onNew: () => void; loading: boolean }) {
  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-logo">
          <span className="start-ai">AI</span>
          <span className="start-vs">vs</span>
          <span className="start-h">HUMANITY</span>
        </div>
        <p className="start-sub">AI je prevzel Zemljo. Ti vodiš zadnji klan. Preberi AI-jev skrivni načrt — ali izumri.</p>
        <div className="start-phases">
          {[
            { num: '01', title: 'AI IŠČE', desc: 'Droni, sateliti, senzorji. Skrij se.', color: '#e06c30' },
            { num: '02', title: 'AI RAZUME', desc: 'Analiza vzorcev, predikcija. Špijoniraj.', color: '#cc3333' },
            { num: '03', title: 'AI IZTREBLJA', desc: 'Udar na preživetvene stebre. Brani se.', color: '#991111' },
          ].map(ph => (
            <div key={ph.num} className="start-phase" style={{ borderColor: ph.color }}>
              <span className="sp-num" style={{ color: ph.color }}>{ph.num}</span>
              <span className="sp-title" style={{ color: ph.color }}>{ph.title}</span>
              <span className="sp-desc dim">{ph.desc}</span>
            </div>
          ))}
        </div>
        <div className="start-legend dim small">
          12 mesecev na fazo · 36 skupaj · Vsaka odločitev šteje · Izumrli ne vstanejo
        </div>
        <button className="start-btn" onClick={onNew} disabled={loading}>
          {loading ? '⟳ Nalagam…' : '▶  ZAČNI IGRO'}
        </button>
      </div>
    </div>
  );
}

/** Game over screen */
function GameOverScreen({ game, onNew, loading }: { game: GameState; onNew: () => void; loading: boolean }) {
  const won = game.status === 'victory';
  const exploited = game.aiWeakPoints.filter(w => w.exploited).length;
  const revealed  = game.aiTree.filter(n => n.visibility === 'revealed').length;
  const c = won ? '#22cc66' : '#cc3333';
  return (
    <div className="gameover">
      <div className="go-header" style={{ borderColor: c }}>
        <div className="go-status" style={{ color: c }}>
          {won ? '✓ ZMAGA' : '✗ LINIJA ZAKLJUČENA'}
        </div>
        <p className="go-reason dim">
          {game.status === 'defeat_extinction'   && 'Populacija je padla na nič. Klan je izumrl.'}
          {game.status === 'defeat_overwhelmed'  && 'AI je pridobil popolno sliko o klanu.'}
          {won && 'Klan je ustavil AI. Človeštvo preživi.'}
        </p>
      </div>
      <div className="go-stats">
        {[
          ['Trajanje',         `${game.totalRounds} / 36 rund`],
          ['Zadnja faza',      PHASE[game.phase].full],
          ['Preživeli',        `${game.population} / ${game.maxPopulation}`],
          ['AI načrt odkrit',  `${revealed} / ${game.aiTree.length} vozlišč`],
          ['Šibke točke',      `${exploited} / ${game.aiWeakPoints.length} uničenih`],
          ['Replay seed',      `${game.rngSeed}`],
        ].map(([k, v]) => (
          <div key={k} className="go-stat">
            <span className="go-k dim">{k}</span>
            <span className="go-v">{v}</span>
          </div>
        ))}
      </div>
      <button className="start-btn go-btn" onClick={onNew} disabled={loading}>
        {loading ? '⟳' : '↺  NOVA LINIJA'}
      </button>
    </div>
  );
}

// ─── Glavna komponenta ────────────────────────────────────────────────────────

export default function App() {
  const [game,       setGame]       = useState<GameState | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [axis,       setAxis]       = useState<HumanAxis>('hiding');
  const [combatants, setCombatants] = useState(0);
  const [foragers,   setForagers]   = useState(20);
  const [scouts,     setScouts]     = useState(15);
  const [targetWP,   setTargetWP]   = useState('');
  const [odds,       setOdds]       = useState<OddsPreview | null>(null);

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) getGame(id).then(setGame).catch(() => localStorage.removeItem(STORAGE_KEY));
  }, []);

  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const t = setTimeout(() => {
      previewOdds(game.runId, { axis, combatants, foragers, scouts }).then(setOdds).catch(() => setOdds(null));
    }, 250);
    return () => clearTimeout(t);
  }, [game?.runId, axis, combatants, foragers, scouts]);

  const handleNew = async () => {
    setLoading(true);
    try {
      const g = await createGame();
      setGame(g);
      localStorage.setItem(STORAGE_KEY, g.runId);
      setAxis('hiding'); setCombatants(0); setForagers(20); setScouts(15); setTargetWP('');
    } finally { setLoading(false); }
  };

  const handleRound = async () => {
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

  const pop      = game?.population ?? 0;
  const assigned = combatants + foragers + scouts;
  const over     = assigned > pop;

  if (!game && !loading) return <StartScreen onNew={handleNew} loading={false} />;
  if (!game && loading)  return <StartScreen onNew={handleNew} loading={true}  />;
  if (!game) return null;
  if (game.status !== 'active') return <GameOverScreen game={game} onNew={handleNew} loading={loading} />;

  const survBalance = foragers * 4 - game.population;

  return (
    <div className="hud">
      <PhaseHeader game={game} />
      <ResourceRow game={game} />

      <div className="hud-cols">
        {/* ── Levo: AI intel ── */}
        <div className="hud-left">
          <AITree nodes={game.aiTree} />
          <WeakPoints wps={game.aiWeakPoints} target={targetWP} onTarget={setTargetWP} />
        </div>

        {/* ── Desno: Ukazi ── */}
        <div className="hud-right">
          <div className="panel command-panel">
            <h3>RAZPOREDI ENOTE</h3>

            <div className="cmd-section">
              <div className="cmd-label">Strategijska os tega meseca</div>
              <AxisSelector phase={game.phase} selected={axis} onSelect={setAxis} />
              <div className="dim small" style={{ marginTop: 6 }}>
                {AXIS[axis].desc}
                {PHASE[game.phase].bestAxis !== axis &&
                  <span style={{ color: '#cc8800' }}> · Idealna os: {AXIS[PHASE[game.phase].bestAxis].label}</span>}
              </div>
            </div>

            <div className="cmd-section">
              <div className="cmd-label">Razporedi {pop} ljudi</div>
              <SliderRow icon="⚔" label="Borci"      val={combatants} onChange={setCombatants} max={pop} yieldText={`→ +${(combatants * 1.2).toFixed(0)} moč`} />
              <SliderRow icon="🌾" label="Nabiralci"  val={foragers}   onChange={setForagers}   max={pop} yieldText={`→ ${survBalance >= 0 ? '+' : ''}${survBalance} hrana`} />
              <SliderRow icon="🔭" label="Izvidniki"  val={scouts}     onChange={setScouts}     max={pop} yieldText={`→ +${scouts * 8} intel`} />
              <PeopleBar pop={pop} combatants={combatants} foragers={foragers} scouts={scouts} />
            </div>

            {targetWP && (
              <div className="target-chip">
                🎯 Ciljaš: <b>{game.aiWeakPoints.find(w => w.id === targetWP)?.label}</b>
                <button className="tc-clear" onClick={() => setTargetWP('')}>✕</button>
              </div>
            )}
          </div>

          <OddsDisplay odds={odds} combatants={combatants} />

          <button className="exec-btn" onClick={handleRound} disabled={loading || over}>
            {loading ? '⟳  Izvajam…' : over ? '⚠  Preveč ljudi razporejenih' : '▶  IZVEDI MESEC'}
          </button>
          <button className="newgame-btn" onClick={handleNew} disabled={loading}>↺ Nova igra</button>
        </div>
      </div>

      {game.lastRoundLog && <RoundLog log={game.lastRoundLog} />}
    </div>
  );
}
