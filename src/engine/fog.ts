// Megla — sistem vidnosti AI vozlišč
// Vsako vozlišče ima visibility ∈ {unknown, partial, revealed}
// Megla se odgrinja proaktivno (intel) ali retroaktivno (AI akcija)

import type { AITreeNode, Visibility, GameState } from './types.js';
import { INTEL_TO_PARTIAL, INTEL_TO_REVEALED } from './constants.js';

// Koliko intela je potrebno za upgrade vidnosti vozlišča
export function intelRequiredForVisibility(target: Visibility): number {
  return target === 'partial' ? INTEL_TO_PARTIAL : INTEL_TO_REVEALED;
}

/**
 * Razkrij AI drevo glede na naše znanje o AI (insight ∈ [0,1]).
 * Vozlišča se odpirajo po vrsti: višji insight razkrije več. Nikoli ne degradira
 * že razkritih vozlišč (npr. retroaktivno razkritih ob izvedbi faze).
 */
export function revealTreeByInsight(nodes: AITreeNode[], insight: number): AITreeNode[] {
  if (nodes.length === 0) return nodes;
  return nodes.map(n => {
    if (n.visibility === 'revealed') return n;
    const threshold = n.insightThreshold ?? 0.5;
    let vis: Visibility = n.visibility;
    if (insight >= threshold) vis = 'revealed';
    else if (insight >= threshold - 0.08 && vis === 'unknown') vis = 'partial';
    return vis === n.visibility ? n : { ...n, visibility: vis };
  });
}

// Proaktivno odgrinjanje — porabimo intel, upgrade vozlišče
export function revealNodeProactive(
  node: AITreeNode,
  intelSpent: number
): { node: AITreeNode; intelUsed: number } {
  if (node.visibility === 'revealed') return { node, intelUsed: 0 };

  const targetVisibility: Visibility =
    node.visibility === 'unknown' ? 'partial' : 'revealed';
  const cost = intelRequiredForVisibility(targetVisibility);

  if (intelSpent >= cost) {
    return { node: { ...node, visibility: targetVisibility }, intelUsed: cost };
  }
  return { node, intelUsed: 0 };
}

// Retroaktivno odgrinjanje — AI izvede akcijo, vozlišče postane revealed
export function revealNodeRetroactive(node: AITreeNode): AITreeNode {
  return { ...node, visibility: 'revealed', executed: true };
}

// Koliko smo skupaj odkrili (za UI)
export function fogStats(nodes: AITreeNode[]): {
  unknown: number;
  partial: number;
  revealed: number;
  total: number;
} {
  return {
    unknown: nodes.filter(n => n.visibility === 'unknown').length,
    partial: nodes.filter(n => n.visibility === 'partial').length,
    revealed: nodes.filter(n => n.visibility === 'revealed').length,
    total: nodes.length,
  };
}

// Poizkusi porabiti intel za odkrivanje — vrne nov nodes array in porabljeni intel
export function spendIntelOnFog(
  nodes: AITreeNode[],
  intelBudget: number
): { nodes: AITreeNode[]; intelSpent: number; revealed: string[] } {
  let remaining = intelBudget;
  const newNodes = [...nodes];
  const revealed: string[] = [];

  // Prioriteta: unknown → partial → partial → revealed
  // Najprej partial (cenejše do revealed), potem unknown → partial
  const candidates = [
    ...newNodes.filter(n => n.visibility === 'partial'),
    ...newNodes.filter(n => n.visibility === 'unknown'),
  ];

  for (const candidate of candidates) {
    const idx = newNodes.findIndex(n => n.id === candidate.id);
    const { node: updated, intelUsed } = revealNodeProactive(newNodes[idx], remaining);
    if (intelUsed > 0) {
      newNodes[idx] = updated;
      remaining -= intelUsed;
      if (updated.visibility !== candidate.visibility) {
        revealed.push(candidate.id);
      }
    }
    if (remaining <= 0) break;
  }

  return { nodes: newNodes, intelSpent: intelBudget - remaining, revealed };
}
