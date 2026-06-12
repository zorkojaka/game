import type { GameState, Assignment, OddsPreview } from './types';

const BASE = '/api';

export async function createGame(seed?: number, difficulty?: 'easy' | 'normal' | 'hard' | 'brutal'): Promise<GameState> {
  const res = await fetch(`${BASE}/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(seed !== undefined ? { seed } : {}), ...(difficulty ? { difficulty } : {}) }),
  });
  const data = await res.json();
  return data.state;
}

export async function getGame(runId: string): Promise<GameState> {
  const res = await fetch(`${BASE}/game/${runId}`);
  if (!res.ok) throw new Error('Igra ni najdena');
  return res.json();
}

export async function playRound(
  runId: string,
  action: { assignment: Assignment; targetWeakPoint?: string }
): Promise<{ state: GameState }> {
  const res = await fetch(`${BASE}/game/${runId}/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  return res.json();
}

export async function sendFeedback(
  payload: { message: string; runId?: string; round?: number; status?: string }
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Napaka pri pošiljanju');
  return res.json();
}

export async function previewOdds(
  runId: string,
  assignment: Assignment
): Promise<OddsPreview> {
  const res = await fetch(`${BASE}/game/${runId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignment }),
  });
  return res.json();
}
