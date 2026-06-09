import { DEFAULT_REACT_DOCTOR_BIN } from "./constants.js";
import { runAstChecks } from "./scanners/run-ast-checks.js";
import { runReactDoctor } from "./scanners/run-react-doctor.js";
import { loadScoringProfile } from "./scoring/load-scoring-profile.js";
import { computeSlopScore } from "./scoring/slop-score.js";
import type { ScannerContext, SlopReport } from "./types/index.js";
import { collectDiff } from "./utils/collect-diff.js";

export interface SlopVerifierOptions {
  // Absolute path to the project the agent edited.
  rootDirectory: string;
  // Git ref the agent started from; the diff is computed against it.
  baseRef: string;
  // React Doctor CLI to invoke; defaults to `react-doctor` on PATH.
  reactDoctorBin?: string;
  // Optional scoring-profile JSON path; defaults to the built-in profile.
  profilePath?: string;
  // The functional-test outcome, when known, so the report can carry the
  // composite reward. `null`/omitted ⇒ quality-only run.
  functionalPass?: boolean | null;
}

const computeReward = (functionalPass: boolean | null, slopScore: number): number | null => {
  if (functionalPass === null) return null;
  return functionalPass ? slopScore / 100 : 0;
};

// Run the full slop verification pipeline over a graded diff and assemble the
// SlopReport: collect the diff, run React Doctor (offline) plus the AST checks,
// score deterministically, and combine with the functional gate. Pure of any
// process exit — the caller (CLI / test.sh) decides how to act on the report.
export const runSlopVerifier = (options: SlopVerifierOptions): SlopReport => {
  const profile = loadScoringProfile(options.profilePath);
  const diff = collectDiff(options.rootDirectory, options.baseRef);
  const scannerErrors: string[] = [];
  if (diff.error) scannerErrors.push(`diff: ${diff.error}`);

  const context: ScannerContext = {
    rootDirectory: options.rootDirectory,
    changedFiles: diff.changedFiles,
    baseRef: options.baseRef,
    addedLineCount: diff.addedLineCount,
    reactDoctorBin: options.reactDoctorBin ?? DEFAULT_REACT_DOCTOR_BIN,
  };

  const reactDoctor = runReactDoctor(context);
  if (reactDoctor.error) scannerErrors.push(`react-doctor: ${reactDoctor.error}`);
  const astFindings = runAstChecks(context);

  const findings = [...reactDoctor.findings, ...astFindings];
  const scored = computeSlopScore(findings, diff.addedLineCount, profile);
  const functionalPass = options.functionalPass ?? null;

  return {
    scoringVersion: profile.version,
    doctorVersion: reactDoctor.doctorVersion,
    generatedAt: new Date().toISOString(),
    diffStats: {
      changedFileCount: diff.changedFiles.length,
      addedLineCount: diff.addedLineCount,
      normalizerLines: scored.normalizerLines,
    },
    violations: scored.violations,
    dimensions: scored.dimensions,
    slopScore: scored.slopScore,
    scannerErrors,
    functionalPass,
    reward: computeReward(functionalPass, scored.slopScore),
  };
};
