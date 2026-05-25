import { useState, useEffect, useRef } from 'react';
import type { GameState, HumanAxis, OddsPreview, AITreeNode, AIWeakPoint, RoundLog, CombatResult, AIPhase, Mission, HexTile, ScoutObjective, Expedition, NewExpeditionInput } from './types';
import { tileId } from './types';
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

const RATIONS: Record<number, { foodMult: number; popMin: number; popMax: number; strengthMult: number; label: string; emoji: string; color: string }> = {
  1: { foodMult: 0.50, popMin: -5, popMax: -3, strengthMult: 0.60, label: 'Lakota',   emoji: '💀', color: '#cc2222' },
  2: { foodMult: 0.75, popMin: -2, popMax: -1, strengthMult: 0.80, label: 'Skopo',    emoji: '🥄', color: '#cc7700' },
  3: { foodMult: 1.00, popMin:  0, popMax:  0, strengthMult: 1.00, label: 'Normalno', emoji: '🍽', color: '#888888' },
  4: { foodMult: 1.25, popMin:  1, popMax:  2, strengthMult: 1.15, label: 'Dobro',    emoji: '🍞', color: '#66aa44' },
  5: { foodMult: 1.50, popMin:  2, popMax:  4, strengthMult: 1.30, label: 'Obilje',   emoji: '🥩', color: '#22cc88' },
};

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

