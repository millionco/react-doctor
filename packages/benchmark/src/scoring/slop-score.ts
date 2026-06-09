import { SCORE_MAX, SCORE_MIN } from "../constants.js";
import type {
  ScanFinding,
  ScoringProfile,
  SlopDimension,
  SlopDimensionScore,
  SlopViolation,
} from "../types/index.js";
import { clamp } from "../utils/clamp.js";
import { computeViolationWeight } from "./compute-violation-weight.js";

export interface SlopScoreResult {
  violations: SlopViolation[];
  dimensions: SlopDimensionScore[];
  slopScore: number;
  normalizerLines: number;
}

// Divisor that makes penalties "per reference unit of code" so a large
// legitimate feature is not punished as hard as the same violations in a tiny
// diff. Floored by `minNormalizerLines` so a one-line change can't divide by a
// near-zero size and crater the score on a single finding.
const computeNormalizer = (addedLineCount: number, profile: ScoringProfile): number => {
  const effectiveLines = Math.max(addedLineCount, profile.minNormalizerLines);
  return effectiveLines / profile.diffSizeNormalizerLines;
};

const dimensionScoreFrom = (
  dimension: SlopDimension,
  dimensionViolations: SlopViolation[],
  normalizer: number,
): SlopDimensionScore => {
  const rawPenalty = dimensionViolations.reduce((total, violation) => total + violation.weight, 0);
  const normalizedPenalty = rawPenalty / normalizer;
  return {
    dimension,
    score: clamp(SCORE_MAX - normalizedPenalty, SCORE_MIN, SCORE_MAX),
    violationCount: dimensionViolations.length,
    weightedPenalty: normalizedPenalty,
  };
};

// Score a set of findings into per-dimension scores and one composite. A
// dimension with no findings scores a full 100 (you cannot be penalized for
// slop you had no opportunity to introduce); the composite is the
// profile-weighted mean across every dimension the profile defines.
export const computeSlopScore = (
  findings: ScanFinding[],
  addedLineCount: number,
  profile: ScoringProfile,
): SlopScoreResult => {
  const violations = findings.map((finding) => computeViolationWeight(finding, profile));
  const normalizer = computeNormalizer(addedLineCount, profile);

  const dimensions = Object.keys(profile.dimensionWeights).map((dimensionKey): SlopDimensionScore => {
    const dimension = dimensionKey as SlopDimension;
    const dimensionViolations = violations.filter((violation) => violation.dimension === dimension);
    return dimensionScoreFrom(dimension, dimensionViolations, normalizer);
  });

  let weightedScoreTotal = 0;
  let weightTotal = 0;
  for (const dimensionScore of dimensions) {
    const dimensionWeight = profile.dimensionWeights[dimensionScore.dimension];
    weightedScoreTotal += dimensionScore.score * dimensionWeight;
    weightTotal += dimensionWeight;
  }
  const slopScore = weightTotal === 0 ? SCORE_MAX : weightedScoreTotal / weightTotal;

  return {
    violations,
    dimensions,
    slopScore: clamp(slopScore, SCORE_MIN, SCORE_MAX),
    normalizerLines: normalizer * profile.diffSizeNormalizerLines,
  };
};
