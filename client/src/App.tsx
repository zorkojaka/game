import { useState, useEffect, useRef, Fragment } from 'react';
import type { GameState, HumanAxis, OddsPreview, AITreeNode, AIWeakPoint, RoundLog, CombatResult, AIPhase, Mission, HexTile, Expedition, NewExpeditionInput, WorkshopObjective, ResearchObjective, OtherClan } from './types';
import { tileId } from './types';
import { createGame, getGame, playRound, previewOdds, sendFeedback } from './api';
// Deljene konstante iz enginea (en vir resnice — NE podvajaj številk).
import { RATIONS_LEVELS, aiDefensePower, COMBAT_BASE_HUMAN_MULTIPLIER, researchMult } from '../../src/engine/constants';
import { missionSuccessProbability } from '../../src/engine/game';
import { logicalWeaknessBonus } from '../../src/engine/combat';

// ─── Konstante ───────────────────────────────────────────────────────────────

const PHASE = {
  find:       { num: 1, label: 'AI IŠČE',      full: 'FAZA 1 — AI IŠČE',      color: '#e06c30' },
  understand: { num: 2, label: 'AI RAZUME',    full: 'FAZA 2 — AI RAZUME',    color: '#cc3333' },
  eliminate:  { num: 3, label: 'AI IZTREBLJA', full: 'FAZA 3 — AI IZTREBLJA', color: '#991111' },
};

const AXIS: Record<HumanAxis, { label: string; icon: string; desc: string }> = {
  obzidje: { label: 'Obzidje', icon: '🧱', desc: 'Fokus na obzidje' },
  orozje:  { label: 'Orožje',  icon: '⚔️', desc: 'Fokus na orožje' },
  roboti:  { label: 'Roboti',  icon: '🤖', desc: 'Fokus na robote' },
};

// M_OS pride iz enginea (zgoraj uvožen). Podvajanje odpravljeno.

// Numerični del obrokov pride iz enginea (RATIONS_LEVELS); tu dodamo le UI predstavitev (color)
// in po želji prepišemo emoji. Številke (foodMult/popMin/popMax/strengthMult) so single-source.
type RationsRow = { foodMult: number; popMin: number; popMax: number; strengthMult: number; label: string; emoji: string; color: string };
const RATIONS_UI: Record<number, { emoji: string; color: string }> = {
  1: { emoji: '💀', color: '#cc2222' },
  2: { emoji: '🥄', color: '#cc7700' },
  3: { emoji: '🍞', color: '#888888' },
  4: { emoji: '🥗', color: '#66aa44' },
  5: { emoji: '🥩', color: '#22cc88' },
};
const RATIONS: Record<number, RationsRow> = Object.fromEntries(
  Object.entries(RATIONS_LEVELS).map(([k, v]) => [Number(k), {
    foodMult: v.foodMult, popMin: v.popMin, popMax: v.popMax, strengthMult: v.strengthMult,
    label: v.label, emoji: RATIONS_UI[Number(k)].emoji, color: RATIONS_UI[Number(k)].color,
  }])
);

const STORAGE_KEY = 'avh-runId';

// ─── Pomožne funkcije ─────────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(n * 100)}%`;
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Koliko vemo o AI drevesu [0–1]: partial=0.5, revealed=1 */
function calcOurKnowledge(nodes: AITreeNode[]): number {
  if (nodes.length === 0) return 0;
  const pts = nodes.reduce((s, n) =>
    s + (n.visibility === 'revealed' ? 1 : n.visibility === 'partial' ? 0.5 : 0), 0);
  return pts / nodes.length;
}

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

/** Velika grafična kartica za en resurs: ikona + oznaka + številka (brez bar-a) */
function BigStat({ icon, label, value, color, unit, note, noteColor, title }: { icon: string; label: string; value: number | string; color: string; unit?: string; note?: string; noteColor?: string; title?: string }) {
  return (
    <div className="big-stat" style={{ borderColor: color }} title={title}>
      <div className="bs-icon" style={{ color }}>{icon}</div>
      <div className="bs-body">
        <div className="bs-label dim small">{label}</div>
        <div className="bs-val" style={{ color }}>
          {value}{unit && <span className="bs-unit">{unit}</span>}
          {note && <span className="bs-note" style={{ color: noteColor ?? 'var(--dim)' }}> {note}</span>}
        </div>
      </div>
    </div>
  );
}

/** Krožni merilnik (odstotek) — SVG obroč. */
function Gauge({ pct, color }: { pct: number; color: string }) {
  const r = 28, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const off = c * (1 - p / 100);
  return (
    <div className="gauge">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1e2730" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 36 36)" />
      </svg>
      <div className="gauge-val" style={{ color }}>{pct}%</div>
    </div>
  );
}

/** Navodila „Kako deluje" za posamezne panele. */
const HELP: Record<string, { title: string; rows: [string, string][] }> = {
  defense: { title: 'Kako deluje — Obramba', rows: [
    ['👥', 'Več branilcev poveča verjetnost, da odbijemo napad AI.'],
    ['🏰', 'Obzidje daje +20 % k obrambi na zgrajeno stopnjo, raziskava obzidja ta učinek podvoji po levelih.'],
    ['◆', 'Razkrite logične šibkosti zmanjšajo moč ustreznih AI napadov.'],
  ] },
  food: { title: 'Kako deluje — Prehrana', rows: [
    ['🌾', 'Nabiralci zbirajo hrano vsak mesec.'],
    ['🍽', 'Višji obroki dajo več moči, a porabijo več hrane.'],
    ['⚠', 'Če zaloga pade na 0, klan strada in izgublja ljudi.'],
  ] },
  workshop: { title: 'Kako deluje — Delavnice', rows: [
    ['⚔', 'Orožje: 6 delavec-mes. + 1 material.'],
    ['🏰', 'Obzidje: 12 delavec-mes. + 4 materiala (+20 % obrambe).'],
    ['💎', 'Artefakt: 360 delavec-mes. + 20 materiala. Napredek se ohrani ob preklopu.'],
  ] },
  research: { title: 'Kako deluje — Raziskave', rows: [
    ['🤖', 'Roboti: raziskovalci ustvarjajo intel in odpirajo AI drevo.'],
    ['⚙', 'Mehanske šibkosti odklenejo nove stopnje orožja in obrambe.'],
    ['◆', 'Logične šibkosti takoj dodajo pasivne bonuse v boju/obrambi.'],
  ] },
  scout: { title: 'Kako deluje — Izvidniki', rows: [
    ['🔭', 'Izvidniki raziskujejo hekse in odkrivajo šibke točke ter klane.'],
    ['↩', 'Po cilju se vrnejo domov; krožna pot ob kampu = kratek povratek.'],
    ['🌙', 'Skrivanje zniža srečanja, a podaljša pot.'],
  ] },
  attack: { title: 'Kako deluje — Napad', rows: [
    ['⚔', 'Napadalci udarijo po prihodu na cilj; orožje in razkrite logične šibkosti večajo moč.'],
    ['◆', 'Razkrite šibke točke je lažje uničiti.'],
    ['↩', 'Preživeli se vrnejo v kamp (čas povratka glede na pot).'],
  ] },
  allies: { title: 'Kako deluje — Zavezniki', rows: [
    ['🔭', 'Razišči heks klana, da ga najdeš v megli.'],
    ['🤝', 'Pošlji odpravo do njega za zavezništvo — nato mesečno pomaga.'],
  ] },
};

