import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from '../db/connection.js';
import { GameSession } from '../db/models/GameSession.js';
import { CompletedRun } from '../db/models/CompletedRun.js';
import { Feedback } from '../db/models/Feedback.js';
import { newGame, processRound, previewOdds } from '../engine/game.js';
import type { PlayerAction } from '../engine/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.use(cors());
app.use(express.json());

// ─── Pomožne: admin zaščita + validacija vhoda ─────────────────────────────────

/** Vrne true, če je zahteva avtorizirana kot admin; sicer odgovori 403 in vrne false. */
function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!ADMIN_TOKEN) {
    res.status(403).json({ error: 'Admin dostop ni konfiguriran (manjka ADMIN_TOKEN).' });
    return false;
  }
  if (req.get('x-admin-token') !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'Neavtoriziran dostop.' });
    return false;
  }
  return true;
}

const VALID_AXES = new Set(['hiding', 'espionage', 'defense']);
const INT_FIELDS = ['combatants', 'defenders', 'foragers', 'workers', 'researchers', 'scouts', 'dayGuard', 'nightGuard'] as const;

/** Površinska validacija assignmenta. Vrne sporočilo napake ali null, če je veljaven. */
function validateAssignment(a: unknown): string | null {
  if (!a || typeof a !== 'object') return 'Manjka assignment';
  const obj = a as Record<string, unknown>;
  if (!VALID_AXES.has(obj.axis as string)) return 'Neveljavna os';
  for (const f of INT_FIELDS) {
    const v = obj[f];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) return `Neveljavno polje: ${f}`;
  }
  if (obj.rations !== undefined) {
    const r = obj.rations;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) return 'Neveljavni obroki (1–5)';
  }
  if (obj.newExpeditions !== undefined) {
    if (!Array.isArray(obj.newExpeditions)) return 'newExpeditions mora biti seznam';
    for (const e of obj.newExpeditions as Array<Record<string, unknown>>) {
      if (!e || typeof e !== 'object') return 'Neveljavna odprava';
      if (typeof e.assigned !== 'number' || !Number.isInteger(e.assigned) || e.assigned < 0) return 'Neveljavno število v odpravi';
      if (!Array.isArray(e.path)) return 'Odprava brez poti';
      for (const step of e.path as Array<Record<string, unknown>>) {
        if (!step || typeof step.q !== 'number' || typeof step.r !== 'number') return 'Neveljaven korak v poti';
      }
    }
  }
  return null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

// Nova igra
app.post('/api/game/new', async (req, res) => {
  const seed = req.body.seed as number | undefined;
  const state = newGame(seed);
  await GameSession.create(state);
  res.json({ runId: state.runId, state });
});

// Pridobi stanje
app.get('/api/game/:runId', async (req, res) => {
  const doc = await GameSession.findOne({ runId: req.params.runId }).lean();
  if (!doc) return res.status(404).json({ error: 'Igra ni najdena' });
  res.json(doc);
});

// Izvedi potezo
app.post('/api/game/:runId/round', async (req, res) => {
  const doc = await GameSession.findOne({ runId: req.params.runId }).lean();
  if (!doc) return res.status(404).json({ error: 'Igra ni najdena' });
  if (doc.status !== 'active') return res.status(400).json({ error: 'Igra je končana' });

  const action = req.body as PlayerAction;
  const invalid = validateAssignment(action?.assignment);
  if (invalid) return res.status(400).json({ error: invalid });

  const newState = processRound(doc as ReturnType<typeof newGame>, action);
  await GameSession.updateOne({ runId: doc.runId }, { $set: newState });

  // Če je igra končana, shrani v CompletedRun z dejansko zgodovino osi
  if (newState.status !== 'active') {
    await CompletedRun.create({
      runId: newState.runId,
      status: newState.status,
      totalRounds: newState.totalRounds,
      finalPhase: newState.phase,
      finalPopulation: newState.population,
      axisHistory: newState.axisHistory,
      weakPointsExploited: newState.aiWeakPoints.filter(wp => wp.exploited).map(wp => wp.id),
      rngSeed: newState.rngSeed,
    });
  }

  res.json({ state: newState, log: newState.lastRoundLog });
});

// Ogled obeta pred potezo
app.post('/api/game/:runId/preview', async (req, res) => {
  const doc = await GameSession.findOne({ runId: req.params.runId }).lean();
  if (!doc) return res.status(404).json({ error: 'Igra ni najdena' });

  const { assignment } = req.body;
  const invalid = validateAssignment(assignment);
  if (invalid) return res.status(400).json({ error: invalid });

  const odds = previewOdds(doc as ReturnType<typeof newGame>, assignment);
  res.json(odds);
});

// Povratne informacije igralca
app.post('/api/feedback', async (req, res) => {
  const message = (req.body.message as string | undefined)?.trim();
  if (!message) return res.status(400).json({ error: 'Manjka sporočilo' });
  if (message.length > 5000) return res.status(400).json({ error: 'Sporočilo predolgo' });
  await Feedback.create({
    message,
    runId: req.body.runId,
    round: req.body.round,
    status: req.body.status,
    userAgent: req.get('user-agent'),
  });
  res.json({ ok: true });
});

// Pregled povratnih informacij (admin)
app.get('/api/feedback', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const list = await Feedback.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json(list);
});

// Seznam sej (zadnjih 20, admin)
app.get('/api/sessions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const list = await GameSession.find()
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('runId status phase round population updatedAt')
    .lean();
  res.json(list);
});

// ─── Static files (Vite build) ────────────────────────────────────────────────
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AI vs Humanity server na http://localhost:${PORT}`);
  });
});
