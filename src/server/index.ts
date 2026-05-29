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

app.use(cors());
app.use(express.json());

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
  if (!action.assignment) return res.status(400).json({ error: 'Manjka assignment' });

  const newState = processRound(doc as ReturnType<typeof newGame>, action);
  await GameSession.updateOne({ runId: doc.runId }, newState);

  // Če je igra končana, shrani v CompletedRun
  if (newState.status !== 'active') {
    const axisHistory: Record<string, number> = { hiding: 0, espionage: 0, defense: 0 };
    // Štej osi iz logov bi zahteval zgodovino — za MVP preprosta ocena iz zadnje osi
    if (newState.lastRoundLog) {
      const axis = newState.lastRoundLog.assignment.axis;
      axisHistory[axis] = 1;
    }
    await CompletedRun.create({
      runId: newState.runId,
      status: newState.status,
      totalRounds: newState.totalRounds,
      finalPhase: newState.phase,
      finalPopulation: newState.population,
      axisHistory,
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
  if (!assignment) return res.status(400).json({ error: 'Manjka assignment' });

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

// Pregled povratnih informacij (za nas)
app.get('/api/feedback', async (_req, res) => {
  const list = await Feedback.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json(list);
});

// Seznam sej (zadnjih 20)
app.get('/api/sessions', async (_req, res) => {
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
