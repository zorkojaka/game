import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from '../db/connection.js';
import { GameSession } from '../db/models/GameSession.js';
import { CompletedRun } from '../db/models/CompletedRun.js';
import { newGame, processRound, previewOperations } from '../engine/game.js';
import { validateRoundAction } from './validation.js';

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

  const validated = validateRoundAction(req.body, doc);
  if (!validated.ok) return res.status(400).json({ error: validated.error });

  const newState = processRound(doc as ReturnType<typeof newGame>, validated.action);
  await GameSession.updateOne({ runId: doc.runId }, newState);

  // Če je igra končana, shrani v CompletedRun
  if (newState.status !== 'active') {
    const axisHistory: Record<string, number> = { hiding: 0, espionage: 0, defense: 0 };
    // Štej osi iz logov bi zahteval zgodovino — za MVP preprosta ocena iz zadnje osi
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

  const { operationIds } = req.body;
  if (!Array.isArray(operationIds)) return res.status(400).json({ error: 'Manjkajo operationIds' });

  const preview = previewOperations(doc as ReturnType<typeof newGame>, operationIds);
  res.json(preview);
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
