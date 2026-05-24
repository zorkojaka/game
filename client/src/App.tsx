import { useEffect, useMemo, useState } from 'react';
import type {
  AICampaignObjective,
  GameState,
  OperationDefinition,
  OperationId,
  OperationPreview,
  OperationPurpose,
  Resources,
  RoundLog,
} from './types';
import { createGame, getGame, playRound, previewOperations } from './api';

const STORAGE_KEY = 'avh-runId';
const MAX_OPERATIONS = 3;

const PHASE_LABEL: Record<GameState['phase'], string> = {
  find: 'Search Campaign',
  understand: 'Understanding Campaign',
  eliminate: 'Extermination Campaign',
};

const PURPOSE_LABEL: Record<OperationPurpose, string> = {
  hiding: 'Hiding',
  espionage: 'Espionage',
  defense: 'Defense',
  survival: 'Survival',
  strike: 'Strike',
};

const OPERATIONS: OperationDefinition[] = [
  {
    id: 'hide_movement',
    title: 'Hide Population Movement',
    purpose: 'hiding',
    description: 'Move families through dark routes, false camps, and silent supply lines.',
    required: { people: 12, survival: 6 },
    risk: 'low',
    expectedEffect: 'Lowers exposure and slows scanner-driven objectives.',
    affectedObjective: 'scan_wilderness',
  },
  {
    id: 'sabotage_scanners',
    title: 'Sabotage AI Scanners',
    purpose: 'strike',
    description: 'Destroy sensor relays and corrupt local scan telemetry.',
    required: { people: 18, combat: 8 },
    risk: 'high',
    expectedEffect: 'Disrupts scan progress and destroys AI robots.',
    affectedObjective: 'scan_wilderness',
  },
  {
    id: 'spread_misinformation',
    title: 'Spread Misinformation',
    purpose: 'espionage',
    description: 'Seed fake movement patterns, radio traffic, and survivor trails.',
    required: { people: 10, intelligence: 12 },
    risk: 'medium',
    expectedEffect: 'Pushes analysis and prediction objectives backward.',
    affectedObjective: 'analyze_patterns',
  },
  {
    id: 'fortify_shelters',
    title: 'Fortify Shelters',
    purpose: 'defense',
    description: 'Harden bunkers, disperse caches, and drill evacuation routes.',
    required: { people: 16, combat: 5 },
    risk: 'low',
    expectedEffect: 'Improves morale and reduces damage from completed threats.',
    affectedObjective: 'prepare_strike',
  },
  {
    id: 'intercept_comms',
    title: 'Intercept AI Communications',
    purpose: 'espionage',
    description: 'Listen for tasking bursts and infer the next campaign step.',
    required: { people: 14, intelligence: 6 },
    risk: 'medium',
    expectedEffect: 'Reveals objectives and enables future disruption.',
    affectedObjective: 'identify_leaders',
  },
  {
    id: 'raid_logistics',
    title: 'Raid AI Logistics',
    purpose: 'strike',
    description: 'Hit robot supply convoys before they reinforce the campaign chain.',
    required: { people: 22, combat: 14 },
    risk: 'high',
    expectedEffect: 'Destroys robots and slows later attack preparation.',
    affectedObjective: 'locate_bases',
  },
  {
    id: 'rescue_survivors',
    title: 'Rescue Survivors',
    purpose: 'survival',
    description: 'Divert scouts to nearby distress signals before AI harvest teams arrive.',
    required: { people: 14, survival: 8 },
    risk: 'medium',
    expectedEffect: 'May grow population and morale, but increases exposure.',
  },
  {
    id: 'gather_supplies',
    title: 'Gather Supplies',
    purpose: 'survival',
    description: 'Scavenge water, batteries, tools, and salvage from abandoned towns.',
    required: { people: 18 },
    risk: 'low',
    expectedEffect: 'Restores survival resources with modest exposure.',
  },
];

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function clampPct(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function costText(resources: Partial<Resources>) {
  const parts = [];
  if (resources.survival) parts.push(`${resources.survival} survival`);
  if (resources.combat) parts.push(`${resources.combat} combat`);
  if (resources.intelligence) parts.push(`${resources.intelligence} intel`);
  return parts.length > 0 ? parts.join(' / ') : 'no resource cost';
}

function selectedCost(selected: OperationId[]) {
  return selected.reduce(
    (sum, id) => {
      const op = OPERATIONS.find(operation => operation.id === id);
      if (!op) return sum;
      return {
        people: sum.people + op.required.people,
        survival: sum.survival + (op.required.survival ?? 0),
        combat: sum.combat + (op.required.combat ?? 0),
        intelligence: sum.intelligence + (op.required.intelligence ?? 0),
      };
    },
    { people: 0, survival: 0, combat: 0, intelligence: 0 }
  );
}

function canAfford(game: GameState, operation: OperationDefinition, selected: OperationId[]) {
  if (selected.includes(operation.id)) return true;
  if (selected.length >= MAX_OPERATIONS) return false;
  const total = selectedCost([...selected, operation.id]);
  return total.people <= game.population
    && total.survival <= game.resources.survival
    && total.combat <= game.resources.combat
    && total.intelligence <= game.resources.intelligence;
}

function StatusTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function TopStatus({ game }: { game: GameState }) {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">AI vs Humanity</div>
        <h1>{PHASE_LABEL[game.phase]}</h1>
      </div>
      <div className="status-grid">
        <StatusTile label="Month" value={game.round} />
        <StatusTile label="Population" value={game.population} />
        <StatusTile label="Survival" value={game.resources.survival} />
        <StatusTile label="Combat" value={game.resources.combat} />
        <StatusTile label="Intel" value={game.resources.intelligence} />
        <StatusTile label="Morale" value={game.morale} />
        <StatusTile label="AI Knowledge" value={pct(game.aiKnowledge)} tone={game.aiKnowledge > 0.7 ? 'danger' : ''} />
      </div>
    </header>
  );
}

