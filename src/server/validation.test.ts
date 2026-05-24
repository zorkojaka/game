import { describe, expect, test } from '@jest/globals';
import type { GameState } from '../engine/types.js';
import { validateRoundAction } from './validation.js';

const state = {
  population: 40,
  resources: { survival: 100, combat: 60, intelligence: 40 },
  aiWeakPoints: [
    { id: 'wp_power', label: 'Power', discovered: true, exploited: false, phase: 'find' },
  ],
} satisfies Pick<GameState, 'population' | 'resources' | 'aiWeakPoints'>;

describe('validateRoundAction', () => {
  test('accepts valid operation ids without changing values', () => {
    const result = validateRoundAction({
      operationIds: ['hide_movement', 'intercept_comms'],
      targetWeakPoint: 'wp_power',
    }, state);

    expect(result).toEqual({
      ok: true,
      action: {
        operationIds: ['hide_movement', 'intercept_comms'],
        targetWeakPoint: 'wp_power',
      },
    });
  });

  test('rejects missing or malformed operation payloads', () => {
    expect(validateRoundAction({}, state)).toEqual({ ok: false, error: 'operationIds must be an array' });
    expect(validateRoundAction({ operationIds: [] }, state)).toEqual({ ok: false, error: 'Choose 1-3 operations' });
    expect(validateRoundAction({ operationIds: ['hide_movement', 'intercept_comms', 'gather_supplies', 'raid_logistics'] }, state))
      .toEqual({ ok: false, error: 'Choose 1-3 operations' });
  });

  test('rejects unknown operation ids', () => {
    const result = validateRoundAction({ operationIds: ['attack'] }, state);
    expect(result).toEqual({ ok: false, error: 'Unknown operation' });
  });

  test('rejects plans above current population', () => {
    const result = validateRoundAction({
      operationIds: ['raid_logistics', 'sabotage_scanners', 'gather_supplies'],
    }, { ...state, population: 30 });

    expect(result).toEqual({ ok: false, error: 'Assigned population exceeds current population' });
  });

  test('rejects plans without enough resources', () => {
    const result = validateRoundAction({
      operationIds: ['raid_logistics'],
    }, { ...state, resources: { ...state.resources, combat: 4 } });

    expect(result).toEqual({ ok: false, error: 'Not enough combat' });
  });

  test('rejects unknown weak point targets', () => {
    const result = validateRoundAction({
      operationIds: ['hide_movement'],
      targetWeakPoint: 'missing',
    }, state);

    expect(result).toEqual({ ok: false, error: 'Weak point target not found' });
  });
});
