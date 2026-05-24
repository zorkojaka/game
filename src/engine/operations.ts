import type { OperationDefinition, OperationId } from './types.js';

export const OPERATION_DEFINITIONS: OperationDefinition[] = [
  {
    id: 'hide_movement',
    title: 'Hide Population Movement',
    purpose: 'hiding',
    description: 'Move families through dark routes, false camps, and silent supply lines.',
    required: { people: 12, survival: 6 },
    risk: 'low',
    expectedEffect: 'Lowers exposure and slows scanner-driven objectives.',
    affectedObjective: 'scan_wilderness',
  },
  {
    id: 'sabotage_scanners',
    title: 'Sabotage AI Scanners',
    purpose: 'strike',
    description: 'Send a small cell to destroy sensor relays and corrupt local scan telemetry.',
    required: { people: 18, combat: 8 },
    risk: 'high',
    expectedEffect: 'Disrupts the active scan objective and destroys a few AI robots.',
    affectedObjective: 'scan_wilderness',
  },
  {
    id: 'spread_misinformation',
    title: 'Spread Misinformation',
    purpose: 'espionage',
    description: 'Seed false movement patterns, fake radio traffic, and decoy survivor trails.',
    required: { people: 10, intelligence: 12 },
    risk: 'medium',
    expectedEffect: 'Pushes behavior-analysis objectives backward and reduces AI certainty.',
    affectedObjective: 'analyze_patterns',
  },
  {
    id: 'fortify_shelters',
    title: 'Fortify Shelters',
    purpose: 'defense',
    description: 'Harden bunkers, disperse caches, and drill evacuation routes.',
    required: { people: 16, combat: 5 },
    risk: 'low',
    expectedEffect: 'Improves morale and reduces damage from completed AI threats.',
    affectedObjective: 'prepare_strike',
  },
  {
    id: 'intercept_comms',
    title: 'Intercept AI Communications',
    purpose: 'espionage',
    description: 'Listen for machine-tasking bursts and infer the next campaign step.',
    required: { people: 14, intelligence: 6 },
    risk: 'medium',
    expectedEffect: 'Reveals campaign objectives and enables future disruption.',
    affectedObjective: 'identify_leaders',
  },
  {
    id: 'raid_logistics',
    title: 'Raid AI Logistics',
    purpose: 'strike',
    description: 'Hit robot supply convoys before they reinforce the extermination chain.',
    required: { people: 22, combat: 14 },
    risk: 'high',
    expectedEffect: 'Destroys robots and slows base-location or strike preparation objectives.',
    affectedObjective: 'locate_bases',
  },
  {
    id: 'rescue_survivors',
    title: 'Rescue Survivors',
    purpose: 'survival',
    description: 'Divert scouts to nearby distress signals before AI harvest teams arrive.',
    required: { people: 14, survival: 8 },
    risk: 'medium',
    expectedEffect: 'May grow population and morale, but increases exposure.',
  },
  {
    id: 'gather_supplies',
    title: 'Gather Supplies',
    purpose: 'survival',
    description: 'Scavenge water, batteries, tools, and salvage from abandoned towns.',
    required: { people: 18 },
    risk: 'low',
    expectedEffect: 'Restores survival resources with modest exposure.',
  },
];

export function getOperationDefinition(id: OperationId): OperationDefinition | undefined {
  return OPERATION_DEFINITIONS.find(operation => operation.id === id);
}

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && OPERATION_DEFINITIONS.some(operation => operation.id === value);
}
