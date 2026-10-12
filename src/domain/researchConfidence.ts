/**
 * Research confidence — factors are always visible.
 */

export type LineConfidenceFactors = {
  specMatch: number;
  sourceQuality: number;
  sourceCount: number;
  priceConsistency: number;
  vatClarity: number;
  packClarity: number;
  availability: number;
  deliveryEvidence: number;
  freshness: number;
};

export type LineConfidenceResult = {
  score: number;
  factors: LineConfidenceFactors;
  notes: string[];
};

export function scoreLineResearchConfidence(
  factors: LineConfidenceFactors,
): LineConfidenceResult {
  const weights: Record<keyof LineConfidenceFactors, number> = {
    specMatch: 0.2,
    sourceQuality: 0.15,
    sourceCount: 0.12,
    priceConsistency: 0.12,
    vatClarity: 0.08,
    packClarity: 0.1,
    availability: 0.05,
    deliveryEvidence: 0.1,
    freshness: 0.08,
  };

  let score = 0;
  const notes: string[] = [];
  for (const [k, w] of Object.entries(weights) as Array<
    [keyof LineConfidenceFactors, number]
  >) {
    const v = clamp01(factors[k]);
    score += v * w;
    if (v < 0.5) notes.push(`Weak factor: ${k}=${v.toFixed(2)}`);
  }

  return { score: clamp01(score), factors, notes };
}

export function overallSourcingConfidence(lineScores: number[]): number {
  if (lineScores.length === 0) return 0;
  const min = Math.min(...lineScores);
  const avg = lineScores.reduce((a, b) => a + b, 0) / lineScores.length;
  // Overall dragged by weakest material line
  return clamp01(avg * 0.6 + min * 0.4);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
