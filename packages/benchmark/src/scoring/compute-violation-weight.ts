import { DEFAULT_WEIGHT_MULTIPLIER } from "../constants.js";
import type { ScanFinding, ScoringProfile, SlopViolation } from "../types/index.js";

// Turn a raw scanner finding into a weighted violation. Weight is the single
// place severity, React Doctor category, and per-rule Vercel/TS impact tiers
// combine, so every scanner is scored on the same scale:
//   weight = severityBase × categoryMultiplier × ruleImpactMultiplier
export const computeViolationWeight = (
  finding: ScanFinding,
  profile: ScoringProfile,
): SlopViolation => {
  const severityBase = profile.severityWeights[finding.severity];
  const categoryMultiplier =
    finding.category === undefined
      ? DEFAULT_WEIGHT_MULTIPLIER
      : (profile.categoryMultipliers[finding.category] ?? DEFAULT_WEIGHT_MULTIPLIER);
  const ruleImpactMultiplier =
    profile.ruleImpactMultipliers[finding.ruleId] ?? DEFAULT_WEIGHT_MULTIPLIER;

  return {
    scanner: finding.scanner,
    dimension: finding.dimension,
    ruleId: finding.ruleId,
    severity: finding.severity,
    weight: severityBase * categoryMultiplier * ruleImpactMultiplier,
    filePath: finding.filePath,
    line: finding.line,
    message: finding.message,
  };
};
