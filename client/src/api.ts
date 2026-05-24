import type { GameState, OperationId, OperationPreview } from './types';

const BASE = '/api';

export async function createGame(seed?: number): Promise<GameState> {
  const res = await fetch(`${BASE}/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(seed !== undefined ? { seed } : {}),
  });
  const data = await res.json();
  return data.state;
}

export async function getGame(runId: string): Promise<GameState> {
  const res = await fetch(`${BASE}/game/${runId}`);
  if (!res.ok) throw new Error('Game not found');
  return res.json();
}

export async function playRound(
  runId: string,
  action: { operationIds: OperationId[]; targetWeakPoint?: string }
): Promise<{ state: GameState }> {
  const res = await fetch(`${BASE}/game/${runId}/round`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Round failed');
  return data;
}

export async function previewOperations(
  runId: string,
  operationIds: OperationId[]
): Promise<OperationPreview[]> {
  const res = await fetch(`${BASE}/game/${runId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Preview failed');
  return data;
}
