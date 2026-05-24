// Aktivna seja (v teku ali končana)
// Hrani celoten GameState — en dokument na linijo igre

import { Schema, model } from 'mongoose';
import type { GameState } from '../../engine/types.js';

const resourcesSchema = new Schema({
  survival: Number,
  combat: Number,
  intelligence: Number,
}, { _id: false });

const aiTreeNodeSchema = new Schema({
  id: String,
  phase: String,
  label: String,
  visibility: String,
  strength: Number,
  executed: Boolean,
}, { _id: false });

const aiWeakPointSchema = new Schema({
  id: String,
  label: String,
  discovered: Boolean,
  exploited: Boolean,
  phase: String,
}, { _id: false });

const gameSessionSchema = new Schema({
  runId: { type: String, required: true, unique: true, index: true },
  status: { type: String, required: true },
  phase: String,
  round: Number,
  totalRounds: Number,
  population: Number,
  maxPopulation: Number,
  resources: resourcesSchema,
  aiPhaseProgress: Number,
  aiRobots: Number,
  aiKnowledge: Number,
  aiTree: [aiTreeNodeSchema],
  aiWeakPoints: [aiWeakPointSchema],
  clanActivity: Number,
  rngSeed: Number,
  rngCallCount: Number,
  lastRoundLog: Schema.Types.Mixed,
}, {
  timestamps: true,
  // Shrani celoten GameState kot je — brez izgube podatkov
  strict: false,
});

export const GameSession = model<GameState & { createdAt: Date; updatedAt: Date }>(
  'GameSession',
  gameSessionSchema
);