/** Dvojni meter znanja — naše vs AI */
function DualKnowledge({ ourK, aiK }: { ourK: number; aiK: number }) {
  const ourColor = ourK >= 0.6 ? '#22cc88' : ourK >= 0.3 ? '#3377cc' : '#2a4a6a';
  const aiColor  = aiK  >= 0.7 ? '#cc2222' : aiK  >= 0.4 ? '#cc7700' : '#553333';
  return (
    <div className="dual-knowledge">
      {/* Naše znanje o AI */}
      <div className="dk-meter">
        <div className="dk-label" style={{ color: ourColor }}>🔭 NAŠE</div>
        <div className="dk-val"   style={{ color: ourColor }}>{pct(ourK)}</div>
        <div className="dk-bar-track">
          <div className="dk-bar-fill" style={{ width: `${Math.round(ourK * 100)}%`, background: ourColor }} />
        </div>
      </div>
      {/* Ločilo */}
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

/** Faza header: badge, oznaka, pike za mesece, dvojni meter */
function PhaseHeader({ game }: { game: GameState }) {
  const p = PHASE[game.phase];
  const ourK = calcOurKnowledge(game.aiTree);
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
      <DualKnowledge ourK={ourK} aiK={game.aiKnowledge} />
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

/** Človekovo drevo napredka — 3 veje × 3 nivoji = 9 vozlišč */
type HumanNode = { axis: HumanAxis; level: 1 | 2 | 3; threshold: number; label: string; effect: string };

const HUMAN_TREE: HumanNode[] = [
  // Hiding ─ Skrivanje
  { axis: 'hiding',    level: 1, threshold: 3, label: 'Tihi kamp',         effect: '−25 % padec klanske podpore' },
  { axis: 'hiding',    level: 2, threshold: 6, label: 'Migracijska pot',   effect: '−50 % padec klanske podpore' },
  { axis: 'hiding',    level: 3, threshold: 9, label: 'Globoki bunker',    effect: '−75 % padec klanske podpore' },
  // Espionage ─ Špijonaža
  { axis: 'espionage', level: 1, threshold: 3, label: 'Sled v omrežju',    effect: '+20 % moč proti megli' },
  { axis: 'espionage', level: 2, threshold: 6, label: 'Globoka infiltrac.', effect: '+40 % moč proti megli' },
  { axis: 'espionage', level: 3, threshold: 9, label: 'Hrbtenica AI',      effect: '+60 % moč proti megli' },
  // Defense ─ Obramba
  { axis: 'defense',   level: 1, threshold: 3, label: 'Trdnjava',          effect: '−10 % bojnih izgub' },
  { axis: 'defense',   level: 2, threshold: 6, label: 'Bojna doktrina',    effect: '−20 % bojnih izgub' },
  { axis: 'defense',   level: 3, threshold: 9, label: 'Protinapad',        effect: '−30 % bojnih izgub' },
];

const HUMAN_AXIS_META: Record<HumanAxis, { icon: string; label: string; color: string }> = {
  hiding:    { icon: '👁‍🗨', label: 'SKRIVANJE',  color: '#22aa88' },
  espionage: { icon: '🕵',  label: 'ŠPIJONAŽA', color: '#3399cc' },
  defense:   { icon: '🛡',   label: 'OBRAMBA',   color: '#66bb55' },
};

const EMPTY_HISTORY: Record<HumanAxis, number> = { hiding: 0, espionage: 0, defense: 0 };

function HumanTree({ axisHistory, currentAxis, onFocusChange }: {
  axisHistory?: Record<HumanAxis, number>;
  currentAxis: HumanAxis;
  onFocusChange: (a: HumanAxis) => void;
}) {
  const hist = { ...EMPTY_HISTORY, ...(axisHistory ?? {}) };
  const axes: HumanAxis[] = ['hiding', 'espionage', 'defense'];
  const totalUnlocked = HUMAN_TREE.filter(n => hist[n.axis] >= n.threshold).length;

  return (
    <div className="panel human-tree">
      <div className="panel-head">
        <h3>NAŠ NAČRT PREŽIVETJA · klikni vejo za fokus tega meseca</h3>
        <span className="panel-badge teal">{totalUnlocked}/{HUMAN_TREE.length} odklenjenih</span>
      </div>
      <div className="ht-branches">
        {axes.map(ax => {
          const meta = HUMAN_AXIS_META[ax];
          const cnt = hist[ax];
          const isCurrent = currentAxis === ax;
          return (
            <div key={ax} className={`ht-branch ${isCurrent ? 'ht-current ht-focus' : ''}`}
                 onClick={() => onFocusChange(ax)}
                 style={isCurrent ? { background: '#0a1a14', borderLeft: `2px solid ${meta.color}` } : { cursor: 'pointer' }}>
              <div className="ht-br-head" style={{ color: meta.color }}>
                <span className="ht-br-icon">{meta.icon}</span>
                <span className="ht-br-label">{meta.label}</span>
                {isCurrent && <span className="ht-focus-tag" style={{ background: meta.color }}>FOKUS</span>}
                <span className="ht-br-count">{cnt}r</span>
              </div>
              <div className="ht-nodes">
                {HUMAN_TREE.filter(n => n.axis === ax).map(n => {
                  const unlocked = cnt >= n.threshold;
                  const progress = Math.min(1, cnt / n.threshold);
                  return (
                    <div key={n.label} className={`ht-node ${unlocked ? 'unlocked' : 'locked'}`}
                         style={unlocked ? { borderColor: meta.color } : {}}>
                      <div className="ht-node-head">
                        <span className="ht-node-lvl" style={{ color: unlocked ? meta.color : '#333' }}>
                          {unlocked ? '◆' : `${cnt}/${n.threshold}`}
                        </span>
                        <span className="ht-node-label" style={{ color: unlocked ? '#c8e0d0' : '#3a3a3a' }}>
                          {n.label}
                        </span>
                      </div>
                      <div className="ht-node-eff" style={{ color: unlocked ? meta.color : '#2a2a2a' }}>
                        {n.effect}
                      </div>
                      {!unlocked && (
                        <div className="ht-node-track">
                          <div className="ht-node-fill" style={{ width: `${progress * 100}%`, background: meta.color, opacity: .35 }} />
                        </div>
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

/** AI drevo — vse faze */
function AITree({ nodes, justRevealed }: { nodes: AITreeNode[]; justRevealed: Set<string> }) {
  const phases: Array<keyof typeof PHASE> = ['find', 'understand', 'eliminate'];
  const revealedCount = nodes.filter(n => n.visibility === 'revealed').length;
  const partialCount  = nodes.filter(n => n.visibility === 'partial').length;
  return (
    <div className="panel ai-tree">
      <div className="panel-head">
        <h3>AI NAČRTOVALNO DREVO</h3>
        <span className="panel-badge">
          {revealedCount} odkritih · {partialCount} delnih · {nodes.length} skupaj
        </span>
      </div>
      {phases.map(ph => (
        <div key={ph} className="tree-section">
          <div className="tree-ph-label" style={{ color: PHASE[ph].color }}>
            ▸ {PHASE[ph].full}
          </div>
          <div className="node-grid">
            {nodes.filter(n => n.phase === ph).map(n =>
              <NodeCard key={n.id} node={n} flash={justRevealed.has(n.id)} />
            )}
          </div>
        </div>
      ))}
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
function Missions({ wps, aiTree, active, plan, planR, onPlanChange, onRationsChange, odds, availablePop }: {
  wps: AIWeakPoint[]; aiTree: AITreeNode[];
  active: Mission[];
  plan: Record<string, number>;
  planR: Record<string, number>;
  onPlanChange: (id: string, n: number) => void;
  onRationsChange: (id: string, lvl: number) => void;
  odds: OddsPreview | null;
  availablePop: number;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>ODPRAVE PROTI ŠIBKIM TOČKAM AI</h3>
        <span className="panel-badge">{wps.filter(w => w.exploited).length}/{wps.length} uničenih</span>
      </div>
      {wps.map(wp => {
        const fog = wpFogLevel(wp, aiTree);
        const cls = wp.exploited ? 'exploited' : fog === 'known' ? 'discovered' : fog === 'suspected' ? 'suspected' : 'hidden';
        const icon = wp.exploited ? '✓' : fog === 'known' ? '◆' : fog === 'suspected' ? '◌' : '?';
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

        return (
          <div key={wp.id} className={`wp-card mission-card ${cls}`}>
            <div className="wp-icon">{icon}</div>
            <div className="wp-body">
              <div className="wp-name">{name}</div>
              {wp.exploited && <span className="wp-done-tag">UNIČENO</span>}
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
  key: 'c' | 'd' | 'f' | 's' | '_';
  label: string;
  icon: string;
  color: string;
  count: number;
  yieldText?: string;
  probLabel?: string;
  prob?: number;
  extraLabel?: React.ReactNode;   // dodatne komponente v naslovni vrstici (npr. day/night split slider)
};

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
    const newCounts = [...drag.startCounts];
    const i = drag.handleIdx;
    if (delta > 0) {
      const give = Math.min(delta, newCounts[i + 1]);
      newCounts[i + 1] -= give;
      newCounts[i] += give;
    } else if (delta < 0) {
      const give = Math.min(-delta, newCounts[i]);
      newCounts[i] -= give;
      newCounts[i + 1] += give;
    }
    onTransfer(newCounts);
  }
  function endDrag(e: React.PointerEvent) {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDrag(null);
  }

  // Skupna populacija za prikaz = available (vključen "prosti" segment v vsoti)
  const total = Math.max(1, available);

  return (
    <div className="people-allocator">
      {/* Naslovi vrstic */}
      <div className="pa-labels">
        {roles.map(r => (
          <div key={r.key} className="pa-label" style={{ flex: Math.max(0.6, r.count / total), color: r.color }}>
            <div className="pa-label-head">
              <span>{r.icon} <b style={{ color: r.color }}>{r.label}</b></span>
              <b className="pa-count">{r.count}</b>
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
        ))}
      </div>

      {/* Glavna razdelilna palica z ljudmi */}
      <div className="pa-bar" ref={barRef}>
        {roles.map((r, i) => (
          <div key={r.key} className={`pa-seg pa-${r.key}`}
            style={{ flex: Math.max(0.6, r.count / total), background: r.color + '14', borderTopColor: r.color }}>
            <div className="pa-people">
              {Array.from({ length: r.count }, (_, idx) => (
                <div key={idx} className="pa-person" style={{ background: r.color + '40', borderColor: r.color, color: r.color }}>
                  {r.icon}
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* Vlečne meje */}
        {roles.slice(0, -1).map((_, i) => {
          // pozicija meje = vsota count[0..i] / total
          const before = roles.slice(0, i + 1).reduce((s, r) => s + Math.max(0.6, r.count / total), 0);
          const totalFlex = roles.reduce((s, r) => s + Math.max(0.6, r.count / total), 0);
          const leftPct = before / totalFlex * 100;
          return (
            <div key={i} className={`pa-handle ${drag?.handleIdx === i ? 'dragging' : ''}`}
              style={{ left: `${leftPct}%` }}
              onPointerDown={e => startDrag(i, e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}>
              <div className="pa-handle-bar" />
              <div className="pa-handle-grip">⇔</div>
            </div>
          );
        })}
      </div>

      {(inMissions + newMission > 0) && (
        <div className="pa-mission-note dim small">
          🎯 {inMissions + newMission} ljudi v misijah/odpravah (niso na voljo).
        </div>
      )}
    </div>
  );
}

/** Vizualna razporeditev populacije */
function PeopleBar({ pop, combatants, dayGuard, nightGuard, foragers, scouts, inMissions, newMission }: {
  pop: number; combatants: number; dayGuard: number; nightGuard: number;
  foragers: number; scouts: number; inMissions: number; newMission: number;
}) {
  const used = combatants + dayGuard + nightGuard + foragers + scouts + inMissions + newMission;
  const free = Math.max(0, pop - used);
  const over = used > pop;
  if (pop === 0) return null;
  return (
    <div className="people-bar-wrap">
      <div className={`people-bar ${over ? 'over' : ''}`}>
        {combatants > 0 && <div className="pb-seg combat"   style={{ flex: combatants }} title={`Napad: ${combatants}`} />}
        {dayGuard   > 0 && <div className="pb-seg day"      style={{ flex: dayGuard }}   title={`Dnevna straža: ${dayGuard}`} />}
        {nightGuard > 0 && <div className="pb-seg night"    style={{ flex: nightGuard }} title={`Nočna straža: ${nightGuard}`} />}
        {foragers   > 0 && <div className="pb-seg forage"   style={{ flex: foragers }}   title={`Nabiralci: ${foragers}`} />}
        {scouts     > 0 && <div className="pb-seg scout"    style={{ flex: scouts }}     title={`Izvidniki: ${scouts}`} />}
        {(inMissions + newMission) > 0 && <div className="pb-seg mission" style={{ flex: inMissions + newMission }} title={`V misijah: ${inMissions + newMission}`} />}
        {free       > 0 && <div className="pb-seg free"     style={{ flex: free }}       title={`Prosti: ${free}`} />}
      </div>
      <div className="pb-legend">
        <span className="pbl combat">⚔ {combatants}</span>
        <span className="pbl day">🌞 {dayGuard}</span>
        <span className="pbl night">🌜 {nightGuard}</span>
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
interface EventEntry {
  round: number;
  phase: AIPhase;
  narrative: string;
  ledger: LedgerItem[];
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

function EventLog({ entries }: { entries: EventEntry[] }) {
  return (
    <div className="panel event-log-panel">
      <div className="panel-head">
        <h3>DNEVNIK DOGODKOV</h3>
        <span className="panel-badge">{entries.length}</span>
      </div>
      <div className="event-log-scroll">
        {entries.length === 0 && (
          <div className="dim small" style={{ padding: 12 }}>
            Mesec še ni minil. Razporedi ekipe in izvedi mesec.
          </div>
        )}
        {entries.map((e, i) => (
          <div key={e.ts} className="event-entry">
            <div className="ee-head">
              <span className="ee-round" style={{ color: PHASE[e.phase].color }}>M{e.round}</span>
              <span className="ee-phase dim small">{PHASE[e.phase].label}</span>
              {i === 0 && <span className="ee-latest">NOVO</span>}
            </div>
            <p className="ee-text">{e.narrative}</p>
            {e.ledger.length > 0 && (
              <div className="ee-ledger">
                {e.ledger.map((item, idx) => <LedgerChip key={idx} item={item} />)}
              </div>
            )}
          </div>
        ))}
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
            {r.defendersLost > 0   && <div className="rl-neg">− {r.defendersLost} branilcev</div>}
            {r.foragersLost > 0    && <div className="rl-neg">− {r.foragersLost} nabiralcev</div>}
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
function HexMap({ tiles, draftPath, onPathClick, expeditions, wps, drawingMode }: {
  tiles: HexTile[];
  draftPath: Array<{ q: number; r: number }>;
  onPathClick: (tile: { q: number; r: number }) => void;
  expeditions: Expedition[];
  wps: AIWeakPoint[];
  drawingMode: boolean;
}) {
  const [selectedExpId, setSelectedExpId] = useState<string | null>(null);
  const [hoveredExpId, setHoveredExpId]   = useState<string | null>(null);
  const popExpId = selectedExpId ?? hoveredExpId;
  const SIZE = 36;
  const pts = tiles.map(t => hexToPixel(t.q, t.r, SIZE));
  const minX = Math.min(...pts.map(p => p.x)) - SIZE;
  const maxX = Math.max(...pts.map(p => p.x)) + SIZE;
  const minY = Math.min(...pts.map(p => p.y)) - SIZE;
  const maxY = Math.max(...pts.map(p => p.y)) + SIZE;
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

        {/* Path lines */}
        {draftPath.length > 1 && (
          <g className="path-lines">
            {draftPath.slice(0, -1).map((s, i) => {
              const a = shift(hexToPixel(s.q, s.r, SIZE));
              const b = shift(hexToPixel(draftPath[i + 1].q, draftPath[i + 1].r, SIZE));
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#22ccff" strokeWidth="2" strokeDasharray="4 3" />;
            })}
          </g>
        )}

        {tiles.map(t => {
          const id = tileId(t);
          const p = shift(hexToPixel(t.q, t.r, SIZE));
          const wp = t.hidesWeakPointId ? wpById[t.hidesWeakPointId] : undefined;
          const wpVisible = wp && t.researchProgress >= 0.50;

          let { fill, stroke, labelColor } = hexColorByProgress(t.researchProgress);
          let label = '';

          if (t.isClanCamp) {
            fill = '#0a2018'; stroke = '#22aa88'; label = '⌂'; labelColor = '#66ccaa';
          } else if (t.isAICore) {
            fill = '#220606'; stroke = '#cc2222'; label = '☣'; labelColor = '#cc3333';
          } else if (t.researchProgress < 0.25) {
            label = '?';
          } else if (t.researchProgress < 0.50) {
            label = '·';
          } else {
            // raziskan
            label = wpVisible ? '◆' : '';
            if (wpVisible) { labelColor = '#cc8800'; stroke = '#cc8800'; }
          }

          const isInDraft = inDraft(t);
          const isLast = lastStep && lastStep.q === t.q && lastStep.r === t.r;
          if (isInDraft) stroke = '#22ccff';

          const canClickDraw = drawingMode && !t.isClanCamp && (
            // Lahko klikneš heks, ki je sosednji zadnjemu v poti
            (lastStep && areNeighbors(lastStep, t)) ||
            // Ali odznačiš heks v poti (klik na zadnjega)
            isLast
          );

          return (
            <g key={id}
               className={`hex-tile ${canClickDraw ? 'clickable' : ''} ${isInDraft ? 'in-draft' : ''}`}
               onClick={canClickDraw ? () => onPathClick({ q: t.q, r: t.r }) : undefined}>
              <path d={hexPath(p.x, p.y, SIZE)} fill={fill} stroke={stroke}
                strokeWidth={isInDraft ? 2.5 : 1} />
              {label && (
                <text x={p.x} y={p.y + 4} textAnchor="middle"
                  fontSize={t.isClanCamp || t.isAICore || wpVisible ? 22 : 18}
                  fill={labelColor} fontFamily="'Courier New', monospace"
                  fontWeight={t.isClanCamp || t.isAICore || wpVisible ? 'bold' : 'normal'}>
                  {label}
                </text>
              )}
              {/* Progress overlay: za delno raziskane prikaže koliko je raziskano */}
              {!t.isClanCamp && !t.isAICore && t.researchProgress > 0 && t.researchProgress < 1 && (
                <text x={p.x} y={p.y - SIZE * 0.45} textAnchor="middle"
                  fontSize="9" fill="#66aacc" fontFamily="'Courier New', monospace">
                  {Math.round(t.researchProgress * 100)}%
                </text>
              )}
              {/* Številka koraka v draft poti */}
              {isInDraft && draftIdx(t) > 0 && (
                <circle cx={p.x + SIZE * 0.55} cy={p.y - SIZE * 0.5} r="9" fill="#22ccff" />
              )}
              {isInDraft && draftIdx(t) > 0 && (
                <text x={p.x + SIZE * 0.55} y={p.y - SIZE * 0.5 + 3} textAnchor="middle"
                  fontSize="10" fill="#000" fontWeight="bold" fontFamily="'Courier New', monospace">
                  {draftIdx(t)}
                </text>
              )}
            </g>
          );
        })}

        {/* Aktivne odprave kot ikone — hover + klik za info */}
        {expPositions.map(({ exp, tile }) => {
          if (!tile) return null;
          const p = shift(hexToPixel(tile.q, tile.r, SIZE));
          const color = exp.kind === 'mission' ? '#cc8800' : '#22ccff';
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
      </svg>

      {/* Popup za izbrano/hovered odpravo */}
      {popExpId && (() => {
        const exp = expeditions.find(e => e.id === popExpId);
        if (!exp) return null;
        const tile = exp.path[exp.currentIndex];
        const target = exp.path[exp.path.length - 1];
        const stepsLeft = exp.path.length - 1 - exp.currentIndex;
        const monthsLeft = Math.ceil(stepsLeft / 2);
        const color = exp.kind === 'mission' ? '#cc8800' : '#22ccff';
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

/** Izbira cilja izvidnikov (3 možnosti) */
function ScoutObjectiveSelector({ value, onChange }: { value: ScoutObjective; onChange: (o: ScoutObjective) => void }) {
  const opts: Array<{ id: ScoutObjective; icon: string; label: string; desc: string; color: string }> = [
    { id: 'map',           icon: '🗺',  label: 'Razišči mapo',       desc: 'Razkrij meglo + šibke točke',     color: '#22ccff' },
    { id: 'ai_robots',     icon: '🤖', label: 'Razišči AI robote',  desc: '+intel = boljši bojni odstotki', color: '#cc8800' },
    { id: 'ai_weakpoints', icon: '🎯', label: 'Razišči ranljivosti', desc: 'Razkrij AI načrtovalno drevo',   color: '#cc3333' },
  ];
  return (
    <div className="scout-objectives">
      {opts.map(o => (
        <button key={o.id} className={`so-btn ${value === o.id ? 'sel' : ''}`}
          style={value === o.id ? { borderColor: o.color, color: o.color } : {}}
          onClick={() => onChange(o.id)}>
          <span className="so-icon">{o.icon}</span>
          <span className="so-label">{o.label}</span>
          <span className="so-desc">{o.desc}</span>
        </button>
      ))}
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

// ─── Glavna komponenta ────────────────────────────────────────────────────────

export default function App() {
  const [game,       setGame]       = useState<GameState | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [axis,       setAxis]       = useState<HumanAxis>('hiding');
  const [combatants,   setCombatants]   = useState(0);
  const [defenseTotal, setDefenseTotal] = useState(15);
  const [dayGuard,     setDayGuard]     = useState(8); // dnevni del; nočni = total - day
  const [foragers,     setForagers]     = useState(20);
  const [scouts,       setScouts]       = useState(10);
  const [missions,     setMissions]     = useState<Record<string, number>>({});
  const [missionR,     setMissionR]     = useState<Record<string, number>>({});
  const [scoutObj,     setScoutObj]     = useState<ScoutObjective>('ai_weakpoints');
  const [scoutTargets, setScoutTargets] = useState<Set<string>>(new Set());
  const [eventLog,     setEventLog]     = useState<EventEntry[]>([]);
  const [draftPath,    setDraftPath]    = useState<Array<{ q: number; r: number }>>([]);

  const nightGuard = Math.max(0, defenseTotal - dayGuard);
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

  // Pri map mode poti vedno začni iz klanovega kampa
  useEffect(() => {
    if (!game) return;
    if (scoutObj === 'map' && draftPath.length === 0) {
      const clan = game.mapTiles?.find(t => t.isClanCamp);
      if (clan) setDraftPath([{ q: clan.q, r: clan.r }]);
    }
    if (scoutObj !== 'map' && draftPath.length > 0) {
      setDraftPath([]);
    }
  }, [scoutObj, game?.mapTiles]);

  // Akumuliraj log dogodkov — vsak nov mesec doda vnos z dogodki + poračunom
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
      if (dS !== 0) ledger.push({ icon: '🍞', label: 'hrana',  value: dS });
      if (dC !== 0) ledger.push({ icon: '⚔',  label: 'orožje', value: dC });
      if (dI !== 0) ledger.push({ icon: '👁',  label: 'intel',  value: dI });
      if (log.combat?.aiRobotsDestroyed)
        ledger.push({ icon: '🤖', label: 'AI roboti', value: -log.combat.aiRobotsDestroyed });
      if (log.raid?.aiRobotsDestroyed)
        ledger.push({ icon: '🤖', label: 'AI roboti', value: -log.raid.aiRobotsDestroyed });
      if (log.raid?.weaponsDestroyed)
        ledger.push({ icon: '💥', label: 'uničeno orožje', value: -log.raid.weaponsDestroyed });
      if (log.revealedNodes?.length)
        ledger.push({ icon: '🔍', label: 'AI vozlišča', value: log.revealedNodes.length });
      if (log.aiKnowledgeDelta && Math.round(log.aiKnowledgeDelta * 100) !== 0)
        ledger.push({ icon: '🕵', label: 'AI ve o nas %', value: Math.round(log.aiKnowledgeDelta * 100) });
      if (log.clanActivityDelta && Math.round(log.clanActivityDelta * 100) !== 0)
        ledger.push({ icon: '🌍', label: 'klani %', value: Math.round(log.clanActivityDelta * 100) });
      const entry: EventEntry = {
        round: log.round, phase: log.phase,
        narrative: log.narrative, ledger,
        ts: Date.now(),
      };
      return [entry, ...prev].slice(0, 50);
    });
  }, [game?.totalRounds]);

  // Preview odds — game?.totalRounds zagotovi ponoven klic po vsaki rundi
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const t = setTimeout(() => {
      previewOdds(game.runId, { axis, combatants, dayGuard, nightGuard, foragers, scouts, rations,
        missionAssignments: missions, missionRations: missionR,
        scoutPlan: { objective: scoutObj, targetTileIds: Array.from(scoutTargets) } }).then(setOdds).catch(() => setOdds(null));
    }, 250);
    return () => clearTimeout(t);
  }, [game?.runId, game?.totalRounds, axis, combatants, defenseTotal, dayGuard, foragers, scouts, rations,
      JSON.stringify(missions), JSON.stringify(missionR), scoutObj, scoutTargets.size]);

  const handleNew = async () => {
    setLoading(true);
    try {
      const g = await createGame();
      setGame(g);
      localStorage.setItem(STORAGE_KEY, g.runId);
      setAxis('hiding'); setCombatants(0); setDefenseTotal(15); setDayGuard(8); setForagers(20); setScouts(10); setTargetWP(''); setRations(3); setMissions({}); setMissionR({}); setScoutObj('ai_weakpoints'); setScoutTargets(new Set()); setEventLog([]); setDraftPath([]);
    } finally { setLoading(false); }
  };

  const handleRound = async () => {
    if (!game || loading) return;
    setLoading(true);
    try {
      const newExpeditions: NewExpeditionInput[] = [];
      if (scoutObj === 'map' && draftPath.length >= 2 && scouts > 0) {
        newExpeditions.push({ kind: 'scout', path: draftPath, assigned: scouts, rations });
      }
      const { state } = await playRound(game.runId, {
        assignment: { axis, combatants, dayGuard, nightGuard, foragers, scouts, rations,
          missionAssignments: missions, missionRations: missionR,
          scoutPlan: { objective: scoutObj, targetTileIds: Array.from(scoutTargets) },
          newExpeditions: newExpeditions.length > 0 ? newExpeditions : undefined },
        targetWeakPoint: targetWP || undefined,
      });
      setMissions({});
      setScoutTargets(new Set());
      setDraftPath([]);
      setGame(state);
      setOdds(null);
    } finally { setLoading(false); }
  };

  const pop = game?.population ?? 0;
  // Ljudje v aktivnih misijah + odpravah (engine drži)
  const inMissions = (game?.activeMissions ?? []).reduce((s, m) => s + m.assigned, 0)
                   + (game?.expeditions ?? []).reduce((s, e) => s + e.assigned, 0);
  // Pa še novi razporedi v misije ta mesec
  const newMissionPeople = Object.values(missions).reduce((s, v) => s + v, 0);
  const assignedHome = combatants + defenseTotal + foragers + scouts;
  const assigned    = assignedHome + newMissionPeople;
  const availablePop = Math.max(0, pop - inMissions);
  const over = assignedHome + newMissionPeople > availablePop;

  const weaponCap = game ? Math.floor(game.resources.combat) : 0;
  const armedTotal = combatants + defenseTotal;
  const overArmed  = armedTotal > weaponCap;

  type SliderKey = 'c' | 'd' | 'f' | 's';
  function setSliderClamped(which: SliderKey, newVal: number) {
    const v = Math.max(0, Math.min(availablePop, Math.floor(newVal)));
    const cur = { c: combatants, d: defenseTotal, f: foragers, s: scouts };
    cur[which] = v;
    const total = cur.c + cur.d + cur.f + cur.s + newMissionPeople;
    if (total <= availablePop) {
      // Posebej: če se spremeni "d", ohrani split razmerje
      if (which === 'd') {
        const ratio = defenseTotal > 0 ? dayGuard / defenseTotal : 0.5;
        setDayGuard(Math.round(cur.d * ratio));
      }
      setCombatants(cur.c); setDefenseTotal(cur.d); setForagers(cur.f); setScouts(cur.s);
      return;
    }
    const others = (['c','d','f','s'] as const).filter(k => k !== which);
    const otherSum = others.reduce((s, k) => s + cur[k], 0);
    const capLeft = Math.max(0, availablePop - v - newMissionPeople);
    if (otherSum === 0) {
      others.forEach(k => { cur[k] = 0; });
    } else {
      const scale = capLeft / otherSum;
      others.forEach(k => { cur[k] = Math.floor(cur[k] * scale); });
    }
    // Če smo skrčili defenseTotal, prilagodi dayGuard
    if (cur.d !== defenseTotal) {
      const ratio = defenseTotal > 0 ? dayGuard / defenseTotal : 0.5;
      setDayGuard(Math.round(cur.d * ratio));
    }
    if (which === 'd') {
      const ratio = defenseTotal > 0 ? dayGuard / defenseTotal : 0.5;
      setDayGuard(Math.round(cur.d * ratio));
    }
    setCombatants(cur.c); setDefenseTotal(cur.d); setForagers(cur.f); setScouts(cur.s);
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
  const TILES_PER_MONTH_FE = 2;
  const draftPathMonths = Math.max(0, Math.ceil((draftPath.length - 1) / TILES_PER_MONTH_FE));
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
    let pNo = 1;
    for (const step of draftPath.slice(1)) {
      const tile = game.mapTiles?.find(t => t.q === step.q && t.r === step.r);
      if (!tile) continue;
      const distFromCamp = hexDistFE({ q: tile.q, r: tile.r }, { q: clan.q, r: clan.r });
      const base = SCOUT_CAPTURE_BASE_FE + SCOUT_CAPTURE_PER_SCOUT_FE * scouts + AI_KNOW_BONUS_FE * game.aiKnowledge;
      const p = Math.max(0, Math.min(0.85, base * tileEncounterMultFE(tile.researchProgress, distFromCamp)));
      pNo *= (1 - p);
    }
    return 1 - pNo;
  })();
  const canStartExpedition = scoutObj === 'map' && draftPath.length >= 2 && scouts > 0;

  function setMissionAssignment(wpId: string, n: number) {
    const v = Math.max(0, Math.floor(n));
    const newMap = { ...missions, [wpId]: v };
    if (v === 0) delete newMap[wpId];
    setMissions(newMap);
  }
  function setMissionRations(wpId: string, lvl: number) {
    setMissionR({ ...missionR, [wpId]: lvl });
  }

  function autoFitAllocation() {
    if (assigned === 0 || availablePop === 0) return;
    const scale = availablePop / assigned;
    setCombatants(Math.floor(combatants * scale));
    const newDefTotal = Math.floor(defenseTotal * scale);
    const ratio = defenseTotal > 0 ? dayGuard / defenseTotal : 0.5;
    setDefenseTotal(newDefTotal);
    setDayGuard(Math.round(newDefTotal * ratio));
    setForagers(Math.floor(foragers * scale));
    setScouts(Math.floor(scouts * scale));
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
  const scoutIntel   = Math.floor(scouts   * 8 * rTier.strengthMult);
  const foodCost     = Math.round(game.population * rTier.foodMult);
  const survBalance  = foragerYield - foodCost;

  return (
    <div className="hud">
      {phaseTrans && (
        <PhaseTransitionBanner
          fromPhase={phaseTrans.from}
          toPhase={phaseTrans.to}
          narrative={phaseTrans.narrative}
          onClose={() => setPhaseTrans(null)}
        />
      )}
      {/* ─── PAS 1: Humanity vs AI score ─── */}
      <PhaseHeader game={game} />

      {/* ─── PAS 2: Resursi klan ─── */}
      <ResourceRow game={game} />

      {/* ─── PAS 3: Mapa + Log dogajanja ─── */}
      <div className="band band-map-log">
        <div className="panel map-panel">
          <div className="panel-head">
            <h3>OPERATIVNA MAPA</h3>
            <span className="panel-badge">
              {(game.mapTiles ?? []).filter(t => t.researchProgress >= 0.50).length} / {(game.mapTiles ?? []).length} raziskanih
            </span>
          </div>
          <div className="map-layout">
            <HexMap tiles={game.mapTiles ?? []} draftPath={draftPath}
              onPathClick={handlePathClick} expeditions={game.expeditions ?? []}
              wps={game.aiWeakPoints} drawingMode={scoutObj === 'map'} />
            <div className="map-side">
              <div className="cmd-label">Cilj izvidnikov ta mesec ({scouts} izvidnikov)</div>
              <ScoutObjectiveSelector value={scoutObj} onChange={setScoutObj} />
              {scoutObj === 'map' && (
                <div className="path-builder">
                  <div className="pb-instr dim small">
                    Klikni sosednji heks, da gradiš pot. Klik na zadnji heks = odznači.
                  </div>
                  {draftPath.length < 2 && (
                    <div className="map-hint">Pot je prazna. Prvi heks je kamp ⌂ — klikni sosednjega.</div>
                  )}
                  {draftPath.length >= 2 && (
                    <div className="path-stats">
                      <div className="ps-row">
                        <span className="dim small">Korakov:</span>
                        <b>{draftPath.length - 1}</b>
                      </div>
                      <div className="ps-row">
                        <span className="dim small">Trajanje:</span>
                        <b style={{ color: '#cc8800' }}>{draftPathMonths} mesec(ev)</b>
                      </div>
                      <div className="ps-row">
                        <span className="dim small">Skupno tveganje srečanja:</span>
                        <b style={{ color: probColor(1 - draftRisk) }}>{Math.round(draftRisk * 100)}%</b>
                      </div>
                      <div className="ps-row">
                        <span className="dim small">Izvidnikov:</span>
                        <b style={{ color: '#3377cc' }}>{scouts}</b>
                      </div>
                    </div>
                  )}
                  <button className="autofit-btn" disabled={!canStartExpedition}
                    onClick={() => { /* odprava se odda ob izvedbi meseca; tukaj samo info */ }}>
                    {canStartExpedition ? '▶ Odprava se odda ob izvedbi meseca' : 'Najprej nariši pot in določi izvidnike'}
                  </button>
                </div>
              )}
              <div className="map-legend dim small">
                <div><span style={{ color: '#66ccaa' }}>⌂</span> klan · <span style={{ color: '#cc3333' }}>☣</span> AI jedro</div>
                <div><span style={{ color: '#cc8800' }}>◆</span> šibka točka · <span style={{ color: '#3377cc' }}>●</span> aktivna odprava</div>
                <div>rdeč = neraziskan (&lt;50%) · moder = raziskan · sij = domač (100%)</div>
              </div>
            </div>
          </div>

          {/* Aktivne odprave */}
          {(game.expeditions ?? []).length > 0 && (
            <div className="active-expeditions">
              <div className="cmd-label" style={{ marginTop: 12, marginBottom: 6 }}>Aktivne odprave</div>
              {game.expeditions.map(e => {
                const steps = e.path.length - 1;
                const done = e.currentIndex;
                const target = e.path[e.path.length - 1];
                return (
                  <div key={e.id} className="exp-card">
                    <div className="exp-head">
                      <span className="exp-kind" style={{ color: e.kind === 'mission' ? '#cc8800' : '#22ccff' }}>
                        {e.kind === 'mission' ? '🎯' : '🔭'} {e.assigned} ljudi
                      </span>
                      <span className="dim small">cilj: ({target?.q},{target?.r})</span>
                    </div>
                    <div className="exp-progress">
                      <div className="ep-track">
                        <div className="ep-fill" style={{ width: `${(done / Math.max(1, steps)) * 100}%`,
                          background: e.kind === 'mission' ? '#cc8800' : '#22ccff' }} />
                      </div>
                      <span className="dim small">{done} / {steps}</span>
                    </div>
                    {e.encountersLog.length > 0 && (
                      <div className="exp-events dim small">
                        {e.encountersLog.slice(-2).join(' · ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <EventLog entries={eventLog} />
      </div>

      {/* ─── PAS 4: Razporedi ljudi ─── */}
      <div className="panel command-panel">
        <div className="panel-head">
          <h3>RAZPOREDI ENOTE</h3>
          <span className="dim small">
            {availablePop} razpoložljivih
            {inMissions > 0 && ` · ${inMissions} v aktivnih misijah`}
          </span>
        </div>

        <div className="cmd-section">
          <div className="cmd-label">Obroki · določajo porabo hrane, moč ljudi in rast populacije</div>
          <RationsSelector value={rations} onChange={setRations} pop={pop} />
        </div>

        <div className="cmd-section">
          {odds && (
            <div className="status-row">
              <div className="raid-warning" style={{ borderColor: probColor(1 - odds.raidProbability) }}>
                <span>⚠ Verjetnost napada AI:</span>
                <span className="raid-prob" style={{ color: probColor(1 - odds.raidProbability) }}>
                  {Math.round(odds.raidProbability * 100)}%
                </span>
              </div>
              <div className="intel-bonus">
                <span className="dim small">Intel bonus v vseh bojih:</span>
                <span style={{ color: '#3388cc' }}>+{Math.round(odds.intelBonus * 100)}%</span>
              </div>
            </div>
          )}
          {overArmed && (
            <div className="weapon-warning">
              ⚠ Premalo orožja: imaš {weaponCap}, v boju {armedTotal} (napad+obramba). Engine skrči.
            </div>
          )}

          {/* Vizualni razdelilnik ljudi po vlogah */}
          <PeopleAllocator
            available={availablePop}
            inMissions={inMissions}
            newMission={newMissionPeople}
            roles={[
              { key: 'c', label: 'Napad',     icon: '⚔', color: '#cc4433', count: combatants,
                yieldText: `+${(combatants * 1.2 * rTier.strengthMult).toFixed(0)} moč · ${combatants} orožja`,
                probLabel: combatants > 0 ? 'Zmaga' : undefined, prob: combatants > 0 ? odds?.successProbability : undefined },
              { key: 'd', label: 'Obramba',   icon: '🛡', color: '#66aabb', count: defenseTotal,
                yieldText: `${defenseTotal} stražarjev · ${defenseTotal} orožja`,
                extraLabel: defenseTotal > 0 ? (
                  <div className="defense-split inline">
                    <div className="ds-prob-row">
                      <span className="ds-prob-day small">
                        🌞 dan <b>{dayGuard}</b>
                        <span style={{ color: probColor(odds?.raidRepelProbabilityDay ?? 0), marginLeft: 4 }}>
                          {odds ? Math.round(odds.raidRepelProbabilityDay * 100) : 0}%
                        </span>
                      </span>
                      <span className="ds-prob-night small">
                        <span style={{ color: probColor(odds?.raidRepelProbabilityNight ?? 0), marginRight: 4 }}>
                          {odds ? Math.round(odds.raidRepelProbabilityNight * 100) : 0}%
                        </span>
                        <b>{nightGuard}</b> noč 🌜
                      </span>
                    </div>
                    <input type="range" min={0} max={defenseTotal} value={dayGuard} step={1}
                      onChange={e => setDayGuard(Math.max(0, Math.min(defenseTotal, +e.target.value)))}
                      className="ds-slider"
                      style={{ ['--pct' as never]: `${defenseTotal > 0 ? (dayGuard / defenseTotal * 100).toFixed(1) : 0}%` } as React.CSSProperties} />
                  </div>
                ) : undefined },
              { key: 'f', label: 'Nabiralci', icon: '🌾', color: '#6aa630', count: foragers,
                yieldText: `${survBalance >= 0 ? '+' : ''}${survBalance} hrana`,
                probLabel: 'Brez izgub', prob: odds?.forageSafetyProbability },
              { key: 's', label: 'Izvidniki', icon: '🔭', color: '#3377cc', count: scouts,
                yieldText: `+${scoutIntel} intel`,
                probLabel: scouts > 0 ? 'Uspeh' : undefined, prob: scouts > 0 ? odds?.scoutSuccessProbability : undefined },
              { key: '_', label: 'Prosti',    icon: '·', color: '#666666', count: Math.max(0, availablePop - combatants - defenseTotal - foragers - scouts) },
            ]}
            onTransfer={(nc) => {
              const [nC, nD, nF, nS] = nc;
              // Ohrani day/night razmerje pri spremembi obrambe
              if (nD !== defenseTotal && defenseTotal > 0) {
                const ratio = dayGuard / defenseTotal;
                setDayGuard(Math.round(nD * ratio));
              } else if (nD !== defenseTotal && defenseTotal === 0) {
                setDayGuard(Math.floor(nD / 2));
              }
              setCombatants(nC); setDefenseTotal(nD); setForagers(nF); setScouts(nS);
            }}
          />


          {over && (
            <button className="autofit-btn" onClick={autoFitAllocation}>
              ✓ Avto-popravi razporeditev
            </button>
          )}
        </div>

        <OddsDisplay odds={odds} combatants={combatants} />

        <button className="exec-btn" onClick={handleRound} disabled={loading || over}>
          {loading ? '⟳  Izvajam…' : over ? '⚠  Preveč ljudi razporejenih' : '▶  IZVEDI MESEC'}
        </button>
        <button className="newgame-btn" onClick={handleNew} disabled={loading}>↺ Nova igra</button>
      </div>

      {/* ─── PAS 5: Skill drevesi ─── */}
      <div className="band band-trees">
        <HumanTree axisHistory={game.axisHistory} currentAxis={axis} onFocusChange={setAxis} />
        <AITree nodes={game.aiTree} justRevealed={justRevealed} />
      </div>

      {/* ─── PAS 6: Misije človeštva + Šibke točke AI ─── */}
      <div className="band band-missions">
        <HumanMissionsPlaceholder />
        <Missions wps={game.aiWeakPoints} aiTree={game.aiTree}
          active={game.activeMissions ?? []} plan={missions} planR={missionR}
          onPlanChange={setMissionAssignment} onRationsChange={setMissionRations}
          odds={odds} availablePop={availablePop} />
      </div>
    </div>
  );
}