/** Info gumb (ℹ) v glavi panela — odpre popup z navodili. */
function InfoButton({ kind }: { kind: keyof typeof HELP }) {
  const [open, setOpen] = useState(false);
  const h = HELP[kind];
  return (
    <>
      <button className="info-btn" title="Kako deluje" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>ℹ</button>
      {open && (
        <div className="info-overlay" onClick={() => setOpen(false)}>
          <div className="info-box" onClick={e => e.stopPropagation()}>
            <button className="info-close" onClick={() => setOpen(false)}>✕</button>
            <div className="info-title">{h.title}</div>
            <div className="info-body">
              {h.rows.map(([ic, txt], i) => (
                <div key={i} className="def-how-row"><span className="def-how-ic">{ic}</span><span>{txt}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Stari ResStat ostal samo za morebitne legacy klice — preusmerjen na BigStat brez bar-a. */
function ResStat({ icon, label, value, color }: { icon: string; label: string; value: number; max?: number; color?: string }) {
  return <BigStat icon={icon} label={label} value={value} color={color ?? '#88aacc'} />;
}

/** Dvojni meter znanja — naše vs AI */
function DualKnowledge({ ourK, aiK }: { ourK: number; aiK: number }) {
  const ourColor = ourK >= 0.6 ? '#22cc88' : ourK >= 0.3 ? '#3377cc' : '#2a4a6a';
  const aiColor  = aiK  >= 0.7 ? '#cc2222' : aiK  >= 0.4 ? '#cc7700' : '#553333';
  return (
    <div className="dual-knowledge">
      {/* Naše znanje o AI */}
      <div className="dk-meter">
        <div className="dk-label" style={{ color: ourColor }}>🔭 LJUDJE VEMO</div>
        <div className="dk-val"   style={{ color: ourColor }}>{pct(ourK)}</div>
        <div className="dk-bar-track">
          <div className="dk-bar-fill" style={{ width: `${Math.round(ourK * 100)}%`, background: ourColor }} />
        </div>
      </div>
      <div className="dk-divider">VS</div>
      {/* AI znanje o nas */}
      <div className="dk-meter dk-meter-right">
        <div className="dk-label" style={{ color: aiColor }}>👁 AI VE</div>
        <div className="dk-val"   style={{ color: aiColor }}>{pct(aiK)}</div>
        <div className="dk-bar-track">
          <div className="dk-bar-fill dk-bar-right" style={{ width: `${Math.round(aiK * 100)}%`, background: aiColor }} />
        </div>
        {aiK >= 0.8 && <div className="dk-danger-blink">⚠ KRITIČNO</div>}
      </div>
    </div>
  );
}

/** Faza header: vse 3 faze v vrsti levo→desno + Nova igra desno */
function PhaseHeader({ game }: { game: GameState }) {
  const phases: Array<keyof typeof PHASE> = ['find', 'understand', 'eliminate'];
  const phaseOrder: Record<string, number> = { find: 0, understand: 1, eliminate: 2 };
  const currentIdx = phaseOrder[game.phase];
  return (
    <header className="phase-header phases-row">
      {phases.map((ph, idx) => {
        const p = PHASE[ph];
        const isCurrent = idx === currentIdx;
        const isPast    = idx < currentIdx;
        const isFuture  = idx > currentIdx;
        const roundsDone = isPast ? 12 : isCurrent ? game.round - 1 : 0;
        const stateLabel = isPast ? 'zaključena' : isCurrent ? `${game.round}/12` : 'čaka';
        return (
          <div key={ph} className={`ph-block ${isCurrent ? 'current' : isPast ? 'past' : 'future'}`}
               style={{ borderColor: isCurrent ? p.color : '#1e1e1e' }}>
            <div className="ph-block-head">
              <div className="ph-badge" style={{
                borderColor: p.color, color: p.color,
                opacity: isFuture ? 0.35 : isPast ? 0.6 : 1,
              }}>{p.num}</div>
              <div className="ph-block-info">
                <div className="ph-label" style={{
                  color: isCurrent ? p.color : isPast ? '#7a7a7a' : '#4a4a4a',
                }}>{p.full}</div>
                <div className="ph-rounds">
                  {Array.from({ length: 12 }, (_, i) => (
                    <span
                      key={i}
                      className={`round-dot ${i < roundsDone ? 'done' : i === roundsDone && isCurrent ? 'current' : ''}`}
                      style={i === roundsDone && isCurrent ? { borderColor: p.color, background: p.color } : {}}
                    />
                  ))}
                  <span className="ph-state dim small">{stateLabel}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="ph-total-cell dim small">M {game.totalRounds}/36</div>
    </header>
  );
}

/** Resursna vrstica — sovražne info | trend premoči | dvojni meter znanja */
function ResourceRow({ game, eventLog }: { game: GameState; eventLog: EventEntry[] }) {
  const ourK = calcOurKnowledge(game.aiTree);
  return (
    <div className="resource-row">
      <div className="res-group enemy">
        <BigStat icon="🤖" label="AI roboti"    value={game.aiRobots}                      color="#cc3333" />
        <BigStat icon="🌍" label="Klani aktiv"  value={Math.round(game.clanActivity * 100)} color="#88aa66" unit="%" />
      </div>
      <div className="res-divider" />
      <CompactBalanceTrend entries={eventLog} />
      <div className="res-divider" />
      <DualKnowledge ourK={ourK} aiK={game.aiKnowledge} />
    </div>
  );
}

/** Klan status — populacija s prikazom kamp/odprave, hrana, orožje, intel */
function ClanStatus({ game, inMissions, food }: {
  game: GameState; inMissions: number;
  food: { consumption: number; production: number; packs: number; foodMult: number; nextMonth: number };
}) {
  const r = game.resources;
  const inCamp = Math.max(0, game.population - inMissions);
  return (
    <div className="clan-status">
      {/* Populacija — prevladujoča vrstica s split bar */}
      <div className="cs-pop">
        <div className="cs-pop-head">
          <span className="cs-pop-title">👥 POPULACIJA</span>
          <span className="cs-pop-big">{game.population}</span>
        </div>
        <div className="cs-pop-split">
          {inCamp > 0 && (
            <div className="cs-pop-camp" style={{ flex: inCamp }} title={`V kampu: ${inCamp}`}>
              <span className="cs-pop-icon">🏠</span>
              <span className="cs-pop-val">{inCamp}</span>
              <span className="cs-pop-label dim small">v kampu</span>
            </div>
          )}
          {inMissions > 0 && (
            <div className="cs-pop-out" style={{ flex: inMissions }} title={`Na odpravah: ${inMissions}`}>
              <span className="cs-pop-icon">🎯</span>
              <span className="cs-pop-val">{inMissions}</span>
              <span className="cs-pop-label dim small">na odpravah</span>
            </div>
          )}
        </div>
      </div>
      {/* Ostali viri grafično — velike ikone, brez bar-ov */}
      <div className="cs-resources">
        <BigStat icon="🍞" label="Hrana/Voda" value={r.survival}      color="#cc8800"
          note={`(→ ${food.nextMonth})`}
          noteColor={food.nextMonth <= 0 ? '#cc2222' : food.nextMonth >= r.survival ? '#22cc88' : '#cc8800'} />
        <BigStat icon="⚔"  label="Orožje"     value={r.combat}        color="#cc4433" />
        <BigStat icon="⚙"  label="Material"   value={r.material ?? 0} color="#88aabb" />
        <BigStat icon="👁"  label="Intel"      value={r.intelligence}  color="#3388cc" />
        {(r.artifacts ?? 0) > 0 && (
          <BigStat icon="💎" label="Artefakti" value={r.artifacts}     color="#ffd84a" />
        )}
        {(game.wallsBuilt ?? 0) > 0 && (
          <BigStat icon="🧱" label="Obzidje"   value={game.wallsBuilt} color="#aabb88" />
        )}
      </div>
      {/* Razčlenitev izračuna hrane za naslednji mesec */}
      <div className="food-breakdown small">
        <span className="dim">Hrana naslednji mesec:</span>
        <span>{r.survival}</span>
        <span style={{ color: '#cc4444' }}>− {food.consumption} poraba (×{food.foodMult})</span>
        <span style={{ color: '#22cc88' }}>+ {food.production} pridelek</span>
        {food.packs > 0 && <span style={{ color: '#ffd84a' }}>− {food.packs} odprave</span>}
        <span className="dim">=</span>
        <b style={{ color: food.nextMonth <= 0 ? '#cc2222' : '#d8d8d8' }}>{food.nextMonth}</b>
        {food.nextMonth <= 0 && <span style={{ color: '#cc2222' }}>⚠ LAKOTA</span>}
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
        {node.description && <div className="dim small">{node.description}</div>}
        {node.effect && <div className="small" style={{ color: PHASE[node.phase].color }}>{node.effect}</div>}
        {node.executed && <span className="nc-exec-tag">IZVEDEN</span>}
      </div>
    </div>
  );
}

/** Človekovo drevo napredka — 3 veje × 3 nivoji = 9 vozlišč */
type HumanNode = { axis: HumanAxis; level: 1 | 2 | 3; threshold: number; label: string; effect: string };

const HUMAN_TREE: HumanNode[] = [
  // Obzidje
  { axis: 'obzidje', level: 1, threshold: 3, label: 'Obzidje I',   effect: '' },
  { axis: 'obzidje', level: 2, threshold: 6, label: 'Obzidje II',  effect: '' },
  { axis: 'obzidje', level: 3, threshold: 9, label: 'Obzidje III', effect: '' },
  // Orožje
  { axis: 'orozje',  level: 1, threshold: 3, label: 'Orožje I',    effect: '' },
  { axis: 'orozje',  level: 2, threshold: 6, label: 'Orožje II',   effect: '' },
  { axis: 'orozje',  level: 3, threshold: 9, label: 'Orožje III',  effect: '' },
  // Roboti
  { axis: 'roboti',  level: 1, threshold: 3, label: 'Roboti I',    effect: '' },
  { axis: 'roboti',  level: 2, threshold: 6, label: 'Roboti II',   effect: '' },
  { axis: 'roboti',  level: 3, threshold: 9, label: 'Roboti III',  effect: '' },
];

const HUMAN_AXIS_META: Record<HumanAxis, { icon: string; label: string; color: string }> = {
  obzidje: { icon: '🧱', label: 'OBZIDJE', color: '#aabb88' },
  orozje:  { icon: '⚔️', label: 'OROŽJE',  color: '#cc4433' },
  roboti:  { icon: '🤖', label: 'ROBOTI',  color: '#cc8800' },
};

const EMPTY_HISTORY: Record<HumanAxis, number> = { obzidje: 0, orozje: 0, roboti: 0 };

const RESEARCH_LEVEL_NAMES: Record<ResearchObjective, string[]> = {
  robots: ['Izvidniki', 'Napadalci', 'People-killerji'],
  weapon: ['Puške', 'EMP strelivo', 'Anti-core orožje'],
  wall: ['Leseni zid', 'EMP obramba', 'Napredni obrambni sistemi'],
};

/** Izbira osi (fokusa) meseca — viden gumb skrivanje / špijonaža / obramba. */
function AxisFocusBar({ value, onChange }: { value: HumanAxis; onChange: (a: HumanAxis) => void }) {
  const axes: Array<{ id: HumanAxis; effect: string }> = [
    { id: 'obzidje', effect: 'Fokus na obzidje' },
    { id: 'orozje',  effect: 'Fokus na orožje' },
    { id: 'roboti',  effect: 'Fokus na robote' },
  ];
  return (
    <div className="axis-focus">
      <div className="dim small" style={{ marginBottom: 4 }}>Fokus tega meseca:</div>
      <div className="axis-focus-row">
        {axes.map(a => {
          const meta = HUMAN_AXIS_META[a.id];
          const active = value === a.id;
          return (
            <button key={a.id} className={`axis-focus-btn ${active ? 'active' : ''}`}
              onClick={() => onChange(a.id)} title={a.effect}
              style={active ? { borderColor: meta.color, color: meta.color, background: '#0d1612' } : { color: '#8a99a3' }}>
              <span className="afb-icon">{meta.icon}</span>
              <span className="afb-label">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HumanTree({ robotsLevel, weaponLevel, wallLevel, focus, onFocus }: {
  robotsLevel: number; weaponLevel: number; wallLevel: number;
  focus: ResearchObjective;
  onFocus: (o: ResearchObjective) => void;
}) {
  // Roboti prvi; Orožje in Obzidje zaklenjeni za stopnjo robotov.
  const branches: Array<{ axis: HumanAxis; obj: ResearchObjective; level: number; gated: boolean }> = [
    { axis: 'roboti',  obj: 'robots', level: robotsLevel, gated: false },
    { axis: 'orozje',  obj: 'weapon', level: weaponLevel, gated: true },
    { axis: 'obzidje', obj: 'wall',   level: wallLevel,   gated: true },
  ];
  return (
    <div className="panel human-tree">
      <div className="panel-head">
        <h3>NAŠ NAČRT PREŽIVETJA · fokus določajo gumbi na raziskavah</h3>
      </div>
      <div className="ht-branches">
        {branches.map(b => {
          const meta = HUMAN_AXIS_META[b.axis];
          const isFocus = focus === b.obj;
          return (
            <div key={b.axis} className={`ht-branch ${isFocus ? 'ht-current ht-focus' : ''}`}
                 onClick={() => onFocus(b.obj)}
                 style={isFocus ? { background: '#0a1a14', borderLeft: `2px solid ${meta.color}` } : { cursor: 'pointer' }}>
              <div className="ht-br-head" style={{ color: meta.color }}>
                <span className="ht-br-icon">{meta.icon}</span>
                <span className="ht-br-label">{meta.label}</span>
                {isFocus && <span className="ht-focus-tag" style={{ background: meta.color }}>FOKUS</span>}
                <span className="ht-br-count">Lv{b.level}</span>
              </div>
              <div className="ht-nodes">
                {[1, 2, 3].map(lvl => {
                  const unlocked = b.level >= lvl;
                  // Orožje/Obzidje stopnje lvl zahtevajo Robote vsaj lvl
                  const lockedByRobots = b.gated && !unlocked && robotsLevel < lvl;
                  return (
                    <div key={lvl} className={`ht-node ${unlocked ? 'unlocked' : 'locked'}`}
                         style={unlocked ? { borderColor: meta.color } : {}}>
                      <div className="ht-node-head">
                        <span className="ht-node-lvl" style={{ color: unlocked ? meta.color : '#333' }}>
                          {unlocked ? '◆' : lockedByRobots ? '🔒' : '◇'}
                        </span>
                        <span className="ht-node-label" style={{ color: unlocked ? '#c8e0d0' : '#3a3a3a' }}>
                          {RESEARCH_LEVEL_NAMES[b.obj][lvl - 1]}
                        </span>
                      </div>
                      <div className="ht-node-eff dim small" style={{ color: unlocked ? meta.color : '#2a2a2a' }}>
                        {unlocked
                          ? (b.obj === 'robots' ? 'AI znanje odklenjeno' : `učinek ×${Math.pow(2, lvl)}`)
                          : lockedByRobots ? `rabi mehansko šibkost ${lvl}` : 'razišči'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** AI drevo — enaka vejna struktura kot naše drevo, veje = faze */
function AITree({ nodes, justRevealed }: { nodes: AITreeNode[]; justRevealed: Set<string> }) {
  const phases: Array<keyof typeof PHASE> = ['find', 'understand', 'eliminate'];
  const revealedCount = nodes.filter(n => n.visibility === 'revealed').length;
  return (
    <div className="panel human-tree ai-tree">
      <div className="panel-head">
        <h3>AI NAČRTOVALNO DREVO · odpira se z znanjem o AI</h3>
        <span className="panel-badge">{revealedCount}/{nodes.length} razkritih</span>
      </div>
      <div className="ht-branches">
        {phases.map(ph => {
          const meta = PHASE[ph];
          const phNodes = nodes.filter(n => n.phase === ph);
          const phRevealed = phNodes.filter(n => n.visibility === 'revealed').length;
          return (
            <div key={ph} className="ht-branch">
              <div className="ht-br-head" style={{ color: meta.color }}>
                <span className="ht-br-icon">{meta.num}</span>
                <span className="ht-br-label">{meta.label}</span>
                <span className="ht-br-count">{phRevealed}/{phNodes.length}</span>
              </div>
              <div className="ht-nodes">
                {phNodes.map(n => {
                  const unlocked = n.visibility === 'revealed';
                  const partial  = n.visibility === 'partial';
                  const flash = justRevealed.has(n.id);
                  return (
                    <div key={n.id} className={`ht-node ${unlocked ? 'unlocked' : 'locked'} ${flash ? 'flash' : ''}`}
                         style={unlocked ? { borderColor: meta.color } : {}}>
                      <div className="ht-node-head">
                        <span className="ht-node-lvl" style={{ color: unlocked ? meta.color : partial ? '#888' : '#333' }}>
                          {unlocked ? '◆' : partial ? '◐' : '?'}
                        </span>
                        <span className="ht-node-label" style={{ color: unlocked ? '#e0d0c8' : partial ? '#8a7a72' : '#3a3a3a' }}>
                          {unlocked ? n.label : partial ? `${n.label.split(' ')[0]}…` : '[ZAKRITO]'}
                        </span>
                      </div>
                      {unlocked && (
                        <>
                          <div className="ht-node-eff" style={{ color: meta.color }}>{n.effect || `moč ${n.strength}`}</div>
                          {n.description && <div className="dim small">{n.description}</div>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Šibke točke — z dodatnim "sumom" stanjem (megla prej kot popolna razkritje) */
type WPFog = 'hidden' | 'suspected' | 'known';

function wpFogLevel(wp: AIWeakPoint, aiTree: AITreeNode[]): WPFog {
  if (wp.discovered) return 'known';
  const phaseNodes = aiTree.filter(n => n.phase === wp.phase);
  const revealed = phaseNodes.filter(n => n.visibility === 'revealed').length;
  const partial  = phaseNodes.filter(n => n.visibility === 'partial').length;
  // Sum: 1+ partial ali 1+ revealed v isti fazi
  if (revealed >= 1 || partial >= 2) return 'suspected';
  return 'hidden';
}

function suspectedHint(wp: AIWeakPoint): string {
  // Megleni opis (prva beseda labela + namig)
  const first = wp.label.split(' ')[0];
  return `${first}… [megleno]`;
}

function WeakPoints({ wps, aiTree, target, onTarget }: {
  wps: AIWeakPoint[]; aiTree: AITreeNode[]; target: string; onTarget: (id: string) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ŠIBKE TOČKE AI</h3>
        <span className="panel-badge">{wps.filter(w => w.exploited).length}/{wps.length} uničenih</span>
      </div>
      {wps.map(wp => {
        const fog = wpFogLevel(wp, aiTree);
        const cls = wp.exploited ? 'exploited' : fog === 'known' ? 'discovered' : fog === 'suspected' ? 'suspected' : 'hidden';
        const icon = wp.exploited ? '✓' : fog === 'known' ? '◆' : fog === 'suspected' ? '◌' : '?';
        const name = wp.exploited || fog === 'known' ? wp.label
                   : fog === 'suspected' ? suspectedHint(wp)
                   : '[ZAKRITO]';
        return (
          <div key={wp.id} className={`wp-card ${cls}`}>
            <div className="wp-icon">{icon}</div>
            <div className="wp-body">
              <div className="wp-name">{name}</div>
              {fog === 'known' && !wp.exploited && (
                <div className="dim small">{PHASE[wp.phase].full}</div>
              )}
              {fog === 'suspected' && (
                <div className="dim small">Več izvidništva v fazi {PHASE[wp.phase].label} → razkrije celoten opis</div>
              )}
            </div>
            {fog === 'known' && !wp.exploited && (
              <button className={`wp-btn ${target === wp.id ? 'active' : ''}`}
                      onClick={() => onTarget(target === wp.id ? '' : wp.id)}>
                {target === wp.id ? '🎯 CILJ' : 'Ciljaj'}
              </button>
            )}
            {wp.exploited && <span className="wp-done-tag">UNIČENO</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Mini-Rations selector (kompakten 5-gumbni za misije) */
function MissionRationsButtons({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="mr-buttons">
      {[1,2,3,4,5].map(lvl => {
        const t = RATIONS[lvl];
        return (
          <button key={lvl}
            className={`mr-btn ${value === lvl ? 'sel' : ''}`}
            title={`${t.label} (×${t.strengthMult} moč, ×${t.foodMult} hrana)`}
            style={value === lvl ? { borderColor: t.color, color: t.color, background: '#0e0e0e' } : {}}
            onClick={() => onChange(lvl)}>
            {t.emoji}
          </button>
        );
      })}
    </div>
  );
}

/** Misije proti šibkim točkam AI */
function Missions({ wps, aiTree, active, plan, planR, onPlanChange, onRationsChange, odds, availablePop, selectedWpId, artifacts, onUseArtifact, artifactTargetWpId }: {
  wps: AIWeakPoint[]; aiTree: AITreeNode[];
  active: Mission[];
  plan: Record<string, number>;
  planR: Record<string, number>;
  onPlanChange: (id: string, n: number) => void;
  onRationsChange: (id: string, lvl: number) => void;
  odds: OddsPreview | null;
  availablePop: number;
  selectedWpId?: string;
  artifacts: number;
  onUseArtifact: (wpId: string) => void;
  artifactTargetWpId: string;
}) {
  return (
    <div className="panel def-panel">
      <div className="def-head"><span className="def-head-icon">◆</span>
        <div><h3>ŠIBKE TOČKE AI</h3><div className="def-sub">ODPRAVE PROTI AI</div></div>
        <span className="panel-badge" style={{ marginLeft: 'auto' }}>{wps.filter(w => w.exploited).length}/{wps.length} uničenih</span>
      </div>
      {wps.map(wp => {
        const fog = wpFogLevel(wp, aiTree);
        const icon = wp.exploited ? '✓' : fog === 'known' ? '◆' : fog === 'suspected' ? '◌' : '?';
        const color = wp.exploited ? '#33cc88' : fog === 'known' ? '#cc8800' : fog === 'suspected' ? '#886644' : '#555';
        const name = wp.exploited || fog === 'known' ? wp.label
                   : fog === 'suspected' ? suspectedHint(wp)
                   : '[ZAKRITO]';
        const activeM = active.find(m => m.weakPointId === wp.id);
        const planned = plan[wp.id] ?? 0;
        const preview = odds?.missionPreviews?.[wp.id];
        const rLvl = planR[wp.id] ?? activeM?.rations ?? 3;
        const rTierM = RATIONS[rLvl];
        const ppl = activeM?.assigned ?? planned;
        const foodCostMonth = Math.round(ppl * rTierM.foodMult);

        const isTargeted = selectedWpId === wp.id;
        return (
          <div key={wp.id} className="def-card" style={{ borderLeft: `3px solid ${color}`, outline: isTargeted ? '1px solid #cc3333' : 'none' }}>
            <div className="wp-body">
              <div className="def-ally-head">
                <span style={{ color, fontWeight: 700 }}>{icon} {name}</span>
                {wp.exploited && <span className="wp-done-tag">UNIČENO</span>}
                {isTargeted && !wp.exploited && <span className="dim small" style={{ color: '#cc3333' }}>🎯 IZBRANO</span>}
              </div>
              {activeM && (
                <>
                  <div className="mission-timer">
                    <div className="mt-bar-track">
                      <div className="mt-bar-fill" style={{ width: `${(1 - activeM.monthsRemaining / activeM.monthsTotal) * 100}%` }} />
                    </div>
                    <div className="mt-stats dim small">
                      🎯 <b>{activeM.assigned}</b> v misiji ·
                      do konca: <b style={{ color: '#cc8800' }}>{activeM.monthsRemaining}</b> / {activeM.monthsTotal} mesecev ·
                      uspeh ~ {Math.round((preview?.successProbability ?? activeM.successProbability) * 100)}%
                    </div>
                  </div>
                  <div className="mission-rations">
                    <span className="dim small">Obroki ekipe:</span>
                    <MissionRationsButtons value={rLvl} onChange={lvl => onRationsChange(wp.id, lvl)} />
                    <span className="dim small">→ −{foodCostMonth} hrane/m · moč ×{rTierM.strengthMult}</span>
                  </div>
                </>
              )}
              {fog === 'known' && !wp.exploited && !activeM && (
                <>
                  {artifacts > 0 && (
                    <button className="artifact-btn"
                      style={{ borderColor: artifactTargetWpId === wp.id ? '#ffd84a' : '#553a00', color: '#ffd84a' }}
                      onClick={() => onUseArtifact(artifactTargetWpId === wp.id ? '' : wp.id)}>
                      💎 {artifactTargetWpId === wp.id ? '✓ Uniči z artefaktom (ob izvedbi)' : `Uniči z artefaktom (1 / ${artifacts})`}
                    </button>
                  )}
                  <div className="mission-setup">
                    <input type="number" min={0} max={availablePop} value={planned}
                      onChange={e => onPlanChange(wp.id, +e.target.value)}
                      className="mission-input" />
                    <span className="dim small">ljudi</span>
                    {preview && planned >= 3 && (
                      <span className="mission-prob">
                        <span className="dim small">uspeh:</span>
                        <span style={{ color: probColor(preview.successProbability) }}>{Math.round(preview.successProbability * 100)}%</span>
                        <span className="dim small">·srečanje/m:</span>
                        <span style={{ color: probColor(1 - preview.encounterPerMonth) }}>{Math.round(preview.encounterPerMonth * 100)}%</span>
                        <span className="dim small">·{preview.monthsTotal}m</span>
                      </span>
                    )}
                    {planned > 0 && planned < 3 && (
                      <span className="small" style={{ color: '#cc2222' }}>min 3 ljudje</span>
                    )}
                  </div>
                  {planned >= 3 && (
                    <div className="mission-rations">
                      <span className="dim small">Obroki ekipe:</span>
                      <MissionRationsButtons value={rLvl} onChange={lvl => onRationsChange(wp.id, lvl)} />
                      <span className="dim small">→ −{foodCostMonth} hrane/m · moč ×{rTierM.strengthMult}</span>
                    </div>
                  )}
                </>
              )}
              {fog === 'suspected' && (
                <div className="dim small">Več izvidništva → razkrije polno odpravo</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Vizualni razdelilnik ljudi — segmenti z vlečnimi mejami, posameznikovi ikoni se obarvajo po vlogi */
type AllocRole = {
  key: 'c' | 'd' | 'f' | 's' | 'w' | 'r' | '_';
  label: string;
  icon: string;
  color: string;
  count: number;
  yieldText?: string;
  probLabel?: string;
  prob?: number;
  extraLabel?: React.ReactNode;
  contextTop?: React.ReactNode;
  markedCount?: number;            // koliko zadnjih figur naj bo "načrtovanih" (drugačna ikona)
  markedIcon?: string;
  markedTitle?: string;
};

/** Prerazporedi števila po proporcionalnem ključu: focusIdx se spremeni za `delta`,
 *  ostali pa proporcionalno k njihovi velikosti dajo/sprejmejo. */
function applyProportional(startCounts: number[], focusIdx: number, delta: number): number[] {
  if (delta === 0) return [...startCounts];
  const nc = [...startCounts];
  const otherIdxs = nc.map((_, i) => i).filter(i => i !== focusIdx);
  const otherSum = otherIdxs.reduce((s, i) => s + nc[i], 0);

  if (delta > 0) {
    // Vloga raste — vzemi iz ostalih proporcionalno
    if (otherSum === 0) return nc;
    const actual = Math.min(delta, otherSum);
    nc[focusIdx] += actual;
    let remaining = actual;
    for (let j = 0; j < otherIdxs.length; j++) {
      const i = otherIdxs[j];
      const isLast = j === otherIdxs.length - 1;
      const share = isLast ? remaining : Math.min(Math.round(actual * nc[i] / otherSum), nc[i]);
      nc[i] = Math.max(0, nc[i] - share);
      remaining -= share;
    }
    if (remaining > 0) nc[focusIdx] -= remaining;
    if (remaining < 0) {
      // Nazadnji je dobil več, kot bi smel — popravi
      let surplus = -remaining;
      for (let j = otherIdxs.length - 1; j >= 0 && surplus > 0; j--) {
        const i = otherIdxs[j];
        // Vrni surplus nazaj v i (preveč smo vzeli)
        nc[i] += surplus;
        surplus = 0;
      }
      nc[focusIdx] -= -remaining;
    }
  } else {
    // Vloga upade — daj ostalim proporcionalno (če so vsi 0, prosti dobi vse)
    const actual = Math.min(-delta, nc[focusIdx]);
    nc[focusIdx] -= actual;
    if (otherSum === 0) {
      // Vsi ostali 0 — dodaj zadnjemu (pričakovano "Prosti")
      nc[otherIdxs[otherIdxs.length - 1]] += actual;
    } else {
      let remaining = actual;
      for (let j = 0; j < otherIdxs.length; j++) {
        const i = otherIdxs[j];
        const isLast = j === otherIdxs.length - 1;
        const share = isLast ? remaining : Math.round(actual * nc[i] / otherSum);
        nc[i] += share;
        remaining -= share;
      }
    }
  }
  return nc;
}

function PeopleAllocator({ roles, available, inMissions, newMission, onTransfer }: {
  roles: AllocRole[];
  available: number;
  inMissions: number;
  newMission: number;
  onTransfer: (newCounts: number[]) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ handleIdx: number; startX: number; startCounts: number[]; barWidth: number } | null>(null);

  function startDrag(handleIdx: number, e: React.PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const w = barRef.current?.getBoundingClientRect().width ?? 1;
    setDrag({ handleIdx, startX: e.clientX, startCounts: roles.map(r => r.count), barWidth: w });
  }
  function moveDrag(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) * available / drag.barWidth);
    // Handle drag = sprememba vloge LEVO od ročice (focusIdx).
    // Prerazporeditev se odvije iz / na VSE ostale vloge proporcionalno.
    const focusIdx = drag.handleIdx;
    const newCounts = applyProportional(drag.startCounts, focusIdx, delta);
    onTransfer(newCounts);
  }
  function endDrag(e: React.PointerEvent) {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDrag(null);
  }

  return (
    <div className="people-allocator">
      {/* Konteksten control nad vsako vlogo (5 enakih stolpcev) */}
      <div className="pa-context-row">
        {roles.map(r => (
          <div key={r.key} className="pa-context-cell">
            {r.contextTop}
          </div>
        ))}
      </div>

      {/* Naslovi vrstic + +/− gumbi */}
      <div className="pa-labels">
        {roles.map((r, ri) => {
          const freeIdx = roles.findIndex(x => x.key === '_');
          const isFree = r.key === '_';
          const otherTotal = roles.reduce((s, x, i) => s + (i === ri ? 0 : x.count), 0);
          // Plus: navadna vloga vzame iz Prosti; Prosti vzame iz drugih proporcionalno
          const canPlus  = isFree ? otherTotal > 0 : (freeIdx >= 0 ? roles[freeIdx].count > 0 : false);
          const canMinus = r.count > 0;
          const step = (delta: number) => {
            let nc = roles.map(x => x.count);
            if (isFree) {
              // Prosti: uporabi proporcionalno prerazporeditev
              nc = applyProportional(nc, ri, delta);
            } else {
              if (delta > 0 && canPlus) {
                nc[ri] += 1;
                nc[freeIdx] -= 1;
              } else if (delta < 0 && canMinus) {
                nc[ri] -= 1;
                if (freeIdx >= 0) nc[freeIdx] += 1;
              }
            }
            onTransfer(nc);
          };
          return (
            <div key={r.key} className="pa-label" style={{ color: r.color }}>
              <div className="pa-label-head">
                <span>{r.icon} <b style={{ color: r.color }}>{r.label}</b></span>
                <span className="pa-pm">
                  <button className="pa-btn" disabled={!canMinus} onClick={() => step(-1)}>−</button>
                  <b className="pa-count">{r.count}</b>
                  <button className="pa-btn" disabled={!canPlus} onClick={() => step(+1)}>+</button>
                </span>
              </div>
              {r.yieldText && <span className="pa-yield dim small">{r.yieldText}</span>}
              {r.prob !== undefined && r.probLabel && (
                <span className="pa-prob small">
                  <span className="dim">{r.probLabel}:</span>
                  <span style={{ color: probColor(r.prob) }}>{Math.round(r.prob * 100)}%</span>
                </span>
              )}
              {r.extraLabel}
            </div>
          );
        })}
      </div>

      {/* Glavna razdelilna palica z ljudmi — fiksne enake širine stolpcev */}
      <div className="pa-bar" ref={barRef}>
        {roles.map((r) => {
          const marked = Math.max(0, Math.min(r.count, r.markedCount ?? 0));
          return (
            <div key={r.key} className={`pa-seg pa-${r.key}`}
              style={{ background: r.color + '14', borderTopColor: r.color }}>
              <div className="pa-people">
                {Array.from({ length: r.count }, (_, idx) => {
                  const isMarked = idx < marked;  // prvi `marked` figur = načrtovani
                  if (isMarked) {
                    return (
                      <div key={idx} className="pa-person planned"
                        title={r.markedTitle ?? 'načrtovan za odpravo'}
                        style={{ background: '#1a1500', borderColor: '#ffd84a', color: '#ffd84a' }}>
                        {r.markedIcon ?? '↑'}
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="pa-person"
                      style={{ background: r.color + '40', borderColor: r.color, color: r.color }}>
                      {r.icon}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {/* Vlečne ročice na DESNEM robu vsakega segmenta (razen zadnjega).
            Drag desno = vloga raste, levo = vloga upade. */}
        {roles.slice(0, -1).map((_, i) => {
          const leftPct = ((i + 1) / roles.length) * 100;
          return (
            <div key={i} className={`pa-handle ${drag?.handleIdx === i ? 'dragging' : ''}`}
              style={{ left: `${leftPct}%` }}
              onPointerDown={e => startDrag(i, e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              title={`Vleči desno: +${roles[i].label} · levo: −${roles[i].label}`}>
              <div className="pa-handle-bar" />
              <div className="pa-handle-grip">⇔</div>
            </div>
          );
        })}
      </div>

      {(inMissions + newMission > 0) && (
        <div className="pa-mission-note dim small">
          🎯 <b>{inMissions + newMission} ljudi na odpravah</b> — niso v kampu, niso na voljo za razporejanje in
          <b style={{ color: '#22cc88' }}> niso ogroženi pri napadu AI na kamp</b>.
        </div>
      )}
    </div>
  );
}

/** Vizualna razporeditev populacije */
function PeopleBar({ pop, combatants, defenders, foragers, scouts, inMissions, newMission }: {
  pop: number; combatants: number; defenders: number;
  foragers: number; scouts: number; inMissions: number; newMission: number;
}) {
  const used = combatants + defenders + foragers + scouts + inMissions + newMission;
  const free = Math.max(0, pop - used);
  const over = used > pop;
  if (pop === 0) return null;
  return (
    <div className="people-bar-wrap">
      <div className={`people-bar ${over ? 'over' : ''}`}>
        {combatants > 0 && <div className="pb-seg combat"  style={{ flex: combatants }} title={`Napad: ${combatants}`} />}
        {defenders  > 0 && <div className="pb-seg defense" style={{ flex: defenders }}  title={`Obramba: ${defenders}`} />}
        {foragers   > 0 && <div className="pb-seg forage"  style={{ flex: foragers }}   title={`Nabiralci: ${foragers}`} />}
        {scouts     > 0 && <div className="pb-seg scout"   style={{ flex: scouts }}     title={`Izvidniki: ${scouts}`} />}
        {(inMissions + newMission) > 0 && <div className="pb-seg mission" style={{ flex: inMissions + newMission }} title={`V misijah: ${inMissions + newMission}`} />}
        {free       > 0 && <div className="pb-seg free"    style={{ flex: free }}       title={`Prosti: ${free}`} />}
      </div>
      <div className="pb-legend">
        <span className="pbl combat">⚔ {combatants}</span>
        <span className="pbl defense">🛡 {defenders}</span>
        <span className="pbl forage">🌾 {foragers}</span>
        <span className="pbl scout">🔭 {scouts}</span>
        {(inMissions + newMission) > 0 && <span className="pbl mission">🎯 {inMissions + newMission}</span>}
        <span className={`pbl free ${over ? 'danger' : ''}`}>{over ? `⚠ +${used - pop}` : `prosti ${free}`}</span>
      </div>
    </div>
  );
}

function probColor(p: number): string {
  if (p >= 0.70) return '#22cc66';
  if (p >= 0.45) return '#cc8800';
  if (p >= 0.20) return '#cc5544';
  return '#cc2222';
}

/** En slider za razporejanje — z opcijsko verjetnostjo */
function SliderRow({ icon, label, val, onChange, max, yieldText, probLabel, prob, color }: {
  icon: string; label: string; val: number; onChange: (n: number) => void;
  max: number; yieldText: string;
  probLabel?: string; prob?: number;
  color?: string;
}) {
  const pctFill = max > 0 ? (val / max * 100).toFixed(1) : '0';
  return (
    <div className="slider-row" style={color ? { borderLeft: `2px solid ${color}`, paddingLeft: 8 } : {}}>
      <div className="sr-head">
        <span>{icon} {label}</span>
        <span className="sr-val">{val}</span>
        <span className="sr-yield dim">{yieldText}</span>
      </div>
      <input
        type="range" min={0} max={max} value={val} step={1}
        onChange={e => onChange(+e.target.value)}
        style={{ '--pct': `${pctFill}%`, ...(color ? { ['--slider-color' as never]: color } : {}) } as React.CSSProperties}
      />
      {prob !== undefined && probLabel && (
        <div className="sr-prob">
          <span className="dim small">{probLabel}:</span>
          <span className="sr-prob-val" style={{ color: probColor(prob) }}>{Math.round(prob * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/** Rations selector — 5 gumbov za nivo obrokov */
function RationsSelector({ value, onChange, pop }: { value: number; onChange: (n: number) => void; pop: number }) {
  const r = RATIONS[value];
  const foodCost = Math.round(pop * r.foodMult);
  const popHint = r.popMin === 0 && r.popMax === 0 ? '±0' :
                  r.popMin === r.popMax ? `${r.popMin > 0 ? '+' : ''}${r.popMin}` :
                  `${r.popMin > 0 ? '+' : ''}${r.popMin} do ${r.popMax > 0 ? '+' : ''}${r.popMax}`;
  return (
    <div className="rations-block">
      <div className="rations-row">
        {[1, 2, 3, 4, 5].map(lvl => {
          const t = RATIONS[lvl];
          return (
            <button key={lvl}
              className={`rations-btn ${value === lvl ? 'sel' : ''}`}
              style={value === lvl ? { borderColor: t.color, color: t.color, background: '#0e0e0e' } : {}}
              onClick={() => onChange(lvl)}
              title={`${t.label} — moč ×${t.strengthMult}, hrana ×${t.foodMult}, populacija ${t.popMin === t.popMax ? t.popMin : `${t.popMin} do ${t.popMax}`}`}>
              <span className="rb-emoji">{t.emoji}</span>
              <span className="rb-num">{lvl}</span>
            </button>
          );
        })}
      </div>
      <div className="rations-info" style={{ color: r.color }}>
        <span className="ri-label">{r.label}</span>
        <span className="ri-stats dim small">
          hrana <b style={{ color: r.color }}>{foodCost}/r</b> ·
          moč <b style={{ color: r.color }}>×{r.strengthMult}</b> ·
          ljudje <b style={{ color: r.color }}>{popHint}</b>
        </span>
      </div>
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

/** Kronološki dnevnik dogodkov ob mapi (frontend-only akumulacija) */
interface LedgerItem { icon: string; label: string; value: number; }
interface KeyIcon    { icon: string; color: string; title: string; }
interface EventEntry {
  round: number;
  phase: AIPhase;
  narrative: string;
  ledger: LedgerItem[];
  icons: KeyIcon[];
  ourKnow: number;       // 0..1
  aiKnow:  number;       // 0..1
  ts: number;
}

function LedgerChip({ item }: { item: LedgerItem }) {
  const positive = item.value > 0;
  const negative = item.value < 0;
  const color = positive ? '#22cc88' : negative ? '#cc4444' : '#666';
  const sign = positive ? '+' : '';
  return (
    <span className="ledger-chip" style={{ borderColor: color, color }}>
      <span className="lc-icon">{item.icon}</span>
      <span className="lc-val">{sign}{item.value}</span>
      <span className="lc-label dim">{item.label}</span>
    </span>
  );
}

/** Kompaktni trendni graf premoči — samo SVG (brez glave in legende), za inline rabo. */
function CompactBalanceTrend({ entries }: { entries: EventEntry[] }) {
  if (entries.length < 1) return <div className="dk-divider">VS</div>;
  const ord = [...entries].reverse();
  const N = ord.length;
  const H = 30;
  const W = Math.max(20, N - 1);
  const usable = H - 4;
  const ourPts   = ord.map((e, i) => ({ x: i, y: 2 + (1 - e.ourKnow) * usable }));
  const theirPts = ord.map((e, i) => ({ x: i, y: 2 + (1 - e.aiKnow)  * usable }));
  const toPath = (pts: typeof ourPts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y.toFixed(2)}`).join(' ');
  const last = ord[ord.length - 1];
  const delta = last ? (last.ourKnow - last.aiKnow) * 100 : 0;
  return (
    <div className="bt-compact">
      <div className="bt-compact-head">
        <span className="bt-compact-title">premoč skozi čas</span>
        <span className="bt-compact-delta" style={{ color: delta >= 0 ? '#66ccaa' : '#cc4444' }}>
          {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bt-compact-svg">
        <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="#1e1e1e" strokeWidth="0.3" strokeDasharray="0.5 0.5" />
        <path d={toPath(theirPts)} fill="none" stroke="#cc3333" strokeWidth="0.7" />
        <path d={toPath(ourPts)}   fill="none" stroke="#22aa88" strokeWidth="0.7" />
        {ourPts.length > 0 && (
          <>
            <circle cx={ourPts[ourPts.length-1].x}   cy={ourPts[ourPts.length-1].y}   r="0.9" fill="#22aa88" />
            <circle cx={theirPts[theirPts.length-1].x} cy={theirPts[theirPts.length-1].y} r="0.9" fill="#cc3333" />
          </>
        )}
      </svg>
    </div>
  );
}

/** Trendni graf premoči — mi vemo vs AI ve, oldest left -> newest right. */
function BalanceTrend({ entries }: { entries: EventEntry[] }) {
  if (entries.length < 1) return null;
  const ord = [...entries].reverse();  // newest-first → oldest-first
  const N = ord.length;
  const H = 56;
  const W = Math.max(20, N - 1);
  const usable = H - 8;
  const ourPts   = ord.map((e, i) => ({ x: i, y: 4 + (1 - e.ourKnow) * usable }));
  const theirPts = ord.map((e, i) => ({ x: i, y: 4 + (1 - e.aiKnow)  * usable }));
  const toPath = (pts: typeof ourPts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y.toFixed(2)}`).join(' ');
  const last = ord[ord.length - 1];
  const delta = last ? (last.ourKnow - last.aiKnow) * 100 : 0;
  return (
    <div className="balance-trend">
      <div className="bt-head">
        <span className="bt-title">PREMOČ ČEZ ČAS</span>
        <span className="bt-delta" style={{ color: delta >= 0 ? '#66ccaa' : '#cc4444' }}>
          {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bt-svg">
        {/* Mid line */}
        <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="#1e1e1e" strokeWidth="0.3" strokeDasharray="0.5 0.5" />
        <path d={toPath(theirPts)} fill="none" stroke="#cc3333" strokeWidth="0.7" />
        <path d={toPath(ourPts)}   fill="none" stroke="#22aa88" strokeWidth="0.7" />
        {/* End dots */}
        {ourPts.length > 0 && (
          <>
            <circle cx={ourPts[ourPts.length-1].x}   cy={ourPts[ourPts.length-1].y}   r="0.9" fill="#22aa88" />
            <circle cx={theirPts[theirPts.length-1].x} cy={theirPts[theirPts.length-1].y} r="0.9" fill="#cc3333" />
          </>
        )}
      </svg>
      <div className="bt-legend small">
        <span style={{ color: '#22aa88' }}>● LJUDJE VEMO {Math.round((last?.ourKnow ?? 0) * 100)}%</span>
        <span style={{ color: '#cc3333' }}>● AI VE {Math.round((last?.aiKnow ?? 0) * 100)}%</span>
      </div>
    </div>
  );
}

function EventLog({ entries }: { entries: EventEntry[] }) {
  const [openTs, setOpenTs] = useState<number | null>(entries[0]?.ts ?? null);
  // Avto-odpri najnovejši dogodek, ko se pojavi
  useEffect(() => {
    if (entries[0]) setOpenTs(entries[0].ts);
  }, [entries[0]?.ts]);
  return (
    <div className="panel event-log-panel">
      <div className="panel-head">
        <h3>ČASOVNI TRAK</h3>
        <span className="panel-badge">{entries.length}m</span>
      </div>
      <div className="timeline-scroll">
        {entries.length === 0 && (
          <div className="dim small" style={{ padding: 12 }}>
            Mesec še ni minil. Razporedi ekipe in izvedi mesec.
          </div>
        )}
        {entries.map((e, i) => {
          const isOpen = openTs === e.ts;
          const isSpecial = /💥 ŠIBKA TOČKA UNIČENA/.test(e.narrative);
          const top = [...e.ledger].sort((a,b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 4);
          const prev = entries[i - 1];   // novejša (zgornja) vrstica
          const showPhaseHdr = !prev || prev.phase !== e.phase;
          const ph = PHASE[e.phase];
          return (
            <Fragment key={e.ts}>
            {showPhaseHdr && (
              <div className="tl-phase-hdr" style={{ borderColor: ph.color, color: ph.color }}>
                <span className="tl-phase-num" style={{ background: ph.color }}>FAZA {ph.num}</span>
                <span className="tl-phase-label">{ph.full}</span>
              </div>
            )}
            <div className={`tl-row ${isOpen ? 'open' : ''} ${isSpecial ? 'special' : ''}`}
                 style={{ borderLeftColor: ph.color }}
                 onClick={() => setOpenTs(isOpen ? null : e.ts)}>
              <div className="tl-row-main">
                <span className="tl-round" style={{ color: PHASE[e.phase].color, borderColor: PHASE[e.phase].color }}>
                  M{e.round}
                </span>
                <div className="tl-icons">
                  {e.icons.length === 0 && <span className="dim small">·</span>}
                  {e.icons.map((ic, i) => (
                    <span key={i} className="tl-icon" style={{ color: ic.color }} title={ic.title}>{ic.icon}</span>
                  ))}
                </div>
                <div className="tl-mini-ledger">
                  {top.map((it, i) => {
                    const pos = it.value > 0;
                    return (
                      <span key={i} className="tl-chip" style={{ color: pos ? '#22cc88' : '#cc4444' }} title={it.label}>
                        {it.icon}{pos ? '+' : ''}{it.value}
                      </span>
                    );
                  })}
                </div>
                <span className="tl-expand dim">{isOpen ? '▾' : '▸'}</span>
              </div>
              {isOpen && (
                <div className="tl-row-detail">
                  <ul className="ee-events">
                    {e.narrative.split('\n').filter(Boolean).map((line, li) => (
                      <li key={li} className="ee-event-line">{line}</li>
                    ))}
                  </ul>
                  {e.ledger.length > top.length && (
                    <div className="ee-ledger">
                      {e.ledger.map((item, idx) => <LedgerChip key={idx} item={item} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Človeške misije — NOV BLOK (placeholder). TODO: engine logika prihaja kasneje. */
function HumanMissionsPlaceholder() {
  // TODO: nadomesti s pravo engine logiko ko bo na voljo
  const placeholder = [
    { id: 'm1', title: 'Iskanje zaveznikov',     desc: 'Pošlji 5 izvidnikov, da najdejo sosednji klan.',     status: 'available', months: 3, color: '#22aa88' },
    { id: 'm2', title: 'Obnova zatočišča',       desc: 'Zgradi bunker. Potrebnih 10 ljudi + 30 materiala.',  status: 'available', months: 4, color: '#cc8800' },
    { id: 'm3', title: 'Sabotaža AI postaje',    desc: 'Skupina 8 borcev udari AI senzorsko postajo.',       status: 'locked',    months: 5, color: '#cc3333' },
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>MISIJE ČLOVEŠTVA</h3>
        <span className="panel-badge teal">{placeholder.filter(m => m.status === 'available').length} na voljo</span>
      </div>
      <div className="dim small" style={{ marginBottom: 8, fontStyle: 'italic' }}>
        ⚠ Placeholder — logika misij prihaja v naslednjem koraku
      </div>
      {placeholder.map(m => (
        <div key={m.id} className={`hm-card ${m.status}`} style={{ borderLeftColor: m.color }}>
          <div className="hm-head">
            <span className="hm-title" style={{ color: m.color }}>{m.title}</span>
            <span className="hm-months dim small">{m.months}m</span>
          </div>
          <div className="hm-desc dim small">{m.desc}</div>
          <button className="hm-btn" disabled style={{ borderColor: m.color, color: m.status === 'locked' ? '#444' : m.color }}>
            {m.status === 'locked' ? '🔒 Zaklenjeno' : 'Začni odpravo'}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Zavezniki — drugi človeški klani na mapi */
function AlliesPanel({ clans }: { clans: OtherClan[] }) {
  const specInfo: Record<string, { icon: string; label: string; gift: string }> = {
    food:     { icon: '🌾', label: 'hrana',    gift: '+8 hrane / mesec' },
    material: { icon: '⚙',  label: 'material',  gift: '+4 materiala / mesec' },
    weapons:  { icon: '⚔',  label: 'orožje',    gift: '+2 orožja / mesec' },
    people:   { icon: '👥', label: 'okrepitve', gift: '+1 oseba / mesec' },
  };
  const discovered = clans.filter(c => c.discovered);
  const allied = clans.filter(c => c.allied);
  return (
    <div className="panel def-panel">
      <div className="def-head"><span className="def-head-icon">🤝</span>
        <div><h3>ZAVEZNIKI</h3><div className="def-sub">DRUGI KLANI</div></div>
        <span className="panel-badge teal" style={{ marginLeft: 'auto' }}>{allied.length} zavez. · {discovered.length}/{clans.length}</span>
        <InfoButton kind="allies" />
      </div>
      {clans.map(c => {
        const s = specInfo[c.specialty];
        const color = c.allied ? '#33cc88' : c.discovered ? '#c0a050' : '#555';
        return (
          <div key={c.id} className="def-card" style={{ borderLeft: `3px solid ${color}` }}>
            <div className="def-ally-head">
              <span style={{ color, fontWeight: 700 }}>{c.discovered ? `⛺ ${c.label}` : '⛺ ??? neznan klan'}</span>
              <span className="dim small">{c.discovered ? `(${c.q},${c.r})` : '?'}</span>
            </div>
            <div className="def-stat-note" style={{ fontSize: '.68rem' }}>
              {c.allied
                ? `🤝 Zaveznik — ${s.icon} ${s.gift}; dviguje aktivnost klanov.`
                : c.discovered
                  ? `Specialnost: ${s.icon} ${s.label}. Pošlji odpravo na (${c.q},${c.r}) za zavezništvo.`
                  : 'Neznana lokacija — razišči mapo, da ga najdeš.'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Modal za povratne informacije igralca */
function FeedbackModal({ game, onClose }: { game: GameState | null; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    if (!msg.trim() || sending) return;
    setSending(true); setErr('');
    try {
      await sendFeedback({
        message: msg.trim(),
        runId: game?.runId,
        round: game?.totalRounds,
        status: game?.status,
      });
      setDone(true);
      setTimeout(onClose, 1200);
    } catch {
      setErr('Pošiljanje ni uspelo. Poskusi znova.');
    } finally { setSending(false); }
  }
  return (
    <div className="fb-overlay" onClick={onClose}>
      <div className="fb-box" onClick={e => e.stopPropagation()}>
        <button className="fb-close" onClick={onClose}>✕</button>
        <h3 style={{ marginBottom: 8 }}>💬 Tvoje mnenje</h3>
        {done ? (
          <p style={{ color: '#33cc88', margin: '1rem 0' }}>✓ Hvala! Mnenje je shranjeno.</p>
        ) : (
          <>
            <p className="dim small" style={{ marginBottom: 8 }}>
              Napiši predlog, napako ali kar koli o igri. Shrani se in si ga ogledava.
            </p>
            <textarea className="fb-textarea" value={msg} maxLength={5000}
              placeholder="Tvoje mnenje…" autoFocus
              onChange={e => setMsg(e.target.value)} />
            {err && <div className="weapon-warning" style={{ marginTop: 6 }}>{err}</div>}
            <button className="exec-btn" style={{ marginTop: 10 }}
              disabled={!msg.trim() || sending} onClick={submit}>
              {sending ? '⟳ Pošiljam…' : '▶ Pošlji mnenje'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Pravila igre — razdeljena na pregledne podenote */
function RulesModal({ onClose }: { onClose: () => void }) {
  const sections: Array<{ id: string; icon: string; title: string; body: React.ReactNode }> = [
    { id: 'cilj', icon: '🎯', title: 'Cilj igre', body: (
      <p>Vodiš zadnji človeški klan po tem, ko je AI prevzel Zemljo. Igra traja <b>36 mesecev (3 faze po 12)</b>.
        Zmagaš, če uničiš vse <b>šibke točke AI</b> ali iztrebiš vse robote. Izgubiš, če ti izumre populacija
        ali te AI premaga.</p>
    ) },
    { id: 'faze', icon: '🌑', title: 'Faze AI', body: (
      <ul>
        <li><b>1 — AI išče:</b> AI ima predvsem izvidniške enote. Človeška tehnologija je osnovna.</li>
        <li><b>2 — AI razume:</b> pridejo napadalne enote. Potrebna sta boljše orožje in EMP obramba.</li>
        <li><b>3 — AI iztreblja:</b> pridejo people-killer enote. Potrebni so napredni obrambni sistemi in močnejše orožje.</li>
      </ul>
    ) },
    { id: 'viri', icon: '📦', title: 'Viri', body: (
      <ul>
        <li>🍞 <b>Hrana</b> — porablja jo populacija; nabiralci jo pridelajo.</li>
        <li>⚔ <b>Orožje</b> — omejuje, koliko ljudi se lahko bori; izdela se iz materiala.</li>
        <li>⚙ <b>Material</b> — surovina za orožje in obzidje; najdeš ga z odpravami in iz uničenih robotov.</li>
        <li>👁 <b>Intel</b> — raziskovalci ga zbirajo; izboljša boje in poganja odkrivanje AI drevesa.</li>
        <li>💎 <b>Artefakt</b> — redek; takoj uniči eno odkrito šibko točko.</li>
      </ul>
    ) },
    { id: 'ljudje', icon: '👥', title: 'Razporeditev ljudi', body: (
      <ul>
        <li>🛡 <b>Obramba</b> — branilci odbijajo napade AI na kamp.</li>
        <li>🌾 <b>Prehrana</b> — nabiralci zbirajo hrano; jakost obrokov (1–5) vpliva na porabo in moč.</li>
        <li>🔨 <b>Delavnice</b> — delavci izdelujejo orožje ali gradijo obzidje.</li>
        <li>🔬 <b>Raziskave</b> — raziskovalci ustvarjajo intel, razkrivajo AI šibkosti in odklepajo nadgradnje.</li>
        <li>Pod ikonami so + / − za premik prostih ljudi v vsako območje.</li>
      </ul>
    ) },
    { id: 'karta', icon: '🗺', title: 'Karta & odprave', body: (
      <ul>
        <li>Karta je v megli; razkrivaš jo z odpravami (raziskanost polja raste z obiski).</li>
        <li>V zavihku <b>Izvidniki</b> narišeš pot (klikaš sosednje hekse) in pošlješ izvidnike.</li>
        <li>Odprave vzamejo hrano s seboj; na poti so možna srečanja in najdbe (material, orožje, artefakt).</li>
        <li>Odprave in napadi so edini sistem misij; stare timer misije niso več del normalnega igranja.</li>
        <li>Pot odprave je <b>rumena</b>.</li>
      </ul>
    ) },
    { id: 'napad', icon: '⚔', title: 'Napad', body: (
      <ul>
        <li>V zavihku <b>Napad</b> narišeš pot do <b>AI jedra (☣)</b> ali odkrite <b>šibke točke (◆)</b> in pošlješ napadalce.</li>
        <li>Spopad se sproži <b>ob prihodu</b>; preživeli se vrnejo v kamp.</li>
        <li>Pot napada je <b>rdeča</b>.</li>
      </ul>
    ) },
    { id: 'obramba', icon: '🧱', title: 'Obramba & obzidje', body: (
      <ul>
        <li>Verjetnost napada AI je <b>na mesec</b> in raste z AI močjo, znanjem o nas in številom ljudi v kampu.</li>
        <li>Branilci in <b>obzidje</b> ne znižajo verjetnosti napada, ampak povečajo <b>odbitje</b>.</li>
        <li>Vsako <b>obzidje</b> doda <b>+20 %</b> moči obrambe; raziskava obzidja učinek podvoji po stopnjah.</li>
      </ul>
    ) },
    { id: 'raziskave', icon: '🔬', title: 'Research loop', body: (
      <ul>
        <li><b>Research → Intel → AI weak points → Upgrades → Survival</b>.</li>
        <li><b>Roboti</b> raziskava najhitreje dviguje AI znanje in odpira AI drevo.</li>
        <li><b>Mehanske šibkosti</b> odklenejo stopnje orožja in obzidja: izvidniki 1, napadalci 2, people-killerji 3.</li>
        <li><b>Logične šibkosti</b> takoj dajo pasivne bonuse proti ustreznim AI enotam.</li>
      </ul>
    ) },
    { id: 'zavezniki', icon: '⛺', title: 'Drugi klani (zavezniki)', body: (
      <ul>
        <li>Na karti so skriti drugi človeški klani. Razišči njihov heks, da jih <b>odkriješ</b> (⛺).</li>
        <li>Pošlji odpravo do njih za <b>zavezništvo</b>; nato mesečno pomagajo (hrana / material / orožje / okrepitve) in dvignejo aktivnost klanov (manj napadov AI).</li>
      </ul>
    ) },
    { id: 'konec', icon: '🏁', title: 'Zmaga & poraz', body: (
      <ul>
        <li><b>Zmaga:</b> vse šibke točke uničene ali vsi roboti iztrebljeni.</li>
        <li><b>Poraz:</b> populacija pade na 0 (lakota / izgube) ali te AI premaga.</li>
      </ul>
    ) },
  ];
  const [open, setOpen] = useState<string>('cilj');
  return (
    <div className="fb-overlay" onClick={onClose}>
      <div className="rules-box" onClick={e => e.stopPropagation()}>
        <button className="fb-close" onClick={onClose}>✕</button>
        <h3 style={{ marginBottom: 10 }}>📖 Pravila igre</h3>
        <div className="rules-acc">
          {sections.map(s => (
            <div key={s.id} className={`rules-sec ${open === s.id ? 'open' : ''}`}>
              <button className="rules-sec-head" onClick={() => setOpen(open === s.id ? '' : s.id)}>
                <span>{s.icon} {s.title}</span>
                <span className="dim">{open === s.id ? '▾' : '▸'}</span>
              </button>
              {open === s.id && <div className="rules-sec-body">{s.body}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Log zadnjega meseca */
function RoundLog({ log }: { log: RoundLog }) {
  const c = log.combat;
  const r = log.raid;
  const s = log.scout;
  return (
    <div className="round-log">
      <div className="rl-head">
        <h3>MESEC {log.round} · {PHASE[log.phase].full}</h3>
      </div>
      <p className="rl-narrative">{log.narrative}</p>
      <div className="rl-cols">
        {c && (
          <div className="rl-section">
            <div className="rl-sec-title">⚔ Napad</div>
            <div className="rl-outcome" style={{ color: outcomeColor(c.outcome) }}>
              {outcomeLabel(c.outcome)}
            </div>
            <div className="rl-odds dim small">{Math.round(c.successProbability * 100)}% uspešnost</div>
            {c.humanLost > 0       && <div className="rl-neg">− {c.humanLost} napadalcev</div>}
            {c.aiRobotsDestroyed>0  && <div className="rl-pos">− {c.aiRobotsDestroyed} AI robotov</div>}
            {c.infoGained > 0      && <div className="rl-pos">+ {c.infoGained} intel</div>}
          </div>
        )}
        {r && r.occurred && r.outcome && (
          <div className="rl-section">
            <div className="rl-sec-title">🛡 AI napad na kamp</div>
            <div className="rl-outcome" style={{ color: outcomeColor(r.outcome) }}>
              {outcomeLabel(r.outcome)}
            </div>
            <div className="rl-odds dim small">{Math.round(r.successProbability * 100)}% obramba</div>
            {(r.breachedAreas?.length ?? 0) > 0 && (
              <div className="rl-neg">⚠ Prebita območja: {r.breachedAreas.map(a => ({ food: 'prehrana', workshop: 'delavnice', research: 'raziskave', defense: 'obramba' } as Record<string, string>)[a] ?? a).join(', ')}</div>
            )}
            {r.defendersLost > 0   && <div className="rl-neg">− {r.defendersLost} branilcev</div>}
            {r.foragersLost > 0    && <div className="rl-neg">− {r.foragersLost} nabiralcev</div>}
            {(r.workersLost ?? 0) > 0     && <div className="rl-neg">− {r.workersLost} delavcev</div>}
            {(r.researchersLost ?? 0) > 0 && <div className="rl-neg">− {r.researchersLost} raziskovalcev</div>}
            {(r.survivalDestroyed ?? 0) > 0 && <div className="rl-neg">− {r.survivalDestroyed} hrane</div>}
            {(r.weaponsDestroyed ?? 0) > 0  && <div className="rl-neg">− {r.weaponsDestroyed} orožja</div>}
            {(r.materialDestroyed ?? 0) > 0 && <div className="rl-neg">− {r.materialDestroyed} materiala</div>}
            {(r.wallsDestroyed ?? 0) > 0    && <div className="rl-neg">− {r.wallsDestroyed} obzidja</div>}
            {r.aiRobotsDestroyed > 0 && <div className="rl-pos">− {r.aiRobotsDestroyed} AI robotov</div>}
          </div>
        )}
        {s && (s.captured || s.effectivenessMult < 1.0) && (
          <div className="rl-section">
            <div className="rl-sec-title">🔭 Izvidniki</div>
            {s.captured ? (
              <>
                <div className="rl-outcome" style={{ color: '#cc4444' }}>UJETI</div>
                <div className="rl-neg">− {s.scoutsLost} izvidnikov</div>
                <div className="rl-odds dim small">donos × {s.effectivenessMult.toFixed(1)}</div>
              </>
            ) : (
              <>
                <div className="rl-outcome" style={{ color: '#cc8800' }}>DELNA MISIJA</div>
                <div className="rl-odds dim small">donos × {s.effectivenessMult.toFixed(1)}</div>
              </>
            )}
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

/** Pretvorba axial koord (q, r) v piksel (pointy-top heks). */
function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

function hexPath(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);  // pointy-top
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
}

/** Heks barvanje glede na researchProgress. */
function hexColorByProgress(p: number): { fill: string; stroke: string; labelColor: string } {
  if (p < 0.25)      return { fill: 'url(#hatch-red)',     stroke: '#3a1818', labelColor: '#5a2020' };
  if (p < 0.50)      return { fill: 'url(#hatch-redlt)',   stroke: '#5a2828', labelColor: '#7a3838' };
  if (p < 1.00)      return { fill: '#1a2024',             stroke: '#4a6080', labelColor: '#8aa4c0' };
  return                     { fill: '#0c1a30',            stroke: '#3377cc', labelColor: '#5aa0e0' };
}

const PATH_NEIGHBOR_DIRS = [
  { q: +1, r:  0 }, { q: +1, r: -1 }, { q:  0, r: -1 },
  { q: -1, r:  0 }, { q: -1, r: +1 }, { q:  0, r: +1 },
];
function areNeighbors(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return PATH_NEIGHBOR_DIRS.some(d => a.q + d.q === b.q && a.r + d.r === b.r);
}

/** Heksa mapa — z risanjem poti in vizualizacijo aktivnih odprav */
function HexMap({ tiles, draftPath, draftKind, plannedPaths, onPathClick, onWpSelect, selectedWpId, expeditions, wps, otherClans, drawingMode, camp, freePeople, onCampAdjust, onCampSet, repelProbability, rations, onRations, workshopObj, onWorkshop, researchObj, onResearch, workshop, research, pop, draftPeople, onDraftKind, onDraftPeople, onConfirmDraft, canConfirmDraft, draftAddDisabled }: {
  tiles: HexTile[];
  draftPath: Array<{ q: number; r: number }>;
  draftKind: 'scout' | 'attack';
  plannedPaths: Array<{ path: Array<{ q: number; r: number }>; kind: 'scout' | 'mission' }>;
  onPathClick: (tile: { q: number; r: number }) => void;
  onWpSelect: (wpId: string) => void;
  selectedWpId: string;
  expeditions: Expedition[];
  wps: AIWeakPoint[];
  otherClans: OtherClan[];
  drawingMode: boolean;
  camp: { defenders: number; researchers: number; workers: number; foragers: number };
  freePeople: number;
  onCampAdjust: (which: 'd' | 'f' | 'w' | 'r', delta: number) => void;
  onCampSet: (which: 'd' | 'f' | 'w' | 'r', value: number) => void;
  repelProbability: number;  // 0–1, za polnjenje obrambne linije
  rations: number; onRations: (n: number) => void;
  workshopObj: WorkshopObjective; onWorkshop: (o: WorkshopObjective) => void;
  researchObj: ResearchObjective; onResearch: (o: ResearchObjective) => void;
  workshop: { wallsBuilt: number; weaponProgress: number; wallProgress: number; artifactProgress: number; workers: number };
  research: { robotsLevel: number; robotsProgress: number; weaponLevel: number; weaponProgress: number; wallLevel: number; wallProgress: number; researchers: number };
  pop: { total: number; inCamp: number; away: number; free: number };
  draftPeople: number;
  onDraftKind: (k: 'scout' | 'attack') => void;
  onDraftPeople: (delta: number) => void;
  onConfirmDraft: () => void;
  canConfirmDraft: boolean;
  draftAddDisabled: boolean;
}) {
  const [selectedExpId, setSelectedExpId] = useState<string | null>(null);
  const [hoveredExpId, setHoveredExpId]   = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const popExpId = selectedExpId ?? hoveredExpId;
  const SIZE = 36;
  // Barve poti: odprava (izvid) = rumena, napad = rdeča
  const COL_EXP = '#ffd84a';
  const COL_ATK = '#cc3333';
  const draftColor = draftKind === 'attack' ? COL_ATK : COL_EXP;
  // Kamp = 3 hexagoni (zoni). Vsak je svoje območje.
  const CAMP_ZONES = [
    { q: 0, r: 3, icon: '🔬', label: 'RAZISKAVE', count: camp.researchers, color: '#3377cc', adj: 'r' as const },
    { q: 0, r: 4, icon: '🌾', label: 'PREHRANA',  count: camp.foragers,    color: '#6aa630', adj: 'f' as const },
    { q: 1, r: 4, icon: '🔨', label: 'DELAVNICE', count: camp.workers,     color: '#cc7733', adj: 'w' as const },
    { q: 1, r: 3, icon: '🛡️', label: 'OBRAMBA',   count: camp.defenders,   color: '#66aabb', adj: 'd' as const },
  ];
  const campZoneIds = new Set(CAMP_ZONES.map(z => `${z.q},${z.r}`));
  const CAMP_EXTENT = SIZE * 2.1;  // prostor za zunanje kontrolne gumbe okoli kampa
  const pts = tiles.map(t => hexToPixel(t.q, t.r, SIZE));
  let minX = Math.min(...pts.map(p => p.x)) - SIZE;
  let maxX = Math.max(...pts.map(p => p.x)) + SIZE;
  let minY = Math.min(...pts.map(p => p.y)) - SIZE;
  let maxY = Math.max(...pts.map(p => p.y)) + SIZE;
  // Razširi okvir, da je veliki kamp v celoti viden (ne odreže ga rob)
  const clanForBounds = tiles.find(t => t.isClanCamp);
  if (clanForBounds) {
    const cp = hexToPixel(clanForBounds.q, clanForBounds.r, SIZE);
    minX = Math.min(minX, cp.x - CAMP_EXTENT);
    maxX = Math.max(maxX, cp.x + CAMP_EXTENT);
    minY = Math.min(minY, cp.y - CAMP_EXTENT);
    maxY = Math.max(maxY, cp.y + CAMP_EXTENT);
  }
  const W = maxX - minX, H = maxY - minY;
  const shift = (p: { x: number; y: number }) => ({ x: p.x - minX, y: p.y - minY });

  const wpById: Record<string, AIWeakPoint> = {};
  for (const w of wps) wpById[w.id] = w;

  const inDraft = (t: HexTile) => draftPath.some(s => s.q === t.q && s.r === t.r);
  const draftIdx = (t: HexTile) => draftPath.findIndex(s => s.q === t.q && s.r === t.r);
  const lastStep = draftPath[draftPath.length - 1];

  // Trenutno pozicije aktivnih odprav (currentIndex tile)
  const expPositions = expeditions.filter(e => e.status === 'traveling')
    .map(e => ({ exp: e, tile: e.path[e.currentIndex] }));

  return (
    <div className="hex-map">
      {info && (
        <div className="map-info-pop" onClick={() => setInfo(null)}>
          <div className="map-info-box" onClick={e => e.stopPropagation()}>
            <button className="map-info-close" onClick={() => setInfo(null)}>✕</button>
            <p>{info}</p>
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="hex-svg">
        <defs>
          <pattern id="hatch-red" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#1a0808" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#3a1818" strokeWidth="2" />
          </pattern>
          <pattern id="hatch-redlt" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#1a1010" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#553030" strokeWidth="1.5" />
          </pattern>
        </defs>


        {tiles.map(t => {
          const id = tileId(t);
          if (campZoneIds.has(id)) return null;  // kamp zoni se izrišejo posebej
          const p = shift(hexToPixel(t.q, t.r, SIZE));
          const wp = t.hidesWeakPointId ? wpById[t.hidesWeakPointId] : undefined;
          const wpVisible = wp && t.researchProgress >= 0.50;

          let { fill, stroke, labelColor } = hexColorByProgress(t.researchProgress);
          let label = '';

          const clan = t.otherClanId ? otherClans.find(c => c.id === t.otherClanId) : undefined;
          const clanVisible = clan && t.researchProgress >= 0.50;

          if (t.isClanCamp) {
            fill = '#0a2018'; stroke = '#22aa88'; label = '⌂'; labelColor = '#66ccaa';
          } else if (t.isAICore) {
            fill = '#220606'; stroke = '#cc2222'; label = '☣'; labelColor = '#cc3333';
          } else if (clanVisible) {
            label = '⛺';
            if (clan!.allied) { labelColor = '#33cc88'; stroke = '#33cc88'; fill = '#0a1c14'; }
            else { labelColor = '#c0a050'; stroke = '#a08540'; fill = '#181408'; }
          } else if (t.researchProgress < 0.25) {
            label = '?';
          } else if (t.researchProgress < 0.50) {
            label = '·';
          } else {
            // raziskan
            label = wpVisible ? '◆' : '';
            if (wpVisible) {
              if (wp?.exploited) {
                label = '✓'; labelColor = '#22cc66'; stroke = '#22cc66';
                fill = '#0a1a0c';
              } else {
                labelColor = '#cc8800'; stroke = '#cc8800';
              }
            }
          }

          const isInDraft = inDraft(t);
          const isLast = lastStep && lastStep.q === t.q && lastStep.r === t.r;
          if (isInDraft) stroke = draftColor;

          const canClickDraw = drawingMode && !t.isClanCamp && !campZoneIds.has(id) && (
            (lastStep && areNeighbors(lastStep, t)) ||
            (draftPath.length <= 1 && CAMP_ZONES.some(z => areNeighbors(z, t))) ||  // izhod iz katerekoli kamp zone
            isLast
          );
          const canSelectWp = !!(wpVisible && wp && !wp.exploited && !canClickDraw);
          const isWpSelected = wp && wp.id === selectedWpId;
          if (isWpSelected) stroke = '#ffd84a';

          const handleClick = canClickDraw
            ? () => onPathClick({ q: t.q, r: t.r })
            : canSelectWp
              ? () => onWpSelect(wp!.id)
              : undefined;

          return (
            <g key={id}
               className={`hex-tile ${(canClickDraw || canSelectWp) ? 'clickable' : ''} ${isInDraft ? 'in-draft' : ''} ${isWpSelected ? 'wp-selected' : ''}`}
               onClick={handleClick}>
              <path d={hexPath(p.x, p.y, SIZE)} fill={fill} stroke={stroke}
                strokeWidth={isInDraft || isWpSelected ? 2.5 : 1} />
              {label && (
                <text x={p.x} y={p.y + 4} textAnchor="middle"
                  fontSize={t.isClanCamp || t.isAICore || wpVisible ? 22 : 18}
                  fill={labelColor} fontFamily="'Courier New', monospace"
                  fontWeight={t.isClanCamp || t.isAICore || wpVisible ? 'bold' : 'normal'}>
                  {label}
                </text>
              )}
              {/* WP ime pod diamond ikono — ko je razkrita */}
              {wpVisible && wp && (
                <text x={p.x} y={p.y + SIZE * 0.55} textAnchor="middle"
                  fontSize="7.5"
                  fill={wp.exploited ? '#22cc66' : isWpSelected ? '#ffd84a' : '#cc8800'}
                  fontFamily="'Courier New', monospace" fontWeight="bold"
                  textDecoration={wp.exploited ? 'line-through' : undefined}
                  style={{ pointerEvents: 'none' }}>
                  {wp.label.split(' ').slice(0, 2).join(' ').slice(0, 14)}
                </text>
              )}
              {/* UNIČENO badge nad ikono ko je wp exploited */}
              {wpVisible && wp?.exploited && (
                <text x={p.x} y={p.y - SIZE * 0.45} textAnchor="middle"
                  fontSize="6.5" fill="#22cc66"
                  fontFamily="'Courier New', monospace" fontWeight="bold"
                  style={{ pointerEvents: 'none', letterSpacing: '1px' }}>
                  UNIČENO
                </text>
              )}
              {/* Progress overlay: za delno raziskane prikaže koliko je raziskano */}
              {!t.isClanCamp && !t.isAICore && t.researchProgress > 0 && t.researchProgress < 1 && (
                <text x={p.x} y={p.y - SIZE * 0.45} textAnchor="middle"
                  fontSize="9" fill="#66aacc" fontFamily="'Courier New', monospace">
                  {Math.round(t.researchProgress * 100)}%
                </text>
              )}
              {/* Številka koraka v draft poti (majhna) */}
              {isInDraft && draftIdx(t) > 0 && (
                <>
                  <circle cx={p.x + SIZE * 0.52} cy={p.y - SIZE * 0.52} r="5.5" fill="#22ccff" opacity="0.9" />
                  <text x={p.x + SIZE * 0.52} y={p.y - SIZE * 0.52} textAnchor="middle" dominantBaseline="central"
                    fontSize="7" fill="#001018" fontWeight="bold" fontFamily="'Courier New', monospace" pointerEvents="none">
                    {draftIdx(t)}
                  </text>
                </>
              )}
              {/* CILJ oznaka, če je wp izbran */}
              {isWpSelected && (
                <g style={{ pointerEvents: 'none' }}>
                  <circle cx={p.x} cy={p.y - SIZE * 0.6} r="6" fill="#ffd84a">
                    <animate attributeName="opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite" />
                  </circle>
                  <text x={p.x} y={p.y - SIZE * 0.6 + 3} textAnchor="middle"
                    fontSize="8" fill="#000" fontWeight="bold" fontFamily="'Courier New', monospace">
                    !
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Aktivne odprave: prepotovana pot (polna) + preostala pot (črtkana) */}
        {expeditions.filter(e => e.status === 'traveling').map(e => {
          const color = e.kind === 'mission' ? COL_ATK : COL_EXP;
          return (
            <g key={`path_${e.id}`} className="path-lines" pointerEvents="none">
              {e.path.slice(0, -1).map((s, i) => {
                const a = shift(hexToPixel(s.q, s.r, SIZE));
                const b = shift(hexToPixel(e.path[i + 1].q, e.path[i + 1].r, SIZE));
                const isDone = i < e.currentIndex;
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={color}
                    strokeWidth={isDone ? 3 : 2.2}
                    strokeOpacity={isDone ? 1 : 0.7}
                    strokeDasharray={isDone ? undefined : '4 3'} />
                );
              })}
              {/* Označi cilj odprave */}
              {e.path.length > 0 && (() => {
                const t = e.path[e.path.length - 1];
                const p = shift(hexToPixel(t.q, t.r, SIZE));
                return (
                  <g>
                    <circle cx={p.x} cy={p.y - SIZE * 0.15} r="5" fill="none" stroke={color} strokeWidth="1.8" />
                    <circle cx={p.x} cy={p.y - SIZE * 0.15} r="2" fill={color} />
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Načrtovane (potrjene, a še ne sproženo) — odprava rumena, napad rdeč */}
        {plannedPaths.map((pp, pi) => {
          const pc = pp.kind === 'mission' ? COL_ATK : COL_EXP;
          return (
          <g key={`planned_${pi}`} className="path-lines" pointerEvents="none">
            {pp.path.slice(0, -1).map((s, i) => {
              const a = shift(hexToPixel(s.q, s.r, SIZE));
              const b = shift(hexToPixel(pp.path[i + 1].q, pp.path[i + 1].r, SIZE));
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={pc} strokeWidth="1.8" strokeDasharray="2 3" strokeOpacity="0.7" />;
            })}
            {pp.path.length > 0 && (() => {
              const t = pp.path[pp.path.length - 1];
              const p = shift(hexToPixel(t.q, t.r, SIZE));
              return <circle cx={p.x} cy={p.y} r="3.5" fill={pc} fillOpacity="0.7" />;
            })()}
          </g>
          );
        })}

        {/* Draft path (igralec gradi novo pot) — rumena za odpravo, rdeča za napad */}
        {draftPath.length > 1 && (
          <g className="path-lines" pointerEvents="none">
            {draftPath.slice(0, -1).map((s, i) => {
              const a = shift(hexToPixel(s.q, s.r, SIZE));
              const b = shift(hexToPixel(draftPath[i + 1].q, draftPath[i + 1].r, SIZE));
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={draftColor} strokeWidth="2.6" strokeDasharray="4 3" />;
            })}
          </g>
        )}

        {/* KAMP — obrambna linija okoli grozda, polna glede na verjetnost odbijanja */}
        {(() => {
          // Robovi heksa → sosednja smer (pointy-top)
          const edgeToDir = [ {q:+1,r:0}, {q:0,r:+1}, {q:-1,r:+1}, {q:-1,r:0}, {q:0,r:-1}, {q:+1,r:-1} ];
          const vtx = (cx: number, cy: number, k: number): [number, number] => {
            const a = (Math.PI / 180) * (60 * k - 30);
            return [cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a)];
          };
          // Zberi vse zunanje robove grozda
          const segs: Array<[[number,number],[number,number]]> = [];
          for (const z of CAMP_ZONES) {
            const p = shift(hexToPixel(z.q, z.r, SIZE));
            for (let k = 0; k < 6; k++) {
              const d = edgeToDir[k];
              const nb = `${z.q + d.q},${z.r + d.r}`;
              if (!campZoneIds.has(nb)) segs.push([vtx(p.x, p.y, k), vtx(p.x, p.y, (k + 1) % 6)]);
            }
          }
          const rp = Math.max(0, Math.min(1, repelProbability));
          const MAX_T = 12;                       // največja debelina obzidja (100 %)
          const wallT = Math.max(1, rp * MAX_T);  // dejanska debelina = sorazmerna z verjetnostjo
          // Zvezna barva: rdeča (0 %) → rumena (50 %) → zelena (100 %); vsak branilec malo premakne odtenek
          const repelColor = `hsl(${Math.round(rp * 120)}, 75%, 52%)`;
          return (
            <g className="camp-wall" pointerEvents="none">
              {/* Oznaka NAJVEČJE možne debeline (prosojno, v barvi verjetnosti) */}
              {segs.map((s, i) => (
                <line key={`wm${i}`} x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]}
                  stroke={repelColor} strokeWidth={MAX_T} strokeLinecap="round" strokeOpacity={0.18} />
              ))}
              {/* Dejanska debelina obzidja — raste do max pri 100 %, v barvi verjetnosti */}
              {segs.map((s, i) => (
                <line key={`wf${i}`} x1={s[0][0]} y1={s[0][1]} x2={s[1][0]} y2={s[1][1]}
                  stroke={repelColor} strokeWidth={wallT} strokeLinecap="round" />
              ))}
            </g>
          );
        })()}

        {/* KAMP — 4 hex zoni z +/- gumbi (tanke notranje obrobe) */}
        {CAMP_ZONES.map(z => {
          const p = shift(hexToPixel(z.q, z.r, SIZE));
          const zoneInfo =
            z.adj === 'f' ? 'Prehrana — nabiralci zbirajo hrano za kamp.' :
            z.adj === 'w' ? 'Delavnice — delavci izdelujejo orožje ali gradijo obzidje (porabijo material).' :
            z.adj === 'r' ? 'Raziskave — raziskovalci zbirajo intel in razkrivajo AI načrtovalno drevo.' :
            'Obramba — branilci ščitijo kamp pred napadi AI.';
          return (
            <g key={`camp_${z.q}_${z.r}`} className="camp-zone">
              <title>{zoneInfo}</title>
              {/* ozadje + tanka notranja obroba */}
              <path d={hexPath(p.x, p.y, SIZE)} fill="#0a1a14" stroke="#1a4a3a" strokeWidth="0.8" />
              {/* ikona + oznaka */}
              <text x={p.x} y={p.y - SIZE * 0.42} textAnchor="middle" fontSize="16">{z.icon}</text>
              {/* OBRAMBA: število obzidij vpisano v ščit (del ikone) */}
              {z.adj === 'd' && workshop.wallsBuilt > 0 && (
                <text x={p.x} y={p.y - SIZE * 0.40} textAnchor="middle" dominantBaseline="central"
                  fontSize="8" fill="#0a2a18" fontWeight="bold" fontFamily="'Courier New', monospace"
                  pointerEvents="none">{workshop.wallsBuilt}</text>
              )}
              <text x={p.x} y={p.y - SIZE * 0.12} textAnchor="middle" fontSize="8" fill="#a8bdaf"
                fontFamily="'Courier New', monospace" letterSpacing="0.5">{z.label}</text>
              {/* − število + (gumbi znotraj heksa, znaki centrirani) */}
              {(() => {
                const cy = p.y + SIZE * 0.16;   // bliže sredini, kjer je heks najširši
                const bx = SIZE * 0.46;          // znotraj apoteme (~0.87 R)
                return (
                  <>
                    <g className="cz-minus" style={{ cursor: 'pointer' }} onClick={() => onCampAdjust(z.adj, -1)}>
                      <title>Odstrani osebo iz: {z.label}</title>
                      <circle cx={p.x - bx} cy={cy} r="7.5" fill="#101a16" stroke={z.color} strokeWidth="1.2" />
                      <text x={p.x - bx} y={cy} textAnchor="middle" dominantBaseline="central"
                        fontSize="12" fill={z.color} fontWeight="bold" fontFamily="'Courier New', monospace">−</text>
                    </g>
                    <text x={p.x} y={cy} textAnchor="middle" dominantBaseline="central"
                      fontSize="14" fill={z.color} fontFamily="'Courier New', monospace" fontWeight="bold">{z.count}</text>
                    <g className="cz-plus" style={{ cursor: 'pointer' }} onClick={() => onCampAdjust(z.adj, +1)}>
                      <title>Dodaj osebo v: {z.label} (iz prostih)</title>
                      <circle cx={p.x + bx} cy={cy} r="7.5" fill="#101a16" stroke={z.color} strokeWidth="1.2" />
                      <text x={p.x + bx} y={cy} textAnchor="middle" dominantBaseline="central"
                        fontSize="12" fill={z.color} fontWeight="bold" fontFamily="'Courier New', monospace">+</text>
                    </g>
                    {/* Slider tik pod −število+ vrstico (nadomesti podčrtano črto) */}
                    {(() => {
                      const max = z.count + freePeople;
                      const pct = max > 0 ? (z.count / max) * 100 : 0;
                      return (
                        <foreignObject x={p.x - bx - 7.5} y={cy + 7} width={2 * bx + 15} height={16}>
                          <input type="range" min={0} max={max} value={z.count}
                            onChange={(e) => onCampSet(z.adj, parseInt(e.target.value))}
                            className="cz-slider"
                            style={{
                              ['--zc' as string]: z.color,
                              background: `linear-gradient(to right, ${z.color} 0%, ${z.color} ${pct}%, #1c2630 ${pct}%, #1c2630 100%)`,
                            }} />
                        </foreignObject>
                      );
                    })()}
                  </>
                );
              })()}
            </g>
          );
        })}

        {/* Populacija je prikazana v zgornji vrstici (top-bar). */}

        {/* Zunanji kontrolni gumbi vsake zone (na zunanji strani) */}
        {(() => {
          // Centroid kampa za določitev "zunanje" smeri
          const cs = CAMP_ZONES.map(z => shift(hexToPixel(z.q, z.r, SIZE)));
          const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length;
          const cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
          const RATIONS_EMOJI = [null, '💀', '🥄', '🍞', '🥗', '🥩'];

          return CAMP_ZONES.map(z => {
            const p = shift(hexToPixel(z.q, z.r, SIZE));
            let dx = p.x - cx, dy = p.y - cy;
            const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
            const px = -dy, py = dx;  // pravokotno za razporeditev gumbov
            // Definiraj gumbe glede na zono
            type Btn = { label: string; active: boolean; onClick: () => void; title: string; sub?: string; segments?: { done: number; next: number; total: number } };
            let btns: Btn[] = [];
            if (z.adj === 'f') {
              btns = [1,2,3,4,5].map(lvl => {
                const t = RATIONS[lvl];
                const popHint = t.popMin === 0 && t.popMax === 0 ? '±0' : `${t.popMin}…${t.popMax}`;
                return {
                  label: RATIONS_EMOJI[lvl]!, active: rations === lvl, onClick: () => onRations(lvl),
                  title: `Obroki: ${t.label} — hrana ×${t.foodMult}, moč ×${t.strengthMult}, ljudje ${popHint}`,
                  sub: rations === lvl ? `×${t.foodMult}` : undefined,  // količnik hrane le za izbrano
                };
              });
            } else if (z.adj === 'w') {
              btns = [
                { label: '⚔️', active: workshopObj === 'weapon', onClick: () => onWorkshop('weapon'),
                  title: 'Orožje: 6 delavec-mesecev + 1 material za 1 orožje. Vsak mesec napolni toliko segmentov, kolikor je delavcev.',
                  segments: {
                    done: workshop.weaponProgress,
                    next: workshopObj === 'weapon' && workshop.workers > 0
                      ? Math.min(6, workshop.weaponProgress + workshop.workers)
                      : workshop.weaponProgress,
                    total: 6 } },
                { label: '🧱', active: workshopObj === 'wall',   onClick: () => onWorkshop('wall'),
                  title: 'Obzidje: 12 delavec-mesecev + 4 materiala za 1 obzidje. Napredek se ohrani ob preklopu.',
                  segments: {
                    done: workshop.wallProgress,
                    next: workshopObj === 'wall' && workshop.workers > 0
                      ? Math.min(12, workshop.wallProgress + workshop.workers)
                      : workshop.wallProgress,
                    total: 12 } },
                { label: '💎', active: workshopObj === 'artifact', onClick: () => onWorkshop('artifact'),
                  title: 'Artefakt: 360 delavec-mesecev (30 let z 1 delavcem) + 20 materiala za 1 artefakt. Napredek se ohrani ob preklopu.',
                  segments: {
                    done: workshop.artifactProgress,
                    next: workshopObj === 'artifact' && workshop.workers > 0
                      ? Math.min(360, workshop.artifactProgress + workshop.workers)
                      : workshop.artifactProgress,
                    total: 360 } },
              ];
            } else if (z.adj === 'r') {
              const R = 120;  // raziskovalec-mesecev na stopnjo
              const seg = (obj: ResearchObjective, prog: number) => ({
                done: prog,
                next: researchObj === obj && research.researchers > 0 ? Math.min(R, prog + research.researchers) : prog,
                total: R,
              });
              const wpnLocked = research.weaponLevel >= research.robotsLevel;
              const wallLocked = research.wallLevel >= research.robotsLevel;
              btns = [
                { label: '🤖', active: researchObj === 'robots', onClick: () => onResearch('robots'),
                  title: `Roboti Lv${research.robotsLevel}: odkrivanje šibkih točk, odklene Orožje/Obzidje. 120 razisk.-mes. na stopnjo.`,
                  segments: seg('robots', research.robotsProgress) },
                { label: wpnLocked ? '🔒' : '⚔️', active: researchObj === 'weapon', onClick: () => onResearch('weapon'),
                  title: `Orožje Lv${research.weaponLevel}: vsaka stopnja podvoji napad (120 razisk.-mes.).${wpnLocked ? ` Zaklenjeno — najprej Roboti ${research.weaponLevel + 1}.` : ''}`,
                  segments: seg('weapon', research.weaponProgress) },
                { label: wallLocked ? '🔒' : '🧱', active: researchObj === 'wall', onClick: () => onResearch('wall'),
                  title: `Obzidje Lv${research.wallLevel}: vsaka stopnja podvoji obrambo (120 razisk.-mes.).${wallLocked ? ` Zaklenjeno — najprej Roboti ${research.wallLevel + 1}.` : ''}`,
                  segments: seg('wall', research.wallProgress) },
              ];
            }
            if (!btns.length) return null;
            // Za raziskave premaknemo gumbe nižje na levi stranici (down-left),
            // za delavnico naravnost navzdol (na dno karte).
            let bdx = dx, bdy = dy;
            if (z.adj === 'r') {
              bdx = -Math.abs(dx);            // levo
              bdy = Math.abs(dy);             // navzdol (nižje)
              const bl = Math.hypot(bdx, bdy) || 1; bdx /= bl; bdy /= bl;
            } else if (z.adj === 'w') {
              bdx = 0; bdy = 1;               // naravnost navzdol
            }
            const hasSeg = btns.some(b => b.segments);
            const pushOut = hasSeg ? 1.06 : 1.02;
            const baseX = p.x + bdx * SIZE * pushOut;
            const baseY = p.y + bdy * SIZE * pushOut;
            const lpx = -bdy, lpy = bdx;
            const sp = hasSeg ? 22 : 15;
            return (
              <g key={`ctrl_${z.q}_${z.r}`}>
                {btns.map((b, i) => {
                  const off = (i - (btns.length - 1) / 2) * sp;
                  const bxp = baseX + lpx * off, byp = baseY + lpy * off;
                  return (
                    <g key={i} style={{ cursor: 'pointer', opacity: b.active ? 1 : 0.45 }}
                       onClick={(e) => { e.stopPropagation(); b.onClick(); }}>
                      <title>{b.title}</title>
                      {/* Aktivni gumb dobi rahel sij za boljšo opaznost */}
                      {b.active && (
                        <circle cx={bxp} cy={byp} r={b.segments ? 13 : 11}
                          fill={z.color} opacity="0.15" />
                      )}
                      {/* Ikona z integriranim okvirom: brez ločenega obroba, če ima segmente */}
                      <circle cx={bxp} cy={byp} r={b.segments ? 8 : 7.5}
                        fill={b.active ? '#0d1612' : '#0a0a0a'}
                        stroke={b.segments ? 'none' : z.color}
                        strokeWidth={b.active ? 2.5 : 1} />
                      {/* Segmenti / lok kot obroba ikone — done = polno, next-month napoved = svetlo */}
                      {b.segments && (() => {
                        const { done, next, total } = b.segments;
                        const R = 9.5;
                        // Pri velikih total (npr. artefakt 360) prikažemo zvezna loka, ne 360 segmentov.
                        if (total > 24) {
                          const C = 2 * Math.PI * R;
                          const doneFrac = Math.max(0, Math.min(1, done / total));
                          const nextFrac = Math.max(0, Math.min(1, next / total));
                          return (
                            <g pointerEvents="none">
                              {/* podlaga (temno) */}
                              <circle cx={bxp} cy={byp} r={R} fill="none" stroke="#2a2a2a" strokeWidth="3" />
                              {/* napoved (svetlo) */}
                              {nextFrac > doneFrac && (
                                <circle cx={bxp} cy={byp} r={R} fill="none" stroke={z.color} strokeWidth="3"
                                  strokeDasharray={`${C * nextFrac} ${C}`}
                                  strokeDashoffset={C / 4}
                                  transform={`rotate(-90 ${bxp} ${byp})`} opacity="0.4" />
                              )}
                              {/* dosežen napredek (polno) */}
                              {doneFrac > 0 && (
                                <circle cx={bxp} cy={byp} r={R} fill="none" stroke={z.color} strokeWidth="3"
                                  strokeDasharray={`${C * doneFrac} ${C}`}
                                  strokeDashoffset={C / 4}
                                  transform={`rotate(-90 ${bxp} ${byp})`} />
                              )}
                            </g>
                          );
                        }
                        const gap = total > 4 ? 0.16 : 0.22;
                        const seg = (2 * Math.PI) / total;
                        const arcs: JSX.Element[] = [];
                        for (let s = 0; s < total; s++) {
                          const startA = -Math.PI / 2 + s * seg + gap / 2;
                          const endA   = -Math.PI / 2 + (s + 1) * seg - gap / 2;
                          const sx = bxp + R * Math.cos(startA);
                          const sy = byp + R * Math.sin(startA);
                          const ex = bxp + R * Math.cos(endA);
                          const ey = byp + R * Math.sin(endA);
                          const large = (endA - startA) > Math.PI ? 1 : 0;
                          const state: 'done' | 'next' | 'empty' =
                            s < done ? 'done' : s < next ? 'next' : 'empty';
                          const color = state === 'empty' ? '#2a2a2a' : z.color;
                          const opacity = state === 'next' ? 0.4 : 1;
                          arcs.push(
                            <path key={s} d={`M${sx} ${sy} A${R} ${R} 0 ${large} 1 ${ex} ${ey}`}
                              fill="none" stroke={color} strokeWidth="3"
                              strokeLinecap="round" opacity={opacity} />
                          );
                        }
                        return <g pointerEvents="none">{arcs}</g>;
                      })()}
                      <text x={bxp} y={byp} textAnchor="middle" dominantBaseline="central"
                        fontSize="10" style={{ pointerEvents: 'none' }}>{b.label}</text>
                      {b.sub && (
                        <text x={bxp} y={byp + 12} textAnchor="middle" dominantBaseline="central"
                          fontSize="6.5" fill={z.color} fontWeight="bold"
                          fontFamily="'Courier New', monospace" style={{ pointerEvents: 'none' }}>{b.sub}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          });
        })()}

        {/* Aktivne odprave kot ikone — hover + klik za info */}
        {expPositions.map(({ exp, tile }) => {
          if (!tile) return null;
          const p = shift(hexToPixel(tile.q, tile.r, SIZE));
          const color = exp.kind === 'mission' ? COL_ATK : COL_EXP;
          const isActive = popExpId === exp.id;
          return (
            <g key={exp.id} className="exp-marker"
               onMouseEnter={() => setHoveredExpId(exp.id)}
               onMouseLeave={() => setHoveredExpId(null)}
               onClick={(e) => { e.stopPropagation(); setSelectedExpId(selectedExpId === exp.id ? null : exp.id); }}>
              <circle cx={p.x} cy={p.y + SIZE * 0.45} r={isActive ? 14 : 11}
                fill={color} stroke={isActive ? '#fff' : '#000'} strokeWidth="1.5" />
              <text x={p.x} y={p.y + SIZE * 0.45 + 4} textAnchor="middle"
                fontSize="10" fill="#000" fontWeight="bold" fontFamily="'Courier New', monospace"
                style={{ pointerEvents: 'none' }}>
                {exp.assigned}
              </text>
            </g>
          );
        })}

        {/* ─── Kontrole odprave na ZADNJEM heksu poti ─── */}
        {drawingMode && draftPath.length >= 2 && lastStep && (() => {
          const lp = shift(hexToPixel(lastStep.q, lastStep.r, SIZE));
          const cx = lp.x, cy = lp.y - SIZE * 1.15;  // nad zadnjim heksom
          type DraftControlIcon = 'scout' | 'attack' | 'minus' | 'plus' | 'confirm';
          const DraftIcon = ({ icon, color }: { icon: DraftControlIcon; color: string }) => {
            if (icon === 'scout') {
              return (
                <g transform="translate(-6 -6)" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="5" r="3.2" />
                  <circle cx="11" cy="5" r="3.2" />
                  <path d="M7.4 5h1.2M3.6 8.2 2 12M12.4 8.2 14 12" />
                </g>
              );
            }
            if (icon === 'attack') {
              return (
                <g transform="translate(-6 -6)" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 2l9 9M12 2 3 11M2.2 12.8 4.4 10.6M13.8 12.8 11.6 10.6" />
                  <path d="M3 2h3M12 2H9" />
                </g>
              );
            }
            if (icon === 'minus') {
              return <path d="M-4 0h8" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />;
            }
            if (icon === 'plus') {
              return (
                <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
                  <path d="M-4 0h8" />
                  <path d="M0 -4v8" />
                </g>
              );
            }
            return <path d="M-4 .2-1.2 3.2 4.8-4" fill="none" stroke={color} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />;
          };
          const Btn = ({ x, y, r = 9, fill, stroke, icon, iconColor = '#f5f5f5', disabled, onClick, title }:
            { x: number; y: number; r?: number; fill: string; stroke: string; icon: DraftControlIcon; iconColor?: string; disabled?: boolean; onClick: () => void; title: string }) => (
            <g style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 }}
               onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}>
              <title>{title}</title>
              <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth="1.5" />
              <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
                <DraftIcon icon={icon} color={iconColor} />
              </g>
            </g>
          );
          return (
            <g className="draft-controls">
              {/* vrsta 1: izbira tipa odprave */}
              <Btn x={cx - 13} y={cy - 16} fill={draftKind === 'scout' ? '#3a2a00' : '#0a0a0a'} stroke={draftKind === 'scout' ? '#ffd84a' : '#555'}
                icon="scout" iconColor={draftKind === 'scout' ? '#ffd84a' : '#b8b8b8'} onClick={() => onDraftKind('scout')} title="Izvidniki (raziskovanje)" />
              <Btn x={cx + 13} y={cy - 16} fill={draftKind === 'attack' ? '#3a1010' : '#0a0a0a'} stroke={draftKind === 'attack' ? '#cc3333' : '#555'}
                icon="attack" iconColor={draftKind === 'attack' ? '#ff7777' : '#b8b8b8'} onClick={() => onDraftKind('attack')} title="Napad" />
              {/* vrsta 2: število ljudi −/+ in potrdi */}
              <Btn x={cx - 26} y={cy + 7} r={8} fill="#0a0a0a" stroke="#888" icon="minus" disabled={draftPeople <= 1}
                onClick={() => onDraftPeople(-1)} title="Manj ljudi" />
              <circle cx={cx} cy={cy + 7} r={11} fill="#11171f" stroke={draftKind === 'attack' ? '#cc3333' : '#ffd84a'} strokeWidth="1.5" />
              <text x={cx} y={cy + 7} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="bold" fill="#fff" style={{ pointerEvents: 'none' }}>{draftPeople}</text>
              <Btn x={cx + 26} y={cy + 7} r={8} fill="#0a0a0a" stroke="#888" icon="plus" disabled={draftAddDisabled}
                onClick={() => onDraftPeople(1)} title="Več ljudi" />
              {/* potrdi */}
              <Btn x={cx} y={cy + 30} r={9} fill={canConfirmDraft ? '#0f2a14' : '#0a0a0a'} stroke={canConfirmDraft ? '#66cc88' : '#555'}
                icon="confirm" iconColor={canConfirmDraft ? '#8df0a5' : '#b8b8b8'} disabled={!canConfirmDraft} onClick={onConfirmDraft} title="Pošlji odpravo" />
            </g>
          );
        })()}
      </svg>

      {/* Popup za izbrano/hovered odpravo */}
      {popExpId && (() => {
        const exp = expeditions.find(e => e.id === popExpId);
        if (!exp) return null;
        const tile = exp.path[exp.currentIndex];
        const target = exp.path[exp.path.length - 1];
        const stepsLeft = exp.path.length - 1 - exp.currentIndex;
        const monthsLeft = stepsLeft;  // 1 korak = 1 mesec
        const color = exp.kind === 'mission' ? COL_ATK : COL_EXP;
        // Pozicija popupa: nad heksom kjer je odprava
        const p = shift(hexToPixel(tile.q, tile.r, SIZE));
        const popLeft = (p.x / W) * 100;
        const popTop  = (p.y / H) * 100;
        return (
          <div className="exp-popup" style={{ left: `${popLeft}%`, top: `${popTop}%`, borderColor: color }}
               onClick={e => e.stopPropagation()}>
            <div className="ep-head" style={{ color }}>
              <span>{exp.kind === 'mission' ? '🎯 MISIJA' : '🔭 IZVIDNICA'}</span>
              {selectedExpId === exp.id && (
                <button className="ep-close" onClick={() => setSelectedExpId(null)}>✕</button>
              )}
            </div>
            <div className="ep-row"><span className="dim small">Ljudi:</span><b>{exp.assigned}</b></div>
            <div className="ep-row"><span className="dim small">Lokacija:</span><b>({tile.q},{tile.r})</b></div>
            <div className="ep-row"><span className="dim small">Cilj:</span><b>({target.q},{target.r})</b></div>
            <div className="ep-row"><span className="dim small">Napredek:</span>
              <b>{exp.currentIndex} / {exp.path.length - 1} korakov</b>
            </div>
            <div className="ep-row"><span className="dim small">Vrnitev v:</span>
              <b style={{ color: '#cc8800' }}>{monthsLeft} mesec(ev)</b>
            </div>
            <div className="ep-row"><span className="dim small">Mesecev na poti:</span><b>{exp.monthsElapsed}</b></div>
            <div className="ep-row"><span className="dim small">Obroki:</span>
              <b>{RATIONS[exp.rations]?.emoji ?? '🍽'} {RATIONS[exp.rations]?.label ?? 'Normalno'}</b>
            </div>
            {exp.encountersLog.length > 0 && (
              <div className="ep-events">
                <div className="dim small" style={{ marginTop: 4, marginBottom: 3 }}>Zadnji dogodki:</div>
                {exp.encountersLog.slice(-3).map((ev, i) => (
                  <div key={i} className="small">{ev}</div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** Izbira cilja delavnice (delavci) */
function WorkshopSelector({ value, onChange, weaponLevel, wallLevel }: { value: WorkshopObjective; onChange: (o: WorkshopObjective) => void; weaponLevel: number; wallLevel: number }) {
  const opts: Array<{ id: WorkshopObjective; icon: string; label: string; color: string; desc: string; research?: number }> = [
    { id: 'weapon',   icon: '⚔️', label: 'Orožje',   color: '#cc4433', desc: '6 delavec-mesecev za 1 orožje (−1 material). Napredek se ohrani ob preklopu.', research: weaponLevel },
    { id: 'wall',     icon: '🧱', label: 'Obzidje', color: '#aabb88', desc: '12 delavec-mesecev za 1 obzidje (−4 materiala). +20 % obrambe. Ohrani napredek.', research: wallLevel },
    { id: 'artifact', icon: '💎', label: 'Artefakt', color: '#ffd84a', desc: '360 delavec-mesecev (30 let z 1 delavcem) za 1 artefakt (−20 materiala). Ohrani napredek.' },
  ];
  const sel = opts.find(o => o.id === value);
  return (
    <div className="scout-objectives compact">
      <div className="so-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {opts.map(o => (
          <button key={o.id} className={`so-btn ${value === o.id ? 'sel' : ''}`}
            style={value === o.id ? { borderColor: o.color, color: o.color } : {}}
            onClick={() => onChange(o.id)} title={`${o.label} — ${o.desc}${o.research !== undefined ? ` · raziskava Lv${o.research} (napad/obramba ×${Math.pow(2, o.research)})` : ''}`}>
            <span className="so-icon">{o.icon}</span>
            <span className="so-label-mini">{o.label}</span>
            {o.research !== undefined && <span className="so-research-lvl" title={`Stopnja raziskanosti: ${o.research} (×${Math.pow(2, o.research)})`}>🔬 Lv{o.research}</span>}
          </button>
        ))}
      </div>
      {sel && <div className="so-desc-line dim small">{sel.desc}</div>}
    </div>
  );
}

/** Izbira cilja raziskave (raziskovalci) */
function ResearchSelector({ value, onChange, robotsLevel, weaponLevel, wallLevel }: { value: ResearchObjective; onChange: (o: ResearchObjective) => void; robotsLevel: number; weaponLevel: number; wallLevel: number }) {
  const opts: Array<{ id: ResearchObjective; icon: string; label: string; color: string; desc: string; lvl: number; locked: boolean }> = [
    { id: 'robots', icon: '🤖', label: RESEARCH_LEVEL_NAMES.robots[Math.min(robotsLevel, 2)] ?? 'Roboti', color: '#cc8800', desc: 'Raziskave ustvarjajo intel in odpirajo AI drevo. Mehanske šibkosti odklenejo tehnologijo.', lvl: robotsLevel, locked: false },
    { id: 'weapon', icon: '⚔️', label: RESEARCH_LEVEL_NAMES.weapon[Math.min(weaponLevel, 2)] ?? 'Orožje', color: '#cc4433', desc: 'Vsaka stopnja podvoji prispevek orožja. Zaklenjeno z mehanskimi šibkostmi AI.', lvl: weaponLevel, locked: weaponLevel >= robotsLevel },
    { id: 'wall',   icon: '🧱', label: RESEARCH_LEVEL_NAMES.wall[Math.min(wallLevel, 2)] ?? 'Obzidje', color: '#aabb88', desc: 'Vsaka stopnja podvoji učinek obzidja. Zaklenjeno z mehanskimi šibkostmi AI.', lvl: wallLevel, locked: wallLevel >= robotsLevel },
  ];
  const sel = opts.find(o => o.id === value);
  return (
    <div className="scout-objectives compact">
      <div className="so-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {opts.map(o => (
          <button key={o.id} className={`so-btn ${value === o.id ? 'sel' : ''}`}
            style={value === o.id ? { borderColor: o.color, color: o.color } : {}}
            onClick={() => onChange(o.id)} title={`${o.label} — ${o.desc}`}>
            <span className="so-icon">{o.icon}</span>
            <span className="so-label-mini">{o.label} Lv{o.lvl}{o.locked ? ' 🔒' : ''}</span>
          </button>
        ))}
      </div>
      {sel && <div className="so-desc-line dim small">{sel.desc}{sel.locked ? ` · 🔒 najprej razišči Robote ${sel.lvl + 1}` : ''}</div>}
    </div>
  );
}

/** Kompaktni rations selector — 5 emoji gumbov + razlaga izbire */
function RationsMini({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const r = RATIONS[value];
  const popHint = r.popMin === 0 && r.popMax === 0 ? '±0' :
                  r.popMin === r.popMax ? `${r.popMin > 0 ? '+' : ''}${r.popMin}` :
                  `${r.popMin > 0 ? '+' : ''}${r.popMin}…${r.popMax > 0 ? '+' : ''}${r.popMax}`;
  const popColor = r.popMin < 0 ? '#cc4444' : r.popMin > 0 ? '#22cc88' : '#888';
  return (
    <div className="rations-mini">
      <div className="rm-row">
        {[1,2,3,4,5].map(lvl => {
          const t = RATIONS[lvl];
          return (
            <button key={lvl}
              className={`rm-btn ${value === lvl ? 'sel' : ''}`}
              style={value === lvl ? { borderColor: t.color, color: t.color } : {}}
              onClick={() => onChange(lvl)}
              title={`${t.label} — hrana ×${t.foodMult}, moč ×${t.strengthMult}`}>
              <span>{t.emoji}</span>
            </button>
          );
        })}
      </div>
      <div className="rm-info">
        <span style={{ color: r.color }}>{r.label}</span>
        <span className="dim small"> · moč </span>
        <b style={{ color: r.color }}>×{r.strengthMult}</b>
        <span className="dim small"> · ljudje </span>
        <b style={{ color: popColor }}>{popHint}</b>
      </div>
    </div>
  );
}

/** Fazni prehod — banner ko AI preide v naslednjo fazo */
function PhaseTransitionBanner({ fromPhase, toPhase, narrative, onClose }: {
  fromPhase: keyof typeof PHASE; toPhase: keyof typeof PHASE; narrative: string; onClose: () => void;
}) {
  const from = PHASE[fromPhase];
  const to = PHASE[toPhase];
  return (
    <div className="ptb-overlay" onClick={onClose}>
      <div className="ptb-card" style={{ borderColor: to.color }} onClick={e => e.stopPropagation()}>
        <div className="ptb-head">
          <span className="ptb-tag dim">FAZNI PREHOD</span>
          <button className="ptb-close" onClick={onClose}>✕</button>
        </div>
        <div className="ptb-flow">
          <div className="ptb-side">
            <div className="ptb-num" style={{ color: from.color, borderColor: from.color }}>{from.num}</div>
            <div className="ptb-label dim">{from.full}</div>
            <div className="ptb-state dim small">ZAKLJUČENA</div>
          </div>
          <div className="ptb-arrow" style={{ color: to.color }}>►►</div>
          <div className="ptb-side">
            <div className="ptb-num" style={{ color: to.color, borderColor: to.color }}>{to.num}</div>
            <div className="ptb-label" style={{ color: to.color }}>{to.full}</div>
            <div className="ptb-state" style={{ color: to.color }}>SE ZAČNE</div>
          </div>
        </div>
        <p className="ptb-narrative">{narrative}</p>
        <button className="ptb-continue" style={{ borderColor: to.color, color: to.color }} onClick={onClose}>
          Nadaljuj →
        </button>
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

/** Pomanjša vsebino, da se vedno prilega višini (brez scrollanja). */
function FitScale({ children, deps }: { children: React.ReactNode; deps?: unknown[] }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const recompute = () => {
      const o = outer.current, n = inner.current;
      if (!o || !n) return;
      const iw = n.scrollWidth;
      const ow = o.clientWidth;
      if (iw <= 0) return;
      // Prilagodi le po ŠIRINI (besedilo ostane berljivo); previsoka vsebina se drsi navpično.
      const s = Math.min(1, ow / iw);
      setScale(s > 0.6 ? s : 0.6);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <div ref={outer} className="fit-outer">
      <div ref={inner} className="fit-inner"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` }}>
        {children}
      </div>
    </div>
  );
}

// ─── Glavna komponenta ────────────────────────────────────────────────────────

export default function App() {
  const [game,       setGame]       = useState<GameState | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [axis,       setAxis]       = useState<HumanAxis>('obzidje');
  const [combatants,   setCombatants]   = useState(0);
  const [defenders,    setDefenders]    = useState(15);
  const [foragers,     setForagers]     = useState(20);
  const [workers,      setWorkers]      = useState(5);   // DELAVCI — delavnica
  const [researchers,  setResearchers]  = useState(5);   // RAZISKOVALCI — raziskava
  const [workshopObj,  setWorkshopObj]  = useState<WorkshopObjective>('weapon');
  const [researchObj,  setResearchObj]  = useState<ResearchObjective>('robots');
  const [missions,     setMissions]     = useState<Record<string, number>>({});
  const [missionR,     setMissionR]     = useState<Record<string, number>>({});
  const [scoutTargets, setScoutTargets] = useState<Set<string>>(new Set());
  const [eventLog,     setEventLog]     = useState<EventEntry[]>([]);
  const [tab,          setTab]          = useState<'defense' | 'food' | 'workshop' | 'research' | 'map' | 'attack' | 'log'>('food');
  const [leftOpen,     setLeftOpen]     = useState(() => typeof window !== 'undefined' ? window.innerWidth > 820 : true);   // panel: na telefonu privzeto zaprt (karta vidna)
  const [rightOpen,    setRightOpen]    = useState(true);   // desni dnevnik odprt/zaprt
  const [draftPath,    setDraftPath]    = useState<Array<{ q: number; r: number }>>([]);
  const [draftPeople,  setDraftPeople]  = useState(5);
  const [draftRations, setDraftRations] = useState(3);  // ločeni obroki za odpravo
  const [draftKind,    setDraftKind]    = useState<'scout' | 'attack'>('scout');
  const [draftStealth, setDraftStealth] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showRules,    setShowRules]    = useState(false);
  const [appMenuOpen,  setAppMenuOpen]  = useState(false);
  const [pendingExpeditions, setPendingExpeditions] = useState<NewExpeditionInput[]>([]);
  const [artifactTargetWp, setArtifactTargetWp] = useState<string>('');
  const [targetWP,   setTargetWP]   = useState('');
  const [rations,    setRations]    = useState(3);
  const [odds,         setOdds]         = useState<OddsPreview | null>(null);
  const [justRevealed, setJustRevealed] = useState<Set<string>>(new Set());
  const [phaseTrans,   setPhaseTrans]   = useState<{ from: AIPhase; to: AIPhase; narrative: string } | null>(null);
  const prevPhaseRef = useRef<AIPhase | null>(null);

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) getGame(id).then(setGame).catch(() => localStorage.removeItem(STORAGE_KEY));
  }, []);

  // Reveal flash — osvetli vozlišča, ki so bila pravkar odkrita
  useEffect(() => {
    if (!game?.lastRoundLog || game.lastRoundLog.revealedNodes.length === 0) return;
    setJustRevealed(new Set(game.lastRoundLog.revealedNodes));
    const t = setTimeout(() => setJustRevealed(new Set()), 1600);
    return () => clearTimeout(t);
  }, [game?.lastRoundLog]);

  // Fazni prehod — ko se game.phase spremeni, pokaži banner
  useEffect(() => {
    if (!game) return;
    if (prevPhaseRef.current && prevPhaseRef.current !== game.phase) {
      setPhaseTrans({
        from: prevPhaseRef.current,
        to: game.phase,
        narrative: game.lastRoundLog?.narrative ?? 'AI je prešel v naslednjo fazo svojega načrta.',
      });
    }
    prevPhaseRef.current = game.phase;
  }, [game?.phase]);

  // Pot vedno začni iz klanovega kampa
  useEffect(() => {
    if (!game) return;
    if (draftPath.length === 0) {
      const clan = game.mapTiles?.find(t => t.isClanCamp);
      if (clan) setDraftPath([{ q: clan.q, r: clan.r }]);
    }
  }, [game?.mapTiles]);

  // Akumuliraj log dogodkov — vsak nov mesec doda vnos z dogodki + poračunom + ikone
  useEffect(() => {
    if (!game?.lastRoundLog) return;
    const log = game.lastRoundLog;
    setEventLog(prev => {
      if (prev[0] && prev[0].round === log.round && prev[0].phase === log.phase) return prev;

      const ledger: LedgerItem[] = [];
      if (log.populationDelta !== 0)
        ledger.push({ icon: '👥', label: 'populacija', value: log.populationDelta });
      const dS = log.resourceDelta?.survival     ?? 0;
      const dC = log.resourceDelta?.combat       ?? 0;
      const dI = log.resourceDelta?.intelligence ?? 0;
      const dMat = (log.resourceDelta as { material?: number })?.material ?? 0;
      if (dS !== 0) ledger.push({ icon: '🍞', label: 'hrana',  value: dS });
      if (dC !== 0) ledger.push({ icon: '⚔',  label: 'orožje', value: dC });
      if (dMat !== 0) ledger.push({ icon: '⚙', label: 'material', value: dMat });
      if (dI !== 0) ledger.push({ icon: '👁',  label: 'intel',  value: dI });
      const robotsKilled = (log.combat?.aiRobotsDestroyed ?? 0) + (log.raid?.aiRobotsDestroyed ?? 0);
      if (robotsKilled) ledger.push({ icon: '🤖', label: 'AI roboti', value: -robotsKilled });
      if (log.raid?.weaponsDestroyed)
        ledger.push({ icon: '💥', label: 'uničeno orožje', value: -log.raid.weaponsDestroyed });
      if (log.raid?.wallsDestroyed)
        ledger.push({ icon: '🧱', label: 'porušeno obzidje', value: -log.raid.wallsDestroyed });
      if (log.revealedNodes?.length)
        ledger.push({ icon: '🔍', label: 'AI vozlišča', value: log.revealedNodes.length });
      if (log.aiKnowledgeDelta && Math.round(log.aiKnowledgeDelta * 100) !== 0)
        ledger.push({ icon: '🕵', label: 'AI ve o nas %', value: Math.round(log.aiKnowledgeDelta * 100) });
      if (log.clanActivityDelta && Math.round(log.clanActivityDelta * 100) !== 0)
        ledger.push({ icon: '🌍', label: 'klani %', value: Math.round(log.clanActivityDelta * 100) });

      // Ključne ikone za hitri pregled v traku
      const icons: KeyIcon[] = [];
      const outcomeColors = { victory: '#22cc66', partial: '#cc8800', defeat: '#cc4444', annihilation: '#cc2222' } as const;
      if (log.combat) {
        icons.push({ icon: '⚔', color: outcomeColors[log.combat.outcome], title: `Napad: ${log.combat.outcome}` });
      }
      if (log.raid?.occurred && log.raid.outcome) {
        icons.push({ icon: '🛡', color: outcomeColors[log.raid.outcome], title: `Raid: ${log.raid.outcome}` });
      }
      if (log.scout?.captured) icons.push({ icon: '🔭', color: '#cc4444', title: 'Izvidniki ujeti' });
      if (log.revealedNodes?.length) icons.push({ icon: '🔍', color: '#22cc66', title: `${log.revealedNodes.length} vozlišč razkritih` });
      if (/✓ Izvidniška odprava dospela/.test(log.narrative)) icons.push({ icon: '✓', color: '#22ccff', title: 'Odprava dospela' });
      if (/💥 ŠIBKA TOČKA UNIČENA/.test(log.narrative)) icons.push({ icon: '💥', color: '#ffd84a', title: 'ŠIBKA TOČKA UNIČENA' });
      if (/🎯 Misija .* uspela/.test(log.narrative)) icons.push({ icon: '🎯', color: '#22cc66', title: 'Misija uspela' });
      if (/☠ Odprava izgubljena/.test(log.narrative)) icons.push({ icon: '☠', color: '#cc2222', title: 'Odprava izgubljena' });
      if (/Nova faza/.test(log.narrative)) icons.push({ icon: '🌑', color: '#cc8800', title: 'Fazni prehod' });
      if ((game.consecutiveStarvationMonths ?? 0) > 0) icons.push({ icon: '💀', color: '#cc2222', title: 'Lakota' });

      const ourKnow = game.aiInsight ?? calcOurKnowledge(game.aiTree);
      const aiKnow  = game.aiKnowledge;

      const entry: EventEntry = {
        round: log.round, phase: log.phase,
        narrative: log.narrative, ledger, icons,
        ourKnow, aiKnow,
        ts: Date.now(),
      };
      return [entry, ...prev].slice(0, 50);
    });
  }, [game?.totalRounds]);

  // Preview odds — game?.totalRounds zagotovi ponoven klic po vsaki rundi
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const t = setTimeout(() => {
      previewOdds(game.runId, { axis, combatants, defenders, foragers, workers, researchers,
        workshopObjective: workshopObj, researchObjective: researchObj, rations }).then(setOdds).catch(() => setOdds(null));
    }, 250);
    return () => clearTimeout(t);
  }, [game?.runId, game?.totalRounds, axis, combatants, defenders, foragers, workers, researchers, workshopObj, researchObj, rations]);

  const handleNew = async () => {
    setLoading(true);
    try {
      const g = await createGame();
      setGame(g);
      localStorage.setItem(STORAGE_KEY, g.runId);
      setAxis('obzidje'); setCombatants(0); setDefenders(15); setForagers(20); setWorkers(5); setResearchers(5); setWorkshopObj('weapon'); setResearchObj('robots'); setTargetWP(''); setRations(3); setMissions({}); setMissionR({}); setScoutTargets(new Set()); setEventLog([]); setDraftPath([]); setDraftPeople(5); setDraftRations(3); setPendingExpeditions([]); setArtifactTargetWp('');
    } finally { setLoading(false); }
  };

  const handleRound = async () => {
    if (!game || loading) return;
    setLoading(true);
    try {
      const newExps: NewExpeditionInput[] = [...pendingExpeditions];
      // Če uporabnik ni potrdil tekoče poti a ima veljaven draft, ga pošlji tudi (z vrsto trenutnega zavihka)
      if (draftPath.length >= 2 && draftPeople > 0) {
        newExps.push(buildDraftInput(tab === 'attack' ? 'attack' : draftKind));
      }
      const { state } = await playRound(game.runId, {
        assignment: { axis, combatants: 0, defenders, foragers, workers, researchers,
          workshopObjective: workshopObj, researchObjective: researchObj, rations,
          newExpeditions: newExps.length > 0 ? newExps : undefined,
          useArtifactOnWpId: artifactTargetWp || undefined },
        targetWeakPoint: targetWP || undefined,
      });
      setMissions({});
      setScoutTargets(new Set());
      setPendingExpeditions([]);
      setArtifactTargetWp('');
      const clan = state.mapTiles?.find((t: HexTile) => t.isClanCamp);
      setDraftPath(clan ? [{ q: clan.q, r: clan.r }] : []);
      setGame(state);
      setOdds(null);
    } finally { setLoading(false); }
  };

  // game.population = ljudje V KAMPU (ljudje na misijah/odpravah so že odšteti ob odhodu).
  const campPop = game?.population ?? 0;
  const inMissions = (game?.expeditions ?? []).reduce((s, e) => s + e.assigned, 0);
  const totalClan = campPop + inMissions;  // cel klan = kamp + ljudje zunaj
  const pop = campPop;  // ostane za kompatibilnost spodaj
  const newMissionPeople = 0;
  const pendingExpPpl = pendingExpeditions.reduce((s, e) => s + e.assigned, 0);
  const plannedTotal = newMissionPeople + pendingExpPpl + combatants;  // rezervirani za odprave/misije/napad
  const assignedHome = defenders + foragers + workers + researchers;
  // Ljudje na voljo za razporejanje = celoten kamp (ljudje zunaj so že izločeni iz campPop).
  const availablePop = Math.max(0, campPop);
  const freePeople = Math.max(0, availablePop - assignedHome - plannedTotal);
  const assigned = assignedHome + plannedTotal;
  const over = assigned > availablePop;

  const weaponCap = game ? Math.floor(game.resources.combat) : 0;
  // Oboroženi = branilci + napadalci + VSI ki gredo na odpravo/misijo (vsak rabi orožje).
  const draftArmed = draftPath.length >= 2 ? draftPeople : 0;
  const armedTotal = combatants + defenders + pendingExpPpl + newMissionPeople + draftArmed;
  const overArmed  = armedTotal > weaponCap;
  const weaponsLeft = Math.max(0, weaponCap - armedTotal);

  type SliderKey = 'd' | 'f' | 'w' | 'r';
  function setSliderClamped(which: SliderKey, newVal: number) {
    const reserved = combatants + newMissionPeople + pendingExpPpl;
    const v = Math.max(0, Math.min(availablePop, Math.floor(newVal)));
    const cur = { d: defenders, f: foragers, w: workers, r: researchers };
    cur[which] = v;
    const total = cur.d + cur.f + cur.w + cur.r + reserved;
    const setAll = () => { setDefenders(cur.d); setForagers(cur.f); setWorkers(cur.w); setResearchers(cur.r); };
    if (total <= availablePop) { setAll(); return; }
    const others = (['d','f','w','r'] as const).filter(k => k !== which);
    const otherSum = others.reduce((s, k) => s + cur[k], 0);
    const capLeft = Math.max(0, availablePop - v - reserved);
    if (otherSum === 0) others.forEach(k => { cur[k] = 0; });
    else { const scale = capLeft / otherSum; others.forEach(k => { cur[k] = Math.floor(cur[k] * scale); }); }
    setAll();
  }

  function toggleScoutTarget(id: string) {
    const next = new Set(scoutTargets);
    if (next.has(id)) next.delete(id); else next.add(id);
    setScoutTargets(next);
  }

  function handlePathClick(tile: { q: number; r: number }) {
    const last = draftPath[draftPath.length - 1];
    if (!last) return;
    // Če je klik na zadnjega heksa, odznači (razen kamp)
    if (last.q === tile.q && last.r === tile.r) {
      if (draftPath.length > 1) setDraftPath(draftPath.slice(0, -1));
      return;
    }
    // Sicer dodaj sosednjega
    setDraftPath([...draftPath, tile]);
  }

  // Statistike za draft pot (mesecev + tveganje)
  const TILES_PER_MONTH_FE = 1;  // en korak = en mesec
  const draftPathTiles = Math.max(0, draftPath.length - 1);
  const draftPathMonths = draftStealth
    ? Math.ceil(draftPathTiles * 1.5)        // skrivanje: +50 % trajanja
    : Math.max(0, Math.ceil(draftPathTiles / TILES_PER_MONTH_FE));
  // Povratek: če zadnji heks meji na kamp → neposredno (0–1 m), sicer nazaj po isti poti.
  const draftReturnMonths = (() => {
    if (draftPath.length < 2) return 0;
    const oneWay = Math.max(0, draftPath.length - 1);
    const clan = game?.mapTiles?.find(t => t.isClanCamp);
    if (!clan) return oneWay;
    const last = draftPath[draftPath.length - 1];
    const home = hexDistFE({ q: last.q, r: last.r }, { q: clan.q, r: clan.r });
    return Math.min(oneWay, home);  // naravnost domov, nikoli dlje od retrace
  })();
  const draftTotalMonths = draftPathMonths + draftReturnMonths;
  function tileEncounterMultFE(p: number, distFromCamp: number): number {
    let m = p < 0.25 ? 1.5 : p < 0.50 ? 1.2 : p < 1.0 ? 0.7 : 0.3;
    if (distFromCamp <= 1) m *= 0.5;
    else if (distFromCamp <= 2) m *= 0.8;
    return m;
  }
  function hexDistFE(a: { q: number; r: number }, b: { q: number; r: number }): number {
    const as_ = -a.q - a.r, bs_ = -b.q - b.r;
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(as_ - bs_)) / 2;
  }
  const draftRisk = (() => {
    if (!game || draftPath.length < 2) return 0;
    const clan = game.mapTiles?.find(t => t.isClanCamp);
    if (!clan) return 0;
    const SCOUT_CAPTURE_BASE_FE = 0.05;
    const SCOUT_CAPTURE_PER_SCOUT_FE = 0.004;
    const AI_KNOW_BONUS_FE = 0.20;
    // Faktor glede na AI izvidniške enote (manj robotov → manj srečanj). Mora se ujemati z enginom.
    const scoutLogicKnown = (game.aiTree ?? []).some(n => n.robot === 'scouts' && n.role === 'logical' && n.visibility === 'revealed');
    const aiScouts = (game.aiUnits?.scouts ?? game.aiRobots ?? 100) * (scoutLogicKnown ? 0.8 : 1);
    const scoutFactor = Math.max(0, Math.min(1, 0.25 + 0.75 * Math.min(1, Math.max(0, aiScouts) / 100)));
    let pNo = 1;
    for (const step of draftPath.slice(1)) {
      const tile = game.mapTiles?.find(t => t.q === step.q && t.r === step.r);
      if (!tile) continue;
      const distFromCamp = hexDistFE({ q: tile.q, r: tile.r }, { q: clan.q, r: clan.r });
      const base = SCOUT_CAPTURE_BASE_FE + SCOUT_CAPTURE_PER_SCOUT_FE * draftPeople + AI_KNOW_BONUS_FE * game.aiKnowledge;
      const p = Math.max(0, Math.min(0.85, base * tileEncounterMultFE(tile.researchProgress, distFromCamp) * scoutFactor));
      pNo *= (1 - p);
    }
    return 1 - pNo;
  })();
  const canConfirmDraft = draftPath.length >= 2 && draftPeople > 0
    && (assignedHome + plannedTotal + draftPeople <= availablePop)
    && !overArmed;  // vsak član odprave rabi orožje

  function setMissionAssignment(wpId: string, n: number) {
    const thisCur = missions[wpId] ?? 0;
    // Vse drugo že razporejeno (brez te misije)
    const otherPop   = assignedHome + combatants + pendingExpPpl + (newMissionPeople - thisCur);
    // Oboroženi drugje (branilci + napadalci + odprave + druge misije) — člani misije so napadalci
    const otherArmed = defenders + combatants + pendingExpPpl + draftArmed + (newMissionPeople - thisCur);
    const maxByPop     = availablePop - otherPop;
    const maxByWeapons = weaponCap - otherArmed;
    const cap = Math.max(0, Math.min(maxByPop, maxByWeapons));
    const v = Math.max(0, Math.min(cap, Math.floor(n)));
    const newMap = { ...missions, [wpId]: v };
    if (v === 0) delete newMap[wpId];
    setMissions(newMap);
  }
  function setMissionRations(wpId: string, lvl: number) {
    setMissionR({ ...missionR, [wpId]: lvl });
  }

  // Sestavi vhod za odpravo iz tekoče poti, glede na vrsto (izvid/napad).
  function buildDraftInput(kind: 'scout' | 'attack'): NewExpeditionInput {
    const last = draftPath[draftPath.length - 1];
    const tile = game?.mapTiles?.find(t => t.q === last.q && t.r === last.r);
    // napad na razkrito šibko točko, če pot konča na njej
    const wpId = (kind === 'attack' && tile?.hidesWeakPointId
      && game?.aiWeakPoints.find(w => w.id === tile.hidesWeakPointId)?.discovered)
      ? tile.hidesWeakPointId : undefined;
    return {
      kind: kind === 'attack' ? 'mission' : 'scout',
      weakPointId: wpId,
      path: draftPath, assigned: draftPeople, rations: draftRations,
      stealth: draftStealth,
    };
  }
  function confirmDraft(kind: 'scout' | 'attack') {
    if (draftPath.length < 2 || draftPeople < 1) return;
    setPendingExpeditions([...pendingExpeditions, buildDraftInput(kind)]);
    const clan = game?.mapTiles?.find(t => t.isClanCamp);
    if (clan) setDraftPath([{ q: clan.q, r: clan.r }]);
    setDraftPeople(5);
  }
  function confirmDraftExpedition() { confirmDraft('scout'); }
  function removePendingExpedition(idx: number) {
    setPendingExpeditions(pendingExpeditions.filter((_, i) => i !== idx));
  }

  // Prilagodi vlogo za ±1 (povezano z razdelilnikom + kampom). + le če so prosti.
  function bumpRole(which: 'd' | 'f' | 'w' | 'r', delta: number) {
    const cur = { d: defenders, f: foragers, w: workers, r: researchers }[which];
    if (delta > 0 && (assignedHome + plannedTotal) >= availablePop) return;
    // Branilci so oboroženi → ne dovoli več od orožja
    if (delta > 0 && which === 'd' && weaponsLeft <= 0) return;
    const next = Math.max(0, cur + delta);
    if (which === 'd') setDefenders(next);
    else if (which === 'f') setForagers(next);
    else if (which === 'w') setWorkers(next);
    else setResearchers(next);
  }
  // Nastavi absolutno vrednost (slider) — omeji na trenutno + proste, ne more presegati skupne razpoložljive populacije.
  function setRole(which: 'd' | 'f' | 'w' | 'r', value: number) {
    const cur = { d: defenders, f: foragers, w: workers, r: researchers }[which];
    const maxAllowed = cur + freePeople;
    const next = Math.max(0, Math.min(maxAllowed, value));
    if (which === 'd') setDefenders(next);
    else if (which === 'f') setForagers(next);
    else if (which === 'w') setWorkers(next);
    else setResearchers(next);
  }

  function autoFitAllocation() {
    if (assigned === 0 || availablePop === 0) return;
    const scale = availablePop / assigned;
    setCombatants(Math.floor(combatants * scale));
    setDefenders(Math.floor(defenders * scale));
    setForagers(Math.floor(foragers * scale));
    setWorkers(Math.floor(workers * scale));
    setResearchers(Math.floor(researchers * scale));
    const newMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(missions)) {
      const sv = Math.floor(v * scale);
      if (sv > 0) newMap[k] = sv;
    }
    setMissions(newMap);
  }

  if (!game && !loading) return <StartScreen onNew={handleNew} loading={false} />;
  if (!game && loading)  return <StartScreen onNew={handleNew} loading={true}  />;
  if (!game) return null;
  if (game.status !== 'active') return <GameOverScreen game={game} onNew={handleNew} loading={loading} />;

  const rTier = RATIONS[rations];
  const foragerYield = Math.floor(foragers * 4 * rTier.strengthMult);
  const researchIntelBase = Math.floor(researchers * 8 * rTier.strengthMult);
  const researchIntelBonus = researchObj === 'robots' ? Math.floor(researchers * 8 * 3 * rTier.strengthMult) : 0;
  const researchIntel = researchIntelBase + researchIntelBonus;
  const inCampPop    = Math.max(0, game.population);
  const campFoodCost = Math.round(inCampPop * rTier.foodMult);
  // Aktivne misije/odprave: ne jedo iz kampa (so vzele upfront)
  // Nove odprave/misije, ki bodo poslane TA mesec, vzamejo hrano s seboj iz kampa
  const clanTile = game.mapTiles?.find(t => t.isClanCamp);
  const roundTripMonthsFE = (path: { q: number; r: number }[]) => {
    const oneWay = Math.max(0, path.length - 1);
    if (path.length < 2) return 0;
    const last = path[path.length - 1];
    const ret = clanTile ? Math.min(oneWay, hexDistFE({ q: last.q, r: last.r }, { q: clanTile.q, r: clanTile.r })) : oneWay;
    return oneWay + ret;
  };
  const pendingExpFood = pendingExpeditions.reduce((s, e) => {
    const months = Math.max(1, roundTripMonthsFE(e.path));
    const t = RATIONS[e.rations] ?? RATIONS[3];
    return s + Math.round(e.assigned * months * t.foodMult);
  }, 0);
  const draftRTier = RATIONS[draftRations];
  const draftExpFood = (draftPath.length >= 2 && draftPeople > 0)
    ? Math.round(draftPeople * Math.max(1, (draftPath.length - 1) + draftReturnMonths) * draftRTier.foodMult) : 0;
  const newMissionFood = Object.entries(missions).reduce((s, [wpId, ppl]) => {
    // misije imajo fiksno trajanje per wp
    const dur = wpId === 'wp_power' ? 4 : wpId === 'wp_comm' ? 5 : wpId === 'wp_core' ? 6 : 4;
    const r = missionR[wpId] ?? 3;
    const t = RATIONS[r] ?? RATIONS[3];
    return s + Math.round(ppl * dur * t.foodMult);
  }, 0);
  const expPacksFood = pendingExpFood + draftExpFood + newMissionFood;
  const foodCost     = campFoodCost + expPacksFood;
  const survBalance  = foragerYield - foodCost;
  // Projekcija z istim klampanjem kot engine (survival ne gre pod 0)
  const _curSurv     = game.resources.survival;
  const _afterCamp   = Math.max(0, _curSurv - campFoodCost + foragerYield);
  const foodNextMonth = Math.max(0, _afterCamp - expPacksFood);

  return (
    <div className={`app-shell mob-tab-${tab}`}>
      {phaseTrans && (
        <PhaseTransitionBanner
          fromPhase={phaseTrans.from}
          toPhase={phaseTrans.to}
          narrative={phaseTrans.narrative}
          onClose={() => setPhaseTrans(null)}
        />
      )}
      {showFeedback && <FeedbackModal game={game} onClose={() => setShowFeedback(false)} />}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {appMenuOpen && (
        <div className="app-menu-overlay" onClick={() => setAppMenuOpen(false)}>
          <div className="app-menu" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setAppMenuOpen(false); handleNew(); }} disabled={loading}>↺ Nova igra</button>
            <button onClick={() => { setAppMenuOpen(false); setShowFeedback(true); }}>💡 Predlogi za izboljšave</button>
            <button onClick={() => { setAppMenuOpen(false); setShowRules(true); }}>📖 Pravila</button>
          </div>
        </div>
      )}
      {/* ─── ZGORNJA VRSTICA: faza + viri ─── */}
      <header className="top-bar">
        <div className="top-spacer" />
        <div className="top-res">
          {/* LEVO — ljudje (stranska metrika) */}
          <div className="tr-group tr-side">
            <BigStat icon="👥" label="Klan skupaj" value={totalClan}  color="#d8d8d8" />
            <BigStat icon="🏠" label="V kampu"     value={campPop}    color="#9ec0ad" />
            <BigStat icon="🎯" label="Na odpravi"  value={inMissions} color="#d6a96a" />
            <BigStat icon="💤" label="Prosti"      value={freePeople}
              color={freePeople > 0 ? '#66cc88' : '#7a8a82'} />
          </div>

          {/* SREDINA — viri (poudarjeni) */}
          {(() => {
            const foodDelta = foodNextMonth - game.resources.survival;
            const matAvail = game.resources.material ?? 0;
            // Napoved naslednjega meseca po cilju delavnice (delavec-mesecev model)
            const wpProg = (game.weaponWorkshopProgress ?? 0) + (workshopObj === 'weapon' ? workers : 0);
            const wpMade = workshopObj === 'weapon' ? Math.min(Math.floor(wpProg / 6), Math.floor(matAvail / 1)) : 0;
            const wlProg = (game.wallProgress ?? 0) + (workshopObj === 'wall' ? workers : 0);
            const wlMade = workshopObj === 'wall' ? Math.min(Math.floor(wlProg / 12), Math.floor(matAvail / 4)) : 0;
            const arProg = (game.artifactWorkshopProgress ?? 0) + (workshopObj === 'artifact' ? workers : 0);
            const arMade = workshopObj === 'artifact' ? Math.min(Math.floor(arProg / 360), Math.floor(matAvail / 20)) : 0;
            const weaponDelta = wpMade;
            const materialDelta = -(wpMade * 1 + wlMade * 4 + arMade * 20);
            const intelDelta = researchIntel;
            const fmt = (n: number) => n > 0 ? `+${n}` : n < 0 ? `${n}` : '';
            const col = (n: number) => n > 0 ? '#22cc88' : n < 0 ? '#cc4444' : '#888';
            return (
              <div className="tr-group tr-main">
                <BigStat icon="🍞" label="Hrana"      value={game.resources.survival} color="#cc8800"
                  note={fmt(foodDelta) || '±0'} noteColor={col(foodDelta)} />
                <BigStat icon="⚔"  label="Orožje"     value={game.resources.combat}   color="#cc4433"
                  note={fmt(weaponDelta) || (workshopObj === 'weapon' && workers > 0 ? `${game.weaponWorkshopProgress ?? 0}/6 dm` : '')}
                  noteColor={col(weaponDelta)} />
                <BigStat icon="⚙"  label="Material"   value={game.resources.material ?? 0} color="#88aabb"
                  note={fmt(materialDelta)} noteColor={col(materialDelta)} />
                <BigStat icon="👁"  label="Intel"      value={game.resources.intelligence} color="#3388cc"
                  note={fmt(intelDelta)} noteColor={col(intelDelta)} />
                {(game.resources.artifacts ?? 0) > 0 && (
                  <BigStat icon="💎" label="Artefakti" value={game.resources.artifacts} color="#ffd84a" />
                )}
                {(game.wallsBuilt ?? 0) > 0 && (
                  <BigStat icon="🧱" label="Obzidje"   value={game.wallsBuilt}         color="#aabb88" />
                )}
              </div>
            );
          })()}

          {/* DESNO — AI / situacija (stranska metrika) */}
          {(() => {
            const clansAlly = (game.otherClans ?? []).filter(c => c.allied).length * 4;
            const ourK = game.aiInsight ?? calcOurKnowledge(game.aiTree);
            const aiK  = game.aiKnowledge;
            const ourColor = ourK >= 0.6 ? '#22cc88' : ourK >= 0.3 ? '#3377cc' : '#5a7a99';
            const aiColor  = aiK  >= 0.7 ? '#cc2222' : aiK  >= 0.4 ? '#cc7700' : '#aa5a5a';
            return (
              <div className="tr-group tr-side">
                <BigStat icon="🤖" label="AI roboti" value={game.aiRobots}                       color="#cc3333"
                  note={(() => { const u = game.aiUnits; return u ? `🔭${u.scouts} ⚔${u.attackers} ☠${u.peopleKillers}` : ''; })()}
                  noteColor="#aa8888"
                  title={(() => { const u = game.aiUnits; return u ? `Izvidniške: ${u.scouts} · Napadalne: ${u.attackers} · People-killer: ${u.peopleKillers}` : ''; })()} />
                <BigStat icon="🌍" label="Klani"     value={Math.round(game.clanActivity * 100)} color="#88aa66" unit="%"
                  note={clansAlly > 0 ? `+${clansAlly}%` : ''} noteColor={'#22cc88'} />
                <BigStat icon="🔭" label="Mi vemo"   value={Math.round(ourK * 100)} color={ourColor} unit="%" />
                <BigStat icon="👁" label="AI ve"     value={Math.round(aiK * 100)}  color={aiColor}  unit="%" />
              </div>
            );
          })()}
        </div>
        <div className="top-menu-wrap">
          <button className="ph-menu-btn" onClick={() => setAppMenuOpen(true)} title="Meni" aria-label="Meni">
            {loading ? '⟳' : '☰'}
          </button>
        </div>
      </header>

      {/* ─── SREDNJI DEL: levo meni+vsebina / karta / desno log+akcije ─── */}
      <div className={`main-cols ${leftOpen ? '' : 'left-collapsed'} ${rightOpen ? '' : 'right-collapsed'}`}>

      {/* preklop desnega dnevnika (vedno viden ob robu) */}
      <button className={`col-toggle right-toggle ${rightOpen ? 'open' : ''}`} title={rightOpen ? 'Skrij dnevnik' : 'Prikaži dnevnik'}
        onClick={() => setRightOpen(o => !o)}>{rightOpen ? '▶' : '◀'}</button>

      {/* LEVO: hitri meni + vsebina izbranega zavihka */}
      <aside className="left-col">
        <nav className="side-menu">
          {([
            { id: 'defense',  icon: '🛡️', label: 'Obramba' },
            { id: 'food',     icon: '🌾', label: 'Prehrana' },
            { id: 'workshop', icon: '🔨', label: 'Delavnice' },
            { id: 'research', icon: '🔬', label: 'Raziskave' },
            { id: 'map',      icon: '🗺', label: 'Izvidniki' },
            { id: 'attack',   icon: '⚔️', label: 'Napad' },
          ] as const).map(m => (
            <button key={m.id} className={`sm-btn ${tab === m.id && leftOpen ? 'active' : ''} ${'mobileOnly' in m && m.mobileOnly ? 'sm-mobile-only' : ''}`}
              onClick={() => {
                if (m.id === tab && leftOpen) { setLeftOpen(false); return; }  // ponoven klik aktivnega = zapri
                setTab(m.id); setLeftOpen(true);
                if (m.id === 'attack') setDraftKind('attack'); else if (m.id === 'map') setDraftKind('scout');
              }} title={m.label}>
              <span className="sm-icon">{m.icon}</span>
              <span className="sm-label">{m.label}</span>
            </button>
          ))}
          <button className="sm-btn sm-toggle" title={leftOpen ? 'Skrij panel' : 'Prikaži panel'} onClick={() => setLeftOpen(o => !o)}>
            <span className="sm-icon">{leftOpen ? '◀' : '▶'}</span>
            <span className="sm-label">{leftOpen ? 'Skrij' : 'Odpri'}</span>
          </button>
        </nav>

        <div className="left-panel">
         <button className="lp-mob-close" onClick={() => setLeftOpen(false)} title="Zapri">✕</button>
         <FitScale deps={[tab, game, defenders, foragers, workers, researchers, combatants, draftPath.length, pendingExpeditions.length]}>
          {/* ─── OBRAMBA (grafični panel) ─── */}
          {tab === 'defense' && (() => {
            const raidP = odds?.raidProbability ?? 0;
            const raid6 = odds ? 1 - Math.pow(1 - raidP, 6) : 0;
            const repel = defenders > 0 && odds ? odds.raidRepelProbability : 0;
            const repelPct = Math.round(repel * 100), raidPct = Math.round(raidP * 100), raid6Pct = Math.round(raid6 * 100);
            const wallLvl = game.wallsBuilt ?? 0;
            const wallProg = game.wallProgress ?? 0;  // gradnja /12
            const risk = (p: number) => p < 0.15 ? 'Nizko tveganje' : p < 0.40 ? 'Srednje tveganje' : 'Visoko tveganje';
            const safety = repel >= 0.66 ? 'Visoka' : repel >= 0.33 ? 'Srednja' : 'Nizka';
            const dots = Math.min(24, defenders);
            const bullets = Math.min(24, weaponCap);
            return (
            <div className="panel def-panel">
              <div className="def-head">
                <span className="def-head-icon">🛡</span>
                <div><h3>OBRAMBA</h3><div className="def-sub">ZAŠČITA TABORA</div></div>
                <InfoButton kind="defense" />
              </div>

              {/* BRANILCI */}
              <div className="def-card">
                <div className="def-card-title">BRANILCI</div>
                <div className="def-defenders">
                  <div className="def-big-num">{defenders}<span className="def-cap"> / {weaponCap}</span></div>
                  <div className="def-slider-row">
                    <button className="pa-btn" disabled={defenders <= 0} onClick={() => bumpRole('d', -1)}>−</button>
                    <input type="range" min={0} max={availablePop} value={defenders}
                      onChange={e => setRole('d', +e.target.value)} className="def-slider" />
                    <button className="pa-btn" disabled={freePeople <= 0 || weaponsLeft <= 0} onClick={() => bumpRole('d', 1)}>+</button>
                  </div>
                </div>
                <div className="def-people-row">
                  {Array.from({ length: dots }).map((_, i) => <span key={i} className="def-person">👤</span>)}
                  {defenders > dots && <span className="def-person-more dim small">+{defenders - dots}</span>}
                </div>
              </div>

              {/* TVEGANJA — najprej AI napad, nato verjetnost obrambe */}
              <div className="def-stat-grid">
                <div className="def-stat">
                  <div className="def-stat-label">AI NAPAD TA MESEC</div>
                  <div className="def-stat-big" style={{ color: probColor(1 - raidP) }}>{raidPct}%</div>
                  <div className="def-stat-note">{risk(raidP)}</div>
                </div>
                <div className="def-stat">
                  <div className="def-stat-label">VERJETNOST OBRAMBE</div>
                  <Gauge pct={repelPct} color={probColor(repel)} />
                  <div className="def-stat-sub" style={{ color: probColor(repel) }}>{safety}</div>
                </div>
                <div className="def-stat">
                  <div className="def-stat-label">VSAJ EN NAPAD V 6 MESECIH</div>
                  <div className="def-stat-big" style={{ color: probColor(1 - raid6) }}>{raid6Pct}%</div>
                  <div className="def-stat-note">{risk(raid6)}</div>
                </div>
              </div>

              {/* OROŽJE + OBZIDJE */}
              <div className="def-bottom-grid">
                <div className="def-card">
                  <div className="def-card-title">⚔ OROŽJE</div>
                  <div className="def-big-num" style={{ color: overArmed ? '#cc4444' : '#cc7755' }}>⚔ {weaponCap}</div>
                  <div className="def-stat-note">Prosto: <b style={{ color: weaponsLeft > 0 ? '#66cc88' : '#cc4444' }}>{weaponsLeft}</b> · v rabi {armedTotal}</div>
                  <div className="def-bullets">
                    {Array.from({ length: bullets }).map((_, i) => <span key={i} className={`def-bullet ${i < armedTotal ? 'used' : ''}`}>▮</span>)}
                  </div>
                  <button className="def-upgrade-btn weapon" onClick={() => { setWorkshopObj('weapon'); setTab('workshop'); }}>⚔ GRADI OROŽJE</button>
                </div>
                <div className="def-card">
                  <div className="def-card-title">🏰 OBZIDJE</div>
                  <div className="def-wall-lvl">STOPNJA {wallLvl}</div>
                  <div className="def-stat-note">+{wallLvl * 20}% k obrambi</div>
                  <div className="def-seg">{Array.from({ length: 12 }).map((_, i) => <span key={i} className={`def-seg-cell ${i < wallProg ? 'fill' : ''}`} />)}</div>
                  <button className="def-upgrade-btn" onClick={() => { setWorkshopObj('wall'); setTab('workshop'); }}>🧱 GRADI OBZIDJE</button>
                </div>
              </div>

              {/* ARTEFAKT */}
              {(() => {
                const arts = game.resources.artifacts ?? 0;
                const artProg = game.artifactWorkshopProgress ?? 0;
                const artPct = Math.min(100, Math.round((artProg / 360) * 100));
                return (
                  <div className="def-card">
                    <div className="def-card-title">💎 ARTEFAKT</div>
                    <div className="def-big-num" style={{ color: '#ffd84a' }}>💎 {arts}</div>
                    <div className="def-stat-note">Instant uniči 1 šibko točko AI · napredek {artProg}/360</div>
                    <div className="def-progbar"><span className="def-progbar-fill" style={{ width: `${artPct}%`, background: '#ffd84a' }} /></div>
                    <button className="def-upgrade-btn artifact" onClick={() => { setWorkshopObj('artifact'); setTab('workshop'); }}>💎 GRADI ARTEFAKT</button>
                  </div>
                );
              })()}

              {overArmed && (
                <div className="weapon-warning">⚠ Premalo orožja: oboroženih {armedTotal}/{weaponCap}. Vsak branilec, napadalec in član odprave rabi orožje.</div>
              )}

              {/* KAKO DELUJE */}
            </div>
            );
          })()}

          {/* ─── PREHRANA ─── */}
          {tab === 'food' && (() => {
            const safety = odds?.forageSafetyProbability ?? 0;
            const dots = Math.min(24, foragers);
            return (
            <div className="panel def-panel">
              <div className="def-head"><span className="def-head-icon">🌾</span><div><h3>PREHRANA</h3><div className="def-sub">OSKRBA S HRANO</div></div><InfoButton kind="food" /></div>
              <div className="def-card">
                <div className="def-card-title">NABIRALCI</div>
                <div className="def-defenders">
                  <div className="def-big-num" style={{ color: '#9ed18a' }}>{foragers}</div>
                  <div className="def-slider-row">
                    <button className="pa-btn" disabled={foragers <= 0} onClick={() => bumpRole('f', -1)}>−</button>
                    <input type="range" min={0} max={availablePop} value={foragers} onChange={e => setRole('f', +e.target.value)} className="def-slider" />
                    <button className="pa-btn" disabled={freePeople <= 0} onClick={() => bumpRole('f', 1)}>+</button>
                  </div>
                </div>
                <div className="def-people-row">{Array.from({ length: dots }).map((_, i) => <span key={i} className="def-person">👤</span>)}{foragers > dots && <span className="def-person-more dim small">+{foragers - dots}</span>}</div>
              </div>
              <div className="def-card">
                <div className="def-card-title">OBROKI</div>
                <RationsMini value={rations} onChange={setRations} />
              </div>
              <div className="def-stat-grid">
                <div className="def-stat"><div className="def-stat-label">PRIDELEK / MESEC</div><div className="def-stat-big" style={{ color: '#22cc88' }}>+{foragerYield}</div><div className="def-stat-note">hrane</div></div>
                <div className="def-stat"><div className="def-stat-label">PORABA KAMPA</div><div className="def-stat-big" style={{ color: '#cc4444' }}>−{campFoodCost}</div><div className="def-stat-note">×{rTier.foodMult}</div></div>
                <div className="def-stat"><div className="def-stat-label">VARNO NABIRANJE</div><Gauge pct={Math.round(safety * 100)} color={probColor(safety)} /></div>
              </div>
              <div className="def-card">
                <div className="def-card-title">ZALOGA HRANE</div>
                <div className="def-big-num" style={{ color: '#cc8800' }}>🍞 {game.resources.survival}</div>
                <div className="def-stat-note">Naslednji mesec: <b style={{ color: foodNextMonth <= 0 ? '#cc2222' : '#9ed18a' }}>{foodNextMonth}{foodNextMonth <= 0 ? ' ⚠' : ''}</b></div>
              </div>
            </div>
            );
          })()}

          {/* ─── DELAVNICE ─── */}
          {tab === 'workshop' && (() => {
            const cfg = workshopObj === 'weapon'
              ? { label: 'orožje', total: 6, prog: game.weaponWorkshopProgress ?? 0, color: '#cc7733', icon: '⚔', made: game.resources.combat }
              : workshopObj === 'wall'
                ? { label: 'obzidje', total: 12, prog: game.wallProgress ?? 0, color: '#aabb88', icon: '🏰', made: game.wallsBuilt ?? 0 }
                : { label: 'artefakt', total: 360, prog: game.artifactWorkshopProgress ?? 0, color: '#ffd84a', icon: '💎', made: game.resources.artifacts ?? 0 };
            const need = Math.max(0, cfg.total - cfg.prog);
            const months = workers > 0 ? Math.ceil(need / workers) : Infinity;
            const pctv = Math.round((cfg.prog / cfg.total) * 100);
            const dots = Math.min(24, workers);
            return (
            <div className="panel def-panel">
              <div className="def-head"><span className="def-head-icon">🔨</span><div><h3>DELAVNICE</h3><div className="def-sub">IZDELAVA</div></div><InfoButton kind="workshop" /></div>
              <div className="def-card">
                <div className="def-card-title">DELAVCI</div>
                <div className="def-defenders">
                  <div className="def-big-num" style={{ color: '#cc9a6a' }}>{workers}</div>
                  <div className="def-slider-row">
                    <button className="pa-btn" disabled={workers <= 0} onClick={() => bumpRole('w', -1)}>−</button>
                    <input type="range" min={0} max={availablePop} value={workers} onChange={e => setRole('w', +e.target.value)} className="def-slider" />
                    <button className="pa-btn" disabled={freePeople <= 0} onClick={() => bumpRole('w', 1)}>+</button>
                  </div>
                </div>
                <div className="def-people-row">{Array.from({ length: dots }).map((_, i) => <span key={i} className="def-person">👤</span>)}{workers > dots && <span className="def-person-more dim small">+{workers - dots}</span>}</div>
              </div>
              <div className="def-card">
                <div className="def-card-title">CILJ IZDELAVE</div>
                <WorkshopSelector value={workshopObj} onChange={setWorkshopObj} weaponLevel={game.weaponResearchLevel ?? 0} wallLevel={game.wallResearchLevel ?? 0} />
                <div className="def-build-prog">
                  <div className="def-stat-note">{cfg.icon} {cfg.label}: imaš <b>{cfg.made}</b> · napredek {cfg.prog}/{cfg.total} dm</div>
                  <div className="def-progbar"><span className="def-progbar-fill" style={{ width: `${pctv}%`, background: cfg.color }} /></div>
                  <div className="def-stat-note">Do izdelka (pri {workers}): <b style={{ color: cfg.color }}>{workers > 0 ? `${months} mesec(ev)` : '∞'}</b></div>
                </div>
              </div>
              <div className="def-stat-grid">
                <div className="def-stat"><div className="def-stat-label">MATERIAL</div><div className="def-stat-big" style={{ color: '#88aabb' }}>{game.resources.material ?? 0}</div></div>
                <div className="def-stat"><div className="def-stat-label">OROŽJE</div><div className="def-stat-big" style={{ color: '#cc7755' }}>{game.resources.combat}</div></div>
                <div className="def-stat"><div className="def-stat-label">OBZIDJE</div><div className="def-stat-big" style={{ color: '#aabb88' }}>{game.wallsBuilt ?? 0}</div></div>
              </div>
            </div>
            );
          })()}

          {/* ─── RAZISKAVE ─── */}
          {tab === 'research' && (
          <>
          {(() => {
            const cfg = researchObj === 'robots'
              ? { label: RESEARCH_LEVEL_NAMES.robots[Math.min(game.robotsResearchLevel ?? 0, 2)], lvl: game.robotsResearchLevel ?? 0, prog: game.robotsResearchProgress ?? 0, color: '#cc8800', icon: '🤖', eff: 'razkriva AI drevo' }
              : researchObj === 'weapon'
                ? { label: RESEARCH_LEVEL_NAMES.weapon[Math.min(game.weaponResearchLevel ?? 0, 2)], lvl: game.weaponResearchLevel ?? 0, prog: game.weaponResearchProgress ?? 0, color: '#cc4433', icon: '⚔', eff: `napad ×${Math.pow(2, game.weaponResearchLevel ?? 0)}` }
                : { label: RESEARCH_LEVEL_NAMES.wall[Math.min(game.wallResearchLevel ?? 0, 2)], lvl: game.wallResearchLevel ?? 0, prog: game.wallResearchProgress ?? 0, color: '#aabb88', icon: '🏰', eff: `obramba ×${Math.pow(2, game.wallResearchLevel ?? 0)}` };
            const months = researchers > 0 ? Math.ceil((120 - cfg.prog) / researchers) : Infinity;
            const pctv = Math.round((cfg.prog / 120) * 100);
            const dots = Math.min(24, researchers);
            return (
            <div className="panel def-panel">
              <div className="def-head"><span className="def-head-icon">🔬</span><div><h3>RAZISKAVE</h3><div className="def-sub">RAZVOJ</div></div><InfoButton kind="research" /></div>
              <div className="def-card">
                <div className="def-card-title">RAZISKOVALNA VERIGA</div>
                <div className="dim small">🔬 Research → 👁 Intel → ◆ AI šibkosti → ⚔/🧱 Nadgradnje → 👥 Preživetje</div>
              </div>
              <div className="def-card">
                <div className="def-card-title">RAZISKOVALCI</div>
                <div className="def-defenders">
                  <div className="def-big-num" style={{ color: '#6aa0cc' }}>{researchers}</div>
                  <div className="def-slider-row">
                    <button className="pa-btn" disabled={researchers <= 0} onClick={() => bumpRole('r', -1)}>−</button>
                    <input type="range" min={0} max={availablePop} value={researchers} onChange={e => setRole('r', +e.target.value)} className="def-slider" />
                    <button className="pa-btn" disabled={freePeople <= 0} onClick={() => bumpRole('r', 1)}>+</button>
                  </div>
                </div>
                <div className="def-people-row">{Array.from({ length: dots }).map((_, i) => <span key={i} className="def-person">👤</span>)}{researchers > dots && <span className="def-person-more dim small">+{researchers - dots}</span>}</div>
              </div>
              <div className="def-card">
                <div className="def-card-title">CILJ RAZISKAVE</div>
                <ResearchSelector value={researchObj} onChange={setResearchObj} robotsLevel={game.robotsResearchLevel ?? 0} weaponLevel={game.weaponResearchLevel ?? 0} wallLevel={game.wallResearchLevel ?? 0} />
                <div className="def-build-prog">
                  <div className="def-stat-note">{cfg.icon} {cfg.label}: <b style={{ color: cfg.color }}>Lv{cfg.lvl}</b> · {cfg.eff}</div>
                  <div className="def-progbar"><span className="def-progbar-fill" style={{ width: `${pctv}%`, background: cfg.color }} /></div>
                  <div className="def-stat-note">Do Lv{cfg.lvl + 1} (pri {researchers}): <b style={{ color: cfg.color }}>{researchers > 0 ? `${months} mesec(ev)` : '∞'}</b>{researchObj === 'robots' ? ` · +${researchIntel} intel/m` : ''}</div>
                </div>
              </div>
            </div>
            );
          })()}
          <div className="band band-trees">
            <HumanTree robotsLevel={game.robotsResearchLevel ?? 0} weaponLevel={game.weaponResearchLevel ?? 0} wallLevel={game.wallResearchLevel ?? 0}
              focus={researchObj} onFocus={setResearchObj} />
            <AITree nodes={game.aiTree} justRevealed={justRevealed} />
          </div>
          </>
          )}

          {/* ─── IZVIDNIKI / MAPA — nova odprava + aktivne odprave ─── */}
          {tab === 'map' && (
          <>
          <div className="panel def-panel">
            <div className="def-head"><span className="def-head-icon">🔭</span>
              <div><h3>IZVIDNIKI</h3><div className="def-sub">RAZISKOVANJE MAPE</div></div>
              {pendingExpeditions.some(e => e.kind === 'scout') && <span className="panel-badge" style={{ marginLeft: 'auto' }}>{pendingExpeditions.filter(e => e.kind === 'scout').length} potrjenih</span>}
              <InfoButton kind="scout" />
            </div>
            <div className="pb-instr dim small">Klikni sosednje hekse na mapi za pot — odpravo lahko nastaviš tudi kar na zadnjem heksu (🔭/⚔ · −/+ · ✓).</div>
            {draftPath.length < 2 ? (
              <div className="map-hint">Pot je prazna. Začni s klikom na sosednji heks ⌂ klana.</div>
            ) : (
              <>
                <div className="def-stat-grid">
                  <div className="def-stat"><div className="def-stat-label">KORAKI</div><div className="def-stat-big">{draftPath.length - 1}</div></div>
                  <div className="def-stat"><div className="def-stat-label">TRAJANJE</div><div className="def-stat-big" style={{ color: '#cc8800' }}>{draftTotalMonths}m</div><div className="def-stat-note">{draftPathMonths} tja + {draftReturnMonths} nazaj</div></div>
                  <div className="def-stat"><div className="def-stat-label">VARNOST POTI</div><Gauge pct={Math.round((1 - draftRisk) * 100)} color={probColor(1 - draftRisk)} /></div>
                </div>
                <div className="def-card">
                  <div className="def-card-title">ŠTEVILO IZVIDNIKOV</div>
                  <div className="def-defenders">
                    <div className="def-big-num" style={{ color: '#ffd84a' }}>{draftPeople}</div>
                    <div className="def-slider-row" style={{ justifyContent: 'flex-end' }}>
                      <button className="pa-btn" disabled={draftPeople <= 1} onClick={() => setDraftPeople(Math.max(1, draftPeople - 1))}>−</button>
                      <button className="pa-btn" disabled={assignedHome + plannedTotal + draftPeople >= availablePop} onClick={() => setDraftPeople(draftPeople + 1)}>+</button>
                    </div>
                  </div>
                  <div className="exp-rations" style={{ marginTop: '.45rem' }}><span className="dim small">Obroki:</span><RationsMini value={draftRations} onChange={setDraftRations} /></div>
                  <label className="stealth-toggle" title="Trajanje +50 %, srečanja ×0.5.">
                    <input type="checkbox" checked={draftStealth} onChange={e => setDraftStealth(e.target.checked)} />
                    <span>🌙 Skrivanje — pot +50 %, srečanja ×0.5</span>
                  </label>
                  <div className="def-stat-note">🍞 vzamejo <b style={{ color: '#cc8800' }}>{draftExpFood}</b> hrane · moč ×{draftRTier.strengthMult}</div>
                  <button className="def-upgrade-btn" disabled={!canConfirmDraft} onClick={confirmDraftExpedition}>✓ Potrdi odpravo</button>
                </div>
              </>
            )}
            {pendingExpeditions.some(e => e.kind === 'scout') && (
              <div className="pending-exps">
                <div className="dim small" style={{ marginBottom: 4 }}>Potrjene odprave (sproži ob izvedbi meseca):</div>
                {pendingExpeditions.map((e, i) => e.kind === 'scout' && (() => {
                  const oneWay = e.path.length - 1;
                  const last = e.path[e.path.length - 1];
                  const clan = game.mapTiles?.find(t => t.isClanCamp);
                  const ret = clan && last ? Math.min(oneWay, hexDistFE(last, { q: clan.q, r: clan.r })) : oneWay;
                  const months = oneWay + ret;
                  const t = RATIONS[e.rations] ?? RATIONS[3];
                  const food = Math.round(e.assigned * months * t.foodMult);
                  return (
                    <div key={i} className="pending-exp-row">
                      <span>🔭 {e.assigned} · {months}m tja+nazaj · {t.emoji} 🍞{food}{e.stealth ? ' · 🌙' : ''}</span>
                      <button className="pa-btn" onClick={() => removePendingExpedition(i)}>✕</button>
                    </div>
                  );
                })())}
              </div>
            )}
          </div>
          <AlliesPanel clans={game.otherClans ?? []} />
          </>
          )}

          {/* ─── NAPAD — pošlji napadalce po poti, spopad ob prihodu ─── */}
          {tab === 'attack' && (
          <>
          <div className="panel def-panel">
            <div className="def-head"><span className="def-head-icon">⚔</span>
              <div><h3>NAPAD</h3><div className="def-sub">UDAR NA AI</div></div>
              {pendingExpeditions.filter(e => e.kind === 'mission').length > 0 && <span className="panel-badge" style={{ marginLeft: 'auto' }}>{pendingExpeditions.filter(e => e.kind === 'mission').length} napadov</span>}
              <InfoButton kind="attack" />
            </div>
            <div className="pb-instr dim small">Nariši pot do AI jedra (☣) ali šibke točke (◆). Odpravo nastaviš tudi na zadnjem heksu. Spopad ob prihodu, preživeli se vrnejo.</div>
            {draftPath.length < 2 ? (
              <div className="map-hint">Pot je prazna. Klikni sosednji heks ⌂ klana za začetek poti do cilja.</div>
            ) : (() => {
              const last = draftPath[draftPath.length - 1];
              const tile = game.mapTiles?.find(t => t.q === last.q && t.r === last.r);
              const wp = tile?.hidesWeakPointId ? game.aiWeakPoints.find(w => w.id === tile.hidesWeakPointId) : undefined;
              const wpDisc = !!wp?.discovered;
              const targetLabel = wpDisc ? `◆ ${wp!.label}` : tile?.isAICore ? '☣ AI jedro' : `(${last.q},${last.r}) — splošni napad`;
              const aiUnits = game.aiUnits ?? { scouts: game.aiRobots ?? 0, attackers: 0, peopleKillers: 0 };
              const stealthBonus = draftStealth ? 1.2 : 1;
              const winP = wpDisc
                ? Math.min(0.98, missionSuccessProbability(game, wp!.id, draftPeople, draftRations) * stealthBonus)
                : (() => {
                    const hStr = draftPeople * COMBAT_BASE_HUMAN_MULTIPLIER * draftRTier.strengthMult
                      * stealthBonus * researchMult(game.weaponResearchLevel ?? 0) * (1 + logicalWeaknessBonus(game));
                    const aStr = Math.max(1, aiDefensePower(aiUnits) * 0.05);
                    return hStr / (hStr + aStr);
                  })();
              return (
                <>
                  <div className="def-card">
                    <div className="def-card-title">CILJ</div>
                    <div className="def-big-num" style={{ fontSize: '1.1rem', color: wpDisc ? '#ffd84a' : '#cc6655' }}>{targetLabel}</div>
                  </div>
                  <div className="def-stat-grid">
                    <div className="def-stat"><div className="def-stat-label">TRAJANJE</div><div className="def-stat-big" style={{ color: '#cc8800' }}>{draftTotalMonths}m</div><div className="def-stat-note">{draftPathMonths} tja + {draftReturnMonths} nazaj</div></div>
                    <div className="def-stat"><div className="def-stat-label">VARNOST POTI</div><Gauge pct={Math.round((1 - draftRisk) * 100)} color={probColor(1 - draftRisk)} /></div>
                    <div className="def-stat"><div className="def-stat-label">OCENA ZMAGE</div><Gauge pct={Math.round(winP * 100)} color={probColor(winP)} /></div>
                  </div>
                  <div className="def-card">
                    <div className="def-card-title">NAPADALCI</div>
                    <div className="def-defenders">
                      <div className="def-big-num" style={{ color: '#cc4433' }}>⚔ {draftPeople}</div>
                      <div className="def-slider-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="pa-btn" disabled={draftPeople <= 1} onClick={() => setDraftPeople(Math.max(1, draftPeople - 1))}>−</button>
                        <button className="pa-btn" disabled={assignedHome + plannedTotal + draftPeople >= availablePop || weaponsLeft <= 0} onClick={() => setDraftPeople(draftPeople + 1)}>+</button>
                      </div>
                    </div>
                    <div className="def-stat-note">Prosto orožja: <b style={{ color: weaponsLeft > 0 ? '#66cc88' : '#cc4444' }}>{weaponsLeft}</b> (vsak napadalec rabi orožje)</div>
                    <div className="exp-rations" style={{ marginTop: '.45rem' }}><span className="dim small">Obroki:</span><RationsMini value={draftRations} onChange={setDraftRations} /></div>
                    <label className="stealth-toggle" title="Trajanje +50 %, srečanja ×0.5, boj +20 % uspeha.">
                      <input type="checkbox" checked={draftStealth} onChange={e => setDraftStealth(e.target.checked)} />
                      <span>🌙 Skrivanje — pot +50 %, srečanja ×0.5, boj +20 %</span>
                    </label>
                    <div className="def-stat-note">🍞 vzamejo <b style={{ color: '#cc8800' }}>{draftExpFood}</b> hrane · moč ×{draftRTier.strengthMult}</div>
                    <button className="def-upgrade-btn weapon" disabled={!canConfirmDraft} onClick={() => confirmDraft('attack')}>⚔ Pošlji napad</button>
                  </div>
                </>
              );
            })()}
            {pendingExpeditions.filter(e => e.kind === 'mission').length > 0 && (
              <div className="pending-exps">
                <div className="dim small" style={{ marginBottom: 4 }}>Potrjeni napadi (sproži ob izvedbi meseca):</div>
                {pendingExpeditions.map((e, i) => e.kind === 'mission' && (() => {
                  const oneWay = e.path.length - 1;
                  const last = e.path[e.path.length - 1];
                  const clan = game.mapTiles?.find(t => t.isClanCamp);
                  const ret = clan && last ? Math.min(oneWay, hexDistFE(last, { q: clan.q, r: clan.r })) : oneWay;
                  return (
                    <div key={i} className="pending-exp-row">
                      <span>⚔ {e.assigned} · {oneWay + ret}m tja+nazaj{e.weakPointId ? ' · ◆ šibka točka' : ''}{e.stealth ? ' · 🌙' : ''}</span>
                      <button className="pa-btn" onClick={() => removePendingExpedition(i)}>✕</button>
                    </div>
                  );
                })())}
              </div>
            )}
          </div>
          </>
          )}

          {/* ─── V TEKU — pregled vseh aktivnih odprav in napadov ─── */}
         </FitScale>
         {/* ─── LOG (mobilno) — dnevnik dogodkov, lasten scroll, brez skaliranja ─── */}
         {tab === 'log' && (
           <div className="panel rc-log lp-log">
             <div className="panel-head"><h3>DNEVNIK DOGODKOV</h3></div>
             <div className="rc-log-scroll"><EventLog entries={eventLog} /></div>
           </div>
         )}
        </div>
      </aside>

      {/* SREDINA: operativna karta */}
      <section className="center-col">
        <div className="panel map-panel">
          <div className="panel-head">
            <h3>OPERATIVNA MAPA</h3>
            <span className="panel-badge">
              {(game.mapTiles ?? []).filter(t => t.researchProgress >= 0.50).length} / {(game.mapTiles ?? []).length} raziskanih
            </span>
          </div>
          <HexMap tiles={game.mapTiles ?? []} draftPath={draftPath}
            draftKind={tab === 'attack' ? 'attack' : draftKind}
            plannedPaths={pendingExpeditions.map(e => ({ path: e.path, kind: e.kind }))}
            onPathClick={handlePathClick}
            onWpSelect={(id) => setTargetWP(targetWP === id ? '' : id)}
            selectedWpId={targetWP}
            expeditions={game.expeditions ?? []}
            wps={game.aiWeakPoints} otherClans={game.otherClans ?? []} drawingMode={true}
            camp={{ defenders, researchers, workers, foragers }}
            freePeople={freePeople}
            onCampAdjust={(which, delta) => bumpRole(which, delta)}
            onCampSet={(which, value) => setRole(which, value)}
            repelProbability={odds?.raidRepelProbability ?? 0}
            rations={rations} onRations={setRations}
            workshopObj={workshopObj} onWorkshop={setWorkshopObj}
            researchObj={researchObj} onResearch={setResearchObj}
            workshop={{ wallsBuilt: game.wallsBuilt ?? 0, weaponProgress: game.weaponWorkshopProgress ?? 0, wallProgress: game.wallProgress ?? 0, artifactProgress: game.artifactWorkshopProgress ?? 0, workers }}
            research={{ robotsLevel: game.robotsResearchLevel ?? 0, robotsProgress: game.robotsResearchProgress ?? 0, weaponLevel: game.weaponResearchLevel ?? 0, weaponProgress: game.weaponResearchProgress ?? 0, wallLevel: game.wallResearchLevel ?? 0, wallProgress: game.wallResearchProgress ?? 0, researchers }}
            pop={{ total: game.population, inCamp: Math.max(0, game.population - inMissions), away: inMissions, free: freePeople }}
            draftPeople={draftPeople}
            onDraftKind={(k) => setDraftKind(k)}
            onDraftPeople={(d) => {
              if (d > 0) { if (!(assignedHome + plannedTotal + draftPeople >= availablePop || weaponsLeft <= 0)) setDraftPeople(draftPeople + 1); }
              else setDraftPeople(Math.max(1, draftPeople - 1));
            }}
            onConfirmDraft={() => confirmDraft(draftKind)}
            canConfirmDraft={canConfirmDraft}
            draftAddDisabled={assignedHome + plannedTotal + draftPeople >= availablePop || weaponsLeft <= 0} />
          <div className="map-legend">
            <span className="ml-item"><span style={{ color: '#66ccaa' }}>⌂</span> klan</span>
            <span className="ml-item"><span style={{ color: '#cc3333' }}>☣</span> AI jedro</span>
            <span className="ml-item"><span style={{ color: '#cc8800' }}>◆</span> šibka točka</span>
            <span className="ml-item"><span style={{ color: '#33cc88' }}>⛺</span> drug klan</span>
            <span className="ml-item"><span style={{ color: '#ffd84a' }}>―</span> odprava</span>
            <span className="ml-item"><span style={{ color: '#cc3333' }}>―</span> napad</span>
            <span className="ml-sep">·</span>
            <span className="ml-item" style={{ color: '#7a3a3a' }}>rdeč = neraziskan</span>
            <span className="ml-item" style={{ color: '#5a8a9c' }}>moder = raziskan</span>
            <span className="ml-item" style={{ color: '#5aa0e0' }}>sij = domač</span>
          </div>
        </div>
      </section>

      {/* DESNO: dnevnik dogodkov (zgoraj, scrollable) + V teku (pod trakom) */}
      <aside className="right-col">
        <div className="panel rc-log">
          <div className="panel-head"><h3>DNEVNIK DOGODKOV</h3></div>
          <div className="rc-log-scroll">
            <EventLog entries={eventLog} />
          </div>
        </div>
        <div className="panel rc-active">
          <div className="panel-head">
            <h3>⏳ V TEKU</h3>
            <span className="dim small">{(game.expeditions ?? []).length} aktivnih · {inMissions} ljudi zunaj</span>
          </div>
          {(game.expeditions ?? []).length === 0 ? (
            <p className="field-note dim small">Trenutno ni aktivnih odprav ali napadov. Pošlji jih iz zavihkov Izvidniki ali Napad.</p>
          ) : (
            <div className="active-expeditions">
              {(game.expeditions ?? []).map(e => {
                const total = Math.max(1, e.path.length - 1);
                const done = e.currentIndex;
                const remaining = Math.max(0, total - done);
                const target = e.path[e.path.length - 1];
                const isAttack = e.kind === 'mission';
                const returning = e.status === 'returning';
                const color = returning ? '#66cc88' : isAttack ? '#cc3333' : '#ffd84a';
                const wp = e.weakPointId ? game.aiWeakPoints.find(w => w.id === e.weakPointId) : undefined;
                const kindLabel = (returning ? '↩ Vračanje' : isAttack ? (wp ? `⚔ Napad na ◆ ${wp.label}` : '⚔ Napad') : '🔭 Izvidnica') + (e.stealth ? ' · 🌙' : '');
                return (
                  <div key={e.id} className="exp-card">
                    <div className="exp-head">
                      <span className="exp-kind" style={{ color }}>{kindLabel} · {e.assigned} ljudi</span>
                      <span className="dim small">→ ({target?.q},{target?.r})</span>
                    </div>
                    {!returning && (
                      <div className="exp-progress">
                        <div className="ep-track">
                          <div className="ep-fill" style={{ width: `${(done / total) * 100}%`, background: color }} />
                        </div>
                        <span className="dim small">mesec {done} / {total}</span>
                      </div>
                    )}
                    <div className="exp-events dim small">
                      {returning
                        ? `↩ vrača se v kamp — še ${e.returnRemaining ?? 0} mesec(ev)`
                        : remaining === 0 ? 'prihod ta mesec' : `še ${remaining} mesec(ev) do cilja`}
                      {!returning && e.encountersLog.length > 0 && ` · ${e.encountersLog.slice(-1)[0]}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      </div>{/* main-cols */}

      {/* ─── SPODNJA VRSTICA: koraki + naslednji mesec ─── */}
      <footer className="bottom-bar">
        <div className="step-track">
          {['Začetek meseca', 'Pošlji odprave', 'Baza + naslednji mesec'].map((s, i) => (
            <div key={i} className={`step ${i === 2 ? 'active' : 'done'}`}>
              <span className="step-dot">{i}</span>
              <span className="step-label">{s}</span>
            </div>
          ))}
        </div>
        <div className="bb-phases"><PhaseHeader game={game} /></div>
        <div className="bottom-actions">
          <button className="back-btn" onClick={() => setTab('food')}>← Nazaj na kamp</button>
          <button className="exec-btn" onClick={handleRound} disabled={loading || over}>
            {loading ? '⟳  Izvajam…' : over ? '⚠  Preveč ljudi razporejenih' : 'NASLEDNJI MESEC →'}
          </button>
        </div>
      </footer>
    </div>
  );
}