function ClanStatus({ game, selected }: { game: GameState; selected: OperationId[] }) {
  const cost = selectedCost(selected);
  const available = game.population - cost.people;
  return (
    <aside className="panel clan-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Player Clan</div>
          <h2>Last Ember Cell</h2>
        </div>
        <span className={available < 8 ? 'danger pill' : 'pill'}>{available} free</span>
      </div>
      <div className="metric">
        <span>Hiddenness</span>
        <strong>{pct(1 - game.exposure)}</strong>
        <div className="bar"><i style={{ width: pct(1 - game.exposure) }} /></div>
      </div>
      <div className="metric">
        <span>Exposure</span>
        <strong>{pct(game.exposure)}</strong>
        <div className="bar hot"><i style={{ width: pct(game.exposure) }} /></div>
      </div>
      <div className="metric">
        <span>Morale</span>
        <strong>{game.morale}/100</strong>
        <div className="bar morale"><i style={{ width: clampPct(game.morale) }} /></div>
      </div>
      <div className="reserve-list">
        <div><span>Reserved people</span><b>{cost.people}</b></div>
        <div><span>Resource plan</span><b>{costText(cost)}</b></div>
        <div><span>AI robots</span><b>{game.aiRobots}</b></div>
      </div>
    </aside>
  );
}

function ObjectiveCard({ objective }: { objective: AICampaignObjective }) {
  const hidden = objective.visibility === 'unknown';
  return (
    <article className={`objective ${objective.status} ${hidden ? 'fogged' : ''}`}>
      <div className="objective-top">
        <span className="chapter">{objective.phase}</span>
        <span className="objective-status">{hidden ? 'unknown' : objective.status}</span>
      </div>
      <h3>{hidden ? 'Unknown AI package' : objective.title}</h3>
      <p>{hidden ? 'Intercept communications or disrupt active systems to reveal this objective.' : objective.description}</p>
      {!hidden && (
        <>
          <div className="objective-progress">
            <div style={{ width: clampPct(objective.progress) }} />
          </div>
          <div className="objective-foot">
            <span>{Math.round(objective.progress)}%</span>
            <span>{objective.threatEffect}</span>
          </div>
        </>
      )}
    </article>
  );
}

function CampaignPlan({ game }: { game: GameState }) {
  return (
    <main className="panel campaign-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">AI Campaign Plan</div>
          <h2>Objective Chain</h2>
        </div>
        <span className="pill">{game.campaignObjectives.filter(o => o.status === 'completed').length}/{game.campaignObjectives.length} completed</span>
      </div>
      <div className="objective-chain">
        {game.campaignObjectives.map(objective => (
          <ObjectiveCard key={objective.id} objective={objective} />
        ))}
      </div>
    </main>
  );
}

