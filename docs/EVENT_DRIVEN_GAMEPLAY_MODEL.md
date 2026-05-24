# Event-Driven Gameplay Model

This branch changes the prototype from a phase-timer slider allocator into a server-authoritative AI campaign game.

## AI objective system

The AI campaign is represented by `campaignObjectives` on `GameState`.

Each objective has:

- `id`
- `title`
- `description`
- `phase`
- `progress` from `0` to `100`
- `status`: `locked`, `active`, `disrupted`, or `completed`
- `visibility`: `unknown`, `partial`, or `revealed`
- `threatEffect`
- `counterOperations`

The initial objective chain is created in `src/engine/ai-brain.ts`:

1. Scan Wilderness
2. Analyze Behavior Patterns
3. Identify Human Leaders
4. Build Prediction Model
5. Locate Main Bases
6. Prepare Extermination Strike

Only one objective is active by default. When it completes, the next locked objective becomes active. Phases remain as narrative chapters, but they no longer advance because a fixed 12-round timer expired.

## Player operation system

The player no longer assigns raw worker sliders. The round action is now a list of selected `operationIds`.

Operations are defined in `src/engine/operations.ts` and mirrored in the client for display. Current operations:

- Hide Population Movement
- Sabotage AI Scanners
- Spread Misinformation
- Fortify Shelters
- Intercept AI Communications
- Raid AI Logistics
- Rescue Survivors
- Gather Supplies

Each operation defines required people, optional resource costs, risk, expected effect, purpose, and optionally an affected AI objective.

The server validates selected operations before running the engine:

- payload shape
- known operation ids
- 1 to 3 operations per round
- people budget
- resource budget
- weak point target existence

## How AI progresses

Each round, the active AI objective gains progress from:

- a base progress amount
- clan exposure
- completed AI prediction work
- a penalty when the clan remains very hidden

This means the AI progresses because the active campaign objective is being executed, not because a phase counter hit 12.

## How the player slows or disrupts AI

Operations apply objective progress deltas and state tradeoffs.

Examples:

- Hide Population Movement lowers exposure and reduces scanner progress, but can reduce intel momentum.
- Sabotage AI Scanners directly damages scan progress and robots, but has high risk and can increase exposure.
- Spread Misinformation pushes analysis or prediction backward and lowers AI knowledge.
- Intercept AI Communications reveals hidden objectives and can reduce the revealed objective's progress.
- Fortify Shelters reduces damage from completed threats and improves morale.
- Raid AI Logistics damages robots and later attack objectives, but risks casualties.

If an operation pushes an objective backward enough, that objective is marked `disrupted` for the result cycle. It can resume as active in a later round.

## Round result generation

`processRound()` now resolves a month in this order:

1. Charge population survival upkeep.
2. Spend selected operation costs.
3. Resolve each operation outcome.
4. Apply operation objective disruptions.
5. Advance the active AI objective.
6. Complete objectives that reached `100`.
7. Apply threat effects from completed objectives.
8. Apply starvation, AI knowledge, exposure, and clan activity changes.
9. Generate a `RoundLog` containing:
   - operation outcomes
   - resource deltas
   - population, morale, exposure, and AI knowledge deltas
   - objective progress changes
   - newly revealed objectives
   - next visible threat
   - narrative summary

## UI model

The React app now presents a campaign war room:

- top status bar for population, resources, morale, AI knowledge, and month
- left clan status panel with hiddenness, exposure, morale, and available people
- center AI campaign objective chain with active, completed, disrupted, locked, and fogged states
- right threat analysis and latest event feed
- bottom operation planner with selectable operation cards and remaining capacity
- round result debrief after each month

## Known limitations and next steps

- Operation definitions are mirrored in client and server instead of generated from one shared source.
- The prototype still stores completed-run `axisHistory` for old analytics compatibility, but operation history should replace it.
- Risk uses deterministic seeded RNG, but outcomes are still simple one-roll checks.
- Objective chains are fixed. Future work can branch objectives or adapt them based on player patterns.
- Weak points still exist from the previous model and are not deeply integrated with the new operation loop.
- Old persisted sessions may not have `campaignObjectives`; the client discards those stale local run ids.
