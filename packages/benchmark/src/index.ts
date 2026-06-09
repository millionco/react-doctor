export { runSlopVerifier } from "./run-slop-verifier.js";
export type { SlopVerifierOptions } from "./run-slop-verifier.js";
export { runCli } from "./cli.js";
export { computeSlopScore } from "./scoring/slop-score.js";
export { loadScoringProfile } from "./scoring/load-scoring-profile.js";
export { DEFAULT_SCORING_PROFILE, SCORING_VERSION } from "./constants.js";
export type {
  ScanFinding,
  ScannerContext,
  ScannerName,
  ScoringProfile,
  SlopDimension,
  SlopDimensionScore,
  SlopDiffStats,
  SlopReport,
  SlopViolation,
} from "./types/index.js";
