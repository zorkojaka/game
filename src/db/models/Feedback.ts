// Povratne informacije igralcev — shranjene v bazo za naš pregled

import { Schema, model } from 'mongoose';

const feedbackSchema = new Schema({
  message: { type: String, required: true },
  runId: String,            // če je bila igra v teku (kontekst)
  round: Number,            // mesec ob oddaji
  status: String,           // stanje igre ob oddaji
  userAgent: String,        // brskalnik (informativno)
}, {
  timestamps: true,
});

feedbackSchema.index({ createdAt: -1 });

export const Feedback = model('Feedback', feedbackSchema);
