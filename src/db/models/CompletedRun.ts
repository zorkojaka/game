// Zaključene linije — za statistiko in kasnejšo AI evolucijo
// Faza 3: iz tega agregata se AI uči

import { Schema, model } from 'mongoose';

const completedRunSchema = new Schema({
  runId: { type: String, required: true, unique: true },
  status: String,              // victory / defeat_extinction / defeat_overwhelmed
  totalRounds: Number,
  finalPhase: String,
  finalPopulation: Number,
  // Povzetek osi skozi igro (za AI genome adaptacijo)
  axisHistory: {
    hiding: Number,
    espionage: Number,
    defense: Number,
  },
  // Ali je player odkril šibke točke
  weakPointsExploited: [String],
  // Seed za ponovitev iste linije
  rngSeed: Number,
}, {
  timestamps: true,
});

// Indeks za kasnejšo agregacijo (AI evolucija)
completedRunSchema.index({ status: 1, createdAt: -1 });

export const CompletedRun = model('CompletedRun', completedRunSchema);
