import type { JsonReport } from "@react-doctor/core";
import {
  REACT_DOCTOR_CATEGORY_TO_DIMENSION,
  REACT_DOCTOR_FALLBACK_DIMENSION,
  REACT_DOCTOR_RULE_TO_DIMENSION,
} from "../constants.js";
import type { ScanFinding, ScannerContext, SlopDimension } from "../types/index.js";
import { resolveBinInvocation } from "../utils/resolve-bin-invocation.js";
import { runCommand } from "../utils/run-command.js";

export interface ReactDoctorScanResult {
  findings: ScanFinding[];
  // The CLI's reported version, for the SlopReport provenance field.
  doctorVersion: string | null;
  // Set when the CLI could not be run or its output was unparseable. A failed
  // React Doctor scan must not silently score as "clean", so the orchestrator
  // surfaces this rather than treating zero findings as success.
  error: string | null;
}

// React Doctor exits non-zero whenever it finds issues, so a clean JSON parse —
// not the exit code — is the success signal.
const parseReport = (stdout: string): JsonReport | null => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && "diagnostics" in parsed) {
      return parsed as JsonReport;
    }
    return null;
  } catch {
    return null;
  }
};

const resolveDimension = (ruleId: string, category: string): SlopDimension =>
  REACT_DOCTOR_RULE_TO_DIMENSION[ruleId] ??
  REACT_DOCTOR_CATEGORY_TO_DIMENSION[category] ??
  REACT_DOCTOR_FALLBACK_DIMENSION;

const toFinding = (diagnostic: JsonReport["diagnostics"][number]): ScanFinding => {
  const ruleId = `${diagnostic.plugin}/${diagnostic.rule}`;
  return {
    scanner: "react-doctor",
    dimension: resolveDimension(ruleId, diagnostic.category),
    ruleId,
    severity: diagnostic.severity,
    filePath: diagnostic.filePath,
    line: diagnostic.line,
    message: diagnostic.message,
    category: diagnostic.category,
  };
};

// Run React Doctor over the whole project (offline, no remote score), then keep
// only diagnostics in files the agent changed. Diff-scoping by changed file —
// rather than React Doctor's own `--diff` git semantics — keeps grading
// deterministic and ensures pre-existing, untouched slop is never charged to
// the agent.
export const runReactDoctor = (context: ScannerContext): ReactDoctorScanResult => {
  const changed = new Set(context.changedFiles);
  const { command, prefixArgs } = resolveBinInvocation(context.reactDoctorBin);
  const result = runCommand(
    command,
    [...prefixArgs, context.rootDirectory, "--json", "--no-score"],
    { cwd: context.rootDirectory },
  );

  if (result.spawnFailed) {
    return {
      findings: [],
      doctorVersion: null,
      error: `react-doctor failed to start: ${result.stderr}`,
    };
  }

  const report = parseReport(result.stdout);
  if (!report) {
    return {
      findings: [],
      doctorVersion: null,
      error: `react-doctor produced no parseable JSON report (exit ${result.exitCode})`,
    };
  }

  const findings = report.diagnostics
    .filter((diagnostic) => changed.has(diagnostic.filePath))
    .map(toFinding);
  return { findings, doctorVersion: report.version ?? null, error: null };
};