function ThreatPanel({ game }: { game: GameState }) {
  const log = game.lastRoundLog;
  return (
    <aside className="panel threat-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Threat Analysis</div>
          <h2>Latest Events</h2>
        </div>
      </div>
      {!log && <p className="muted">No campaign contact yet. Select operations and execute the first month.</p>}
      {log && (
        <div className="event-stack">
          <p className="summary">{log.narrative}</p>
          {log.objectiveProgress.map(change => (
            <div key={change.objectiveId} className="event-line">
              <span>{change.title}</span>
              <b className={change.delta >= 0 ? 'danger' : 'good'}>{change.delta >= 0 ? '+' : ''}{change.delta}%</b>
            </div>
          ))}
          {log.operationOutcomes.map(outcome => (
            <div key={`${log.round}-${outcome.operationId}`} className="event-card">
              <b>{outcome.title}</b>
              <span className={outcome.success ? 'good' : 'danger'}>{outcome.success ? 'Primary effect' : 'Compromised'}</span>
              <p>{outcome.summary}</p>
            </div>
          ))}
          {log.nextThreat && <div className="next-threat">{log.nextThreat}</div>}
        </div>
      )}
    </aside>
  );
}

function OperationCard({
  operation,
  game,
  selected,
  previews,
  onToggle,
}: {
  operation: OperationDefinition;
  game: GameState;
  selected: OperationId[];
  previews: OperationPreview[];
  onToggle: (id: OperationId) => void;
}) {
  const active = selected.includes(operation.id);
  const affordable = canAfford(game, operation, selected);
  const preview = previews.find(item => item.operationId === operation.id);
  const objective = operation.affectedObjective
    ? game.campaignObjectives.find(item => item.id === operation.affectedObjective)
    : undefined;

  return (
    <button
      type="button"
      className={`operation-card ${active ? 'selected' : ''}`}
      disabled={!active && !affordable}
      onClick={() => onToggle(operation.id)}
    >
      <div className="operation-top">
        <span className={`purpose ${operation.purpose}`}>{PURPOSE_LABEL[operation.purpose]}</span>
        <span className={`risk ${operation.risk}`}>{operation.risk} risk</span>
      </div>
      <h3>{operation.title}</h3>
      <p>{operation.description}</p>
      <div className="operation-meta">
        <span>{operation.required.people} people</span>
        <span>{costText(operation.required)}</span>
      </div>
      <div className="effect">{preview?.expectedEffect ?? operation.expectedEffect}</div>
      {objective && <div className="target">Target: {objective.visibility === 'unknown' ? 'unknown objective' : objective.title}</div>}
      {!active && !affordable && <div className="blocked">Insufficient capacity or resources</div>}
    </button>
  );
}

