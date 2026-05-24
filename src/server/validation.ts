import type { GameState, OperationId, PlayerAction, Resources } from '../engine/types.js';
import { isOperationId, getOperationDefinition } from '../engine/operations.js';
import { MAX_OPERATIONS_PER_ROUND } from '../engine/constants.js';

type ValidationResult =
  | { ok: true; action: PlayerAction }
  | { ok: false; error: string };

type ValidationState = Pick<GameState, 'population' | 'resources' | 'aiWeakPoints'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateRoundAction(payload: unknown, state: ValidationState): ValidationResult {
  if (!isRecord(payload)) {
    return { ok: false, error: 'Invalid request body' };
  }

  if (!Array.isArray(payload.operationIds)) {
    return { ok: false, error: 'operationIds must be an array' };
  }

  if (payload.operationIds.length < 1 || payload.operationIds.length > MAX_OPERATIONS_PER_ROUND) {
    return { ok: false, error: `Choose 1-${MAX_OPERATIONS_PER_ROUND} operations` };
  }

  const operationIds: OperationId[] = [];
  for (const value of payload.operationIds) {
    if (!isOperationId(value)) {
      return { ok: false, error: 'Unknown operation' };
    }
    if (!operationIds.includes(value)) operationIds.push(value);
  }

  const required = operationIds.reduce(
    (sum, id) => {
      const operation = getOperationDefinition(id);
      if (!operation) return sum;
      return {
        people: sum.people + operation.required.people,
        survival: sum.survival + (operation.required.survival ?? 0),
        combat: sum.combat + (operation.required.combat ?? 0),
        intelligence: sum.intelligence + (operation.required.intelligence ?? 0),
      };
    },
    { people: 0, survival: 0, combat: 0, intelligence: 0 }
  );

  if (required.people > state.population) {
    return { ok: false, error: 'Assigned population exceeds current population' };
  }

  const missingResource = firstMissingResource(required, state.resources);
  if (missingResource) {
    return { ok: false, error: `Not enough ${missingResource}` };
  }

  const targetWeakPoint = payload.targetWeakPoint;
  if (targetWeakPoint !== undefined) {
    if (typeof targetWeakPoint !== 'string' || targetWeakPoint.length === 0) {
      return { ok: false, error: 'Invalid weak point target' };
    }
    if (!state.aiWeakPoints.some(wp => wp.id === targetWeakPoint)) {
      return { ok: false, error: 'Weak point target not found' };
    }
  }

  return {
    ok: true,
    action: targetWeakPoint === undefined ? { operationIds } : { operationIds, targetWeakPoint },
  };
}

function firstMissingResource(
  required: Required<Resources>,
  available: Resources
): keyof Resources | null {
  if (required.survival > available.survival) return 'survival';
  if (required.combat > available.combat) return 'combat';
  if (required.intelligence > available.intelligence) return 'intelligence';
  return null;
}