function OperationPlanner({
  game,
  selected,
  previews,
  loading,
  error,
  onToggle,
  onExecute,
  onNew,
}: {
  game: GameState;
  selected: OperationId[];
  previews: OperationPreview[];
  loading: boolean;
  error: string;
  onToggle: (id: OperationId) => void;
  onExecute: () => void;
  onNew: () => void;
}) {
  const cost = selectedCost(selected);
  const remaining = game.population - cost.people;
  const canExecute = selected.length > 0 && remaining >= 0 && !loading;

  return (
    <section className="panel planner">
      <div className="panel-head planner-head">
        <div>
          <div className="eyebrow">Operation Planning</div>
          <h2>Select 1-3 operations</h2>
        </div>
        <div className="planner-status">
          <span>{selected.length}/{MAX_OPERATIONS} selected</span>
          <b className={remaining < 0 ? 'danger' : ''}>{remaining} people remaining</b>
        </div>
      </div>
      <div className="operation-grid">
        {OPERATIONS.map(operation => (
          <OperationCard
            key={operation.id}
            operation={operation}
            game={game}
            selected={selected}
            previews={previews}
            onToggle={onToggle}
          />
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="planner-actions">
        <button className="execute-btn" disabled={!canExecute} onClick={onExecute}>
          {loading ? 'Executing...' : 'Execute Campaign Month'}
        </button>
        <button className="secondary-btn" disabled={loading} onClick={onNew}>New Campaign</button>
      </div>
    </section>
  );
}

function ResultPanel({ log }: { log: RoundLog | null }) {
  if (!log) return null;
  return (
    <section className="panel result-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Round Result</div>
          <h2>Month {log.round} Debrief</h2>
        </div>
      </div>
      <p className="summary">{log.narrative}</p>
      <div className="result-grid">
        <div><span>Population</span><b>{log.populationDelta >= 0 ? '+' : ''}{log.populationDelta}</b></div>
        <div><span>Survival</span><b>{log.resourceDelta.survival ?? 0}</b></div>
        <div><span>Combat</span><b>{log.resourceDelta.combat ?? 0}</b></div>
        <div><span>Intel</span><b>{log.resourceDelta.intelligence ?? 0}</b></div>
        <div><span>Morale</span><b>{log.moraleDelta >= 0 ? '+' : ''}{Math.round(log.moraleDelta)}</b></div>
        <div><span>Exposure</span><b>{log.exposureDelta >= 0 ? '+' : ''}{Math.round(log.exposureDelta * 100)}%</b></div>
      </div>
    </section>
  );
}

function StartScreen({ onNew, loading }: { onNew: () => void; loading: boolean }) {
  return (
    <div className="start">
      <div className="start-inner">
        <div className="eyebrow">AI Campaign War Room</div>
        <h1>AI vs Humanity</h1>
        <p>The machine is not waiting for a phase timer. It is completing objectives. Pick operations, reveal its plan, and keep the clan alive.</p>
        <button className="execute-btn" onClick={onNew} disabled={loading}>
          {loading ? 'Creating...' : 'Begin Campaign'}
        </button>
      </div>
    </div>
  );
}

function GameOver({ game, onNew, loading }: { game: GameState; onNew: () => void; loading: boolean }) {
  const won = game.status === 'victory';
  return (
    <div className="start">
      <div className="start-inner game-over">
        <div className={won ? 'good eyebrow' : 'danger eyebrow'}>{won ? 'Victory' : 'Campaign Failed'}</div>
        <h1>{won ? 'Humanity Survives' : 'The Clan Falls'}</h1>
        <p>{won ? 'The AI campaign chain was broken.' : 'AI pressure overwhelmed the remaining human network.'}</p>
        <button className="execute-btn" onClick={onNew} disabled={loading}>Start New Campaign</button>
      </div>
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [selected, setSelected] = useState<OperationId[]>([]);
  const [previews, setPreviews] = useState<OperationPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) {
      getGame(id)
        .then(state => {
          if (!state.campaignObjectives) {
            localStorage.removeItem(STORAGE_KEY);
            return;
          }
          setGame(state);
        })
        .catch(() => localStorage.removeItem(STORAGE_KEY));
    }
  }, []);

  useEffect(() => {
    if (!game || selected.length === 0) {
      setPreviews([]);
      return;
    }
    const timer = setTimeout(() => {
      previewOperations(game.runId, selected).then(setPreviews).catch(() => setPreviews([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [game?.runId, selected]);

  const activeObjective = useMemo(
    () => game?.campaignObjectives.find(objective => objective.status === 'active' || objective.status === 'disrupted'),
    [game]
  );

  const handleNew = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await createGame();
      setGame(next);
      setSelected([]);
      localStorage.setItem(STORAGE_KEY, next.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create campaign');
    } finally {
      setLoading(false);
    }
  };

  const toggleOperation = (id: OperationId) => {
    if (!game) return;
    setError('');
    setSelected(current => {
      if (current.includes(id)) return current.filter(item => item !== id);
      const next = [...current, id];
      const operation = OPERATIONS.find(item => item.id === id);
      if (!operation || !canAfford(game, operation, current) || next.length > MAX_OPERATIONS) return current;
      return next;
    });
  };

  const execute = async () => {
    if (!game || selected.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await playRound(game.runId, { operationIds: selected });
      setGame(result.state);
      setSelected([]);
      setPreviews([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Round failed');
    } finally {
      setLoading(false);
    }
  };

  if (!game) return <StartScreen onNew={handleNew} loading={loading} />;
  if (game.status !== 'active') return <GameOver game={game} onNew={handleNew} loading={loading} />;

  return (
    <div className="war-room">
      <TopStatus game={game} />
      {activeObjective && (
        <div className="active-banner">
          <span>Active AI objective</span>
          <b>{activeObjective.title}</b>
          <i>{Math.round(activeObjective.progress)}% complete</i>
        </div>
      )}
      <div className="dashboard">
        <ClanStatus game={game} selected={selected} />
        <CampaignPlan game={game} />
        <ThreatPanel game={game} />
      </div>
      <OperationPlanner
        game={game}
        selected={selected}
        previews={previews}
        loading={loading}
        error={error}
        onToggle={toggleOperation}
        onExecute={execute}
        onNew={handleNew}
      />
      <ResultPanel log={game.lastRoundLog} />
    </div>
  );
}
