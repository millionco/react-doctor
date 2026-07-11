import * as path from "node:path";
import type {
  Diagnostic,
  DiffInfo,
  JsonReportDiagnosticV3,
  JsonReportDiffInfo,
  JsonReportMode,
  JsonReportProjectEntryV3,
  JsonReportV3,
  InspectResult,
} from "./types/index.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";
import { buildDiagnosticIdentity } from "./schemas.js";
import { summarizeDiagnostics } from "./summarize-diagnostics.js";
import { hasReactRuntime } from "./utils/has-react-runtime.js";
import { isScanComplete } from "./utils/is-scan-complete.js";
import { toNormalizedRelativePath } from "./utils/to-normalized-relative-path.js";

interface BuildJsonReportInput {
  version: string;
  directory: string;
  mode: JsonReportMode;
  diff: DiffInfo | null;
  scans: Array<{ directory: string; result: InspectResult }>;
  totalElapsedMilliseconds: number;
  /**
   * Present for a baseline run — `scans[].result.diagnostics` are then the
   * introduced findings only. Emits a `schemaVersion: 3` report with the
   * delta totals and `mode: "baseline"`.
   */
  baseline?: { baseRef: string; fixedCount: number; baseTotalCount: number };
  /**
   * True when a `changed` run was intended but its baseline delta couldn't be
   * computed (no merge base — usually a shallow CI checkout — or a failed
   * base/head lint), so `diagnostics` list every finding in the changed files
   * rather than only the introduced ones. Ignored when `baseline` is set: a
   * computed baseline wins, so callers pass at most one.
   */
  baselineDegraded?: boolean;
}

const toJsonDiff = (diff: DiffInfo | null): JsonReportDiffInfo | null => {
  if (!diff) return null;
  return {
    baseBranch: diff.baseBranch,
    currentBranch: diff.currentBranch,
    changedFileCount: diff.changedFiles.length,
    isCurrentChanges: Boolean(diff.isCurrentChanges),
  };
};

const findWorstScoredProject = (
  projects: JsonReportProjectEntryV3[],
): JsonReportProjectEntryV3 | null => {
  let worst: JsonReportProjectEntryV3 | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const project of projects) {
    const score = project.score?.score;
    if (typeof score !== "number") continue;
    if (score < worstScore) {
      worstScore = score;
      worst = project;
    }
  }
  return worst;
};

const toJsonReportDiagnostic = (
  diagnostic: Diagnostic,
  projectRoot: string,
  reportRoot: string,
): JsonReportDiagnosticV3 => {
  const normalizedFilePath = toNormalizedRelativePath(diagnostic.filePath, projectRoot);
  const reportRelativeFilePath = toNormalizedRelativePath(
    path.resolve(projectRoot, diagnostic.filePath),
    reportRoot,
  );
  const ruleIdentity = getDiagnosticRuleIdentity(diagnostic);
  return {
    ...diagnostic,
    id: buildDiagnosticIdentity({
      filePath: reportRelativeFilePath,
      line: diagnostic.line,
      column: diagnostic.column,
      plugin: diagnostic.plugin,
      rule: diagnostic.rule,
    }),
    normalizedFilePath,
    category: ruleIdentity.category,
    tags: [...new Set(ruleIdentity.tags)].sort(),
  };
};

export const buildJsonReport = (input: BuildJsonReportInput): JsonReportV3 => {
  const projects: JsonReportProjectEntryV3[] = input.scans.map(({ directory, result }) => {
    const skippedChecks = result.skippedChecks ?? [];
    const analyzedFiles = [
      ...new Set(
        (result.analyzedFiles ?? []).map((filePath) =>
          toNormalizedRelativePath(filePath, result.project.rootDirectory),
        ),
      ),
    ].sort();
    const scannedFileCount = result.scannedFileCount ?? result.project.sourceFileCount;
    return {
      directory,
      packageRoot: result.project.rootDirectory,
      framework: result.project.framework,
      project: result.project,
      diagnostics: result.diagnostics.map((diagnostic) =>
        toJsonReportDiagnostic(diagnostic, result.project.rootDirectory, input.directory),
      ),
      score: result.score,
      skippedChecks,
      ...(result.skippedCheckReasons ? { skippedCheckReasons: result.skippedCheckReasons } : {}),
      analyzedFiles,
      analyzedFileCount: analyzedFiles.length,
      complete: isScanComplete({
        analyzedFileCount: result.analyzedFiles === undefined ? undefined : analyzedFiles.length,
        scannedFileCount,
        skippedCheckCount: skippedChecks.length,
        skippedCheckReasonCount: Object.keys(result.skippedCheckReasons ?? {}).length,
      }),
      ...(typeof result.scannedFileCount === "number" ? { scannedFileCount } : {}),
      elapsedMilliseconds: result.elapsedMilliseconds,
    };
  });

  const flattenedDiagnostics = projects.flatMap((entry) => entry.diagnostics);
  const worstScoredProject = findWorstScoredProject(projects);

  const diagnosticSummary = summarizeDiagnostics(
    flattenedDiagnostics,
    worstScoredProject?.score?.score ?? null,
    worstScoredProject?.score?.label ?? null,
  );
  const affectedFileCount = projects.reduce(
    (totalAffectedFileCount, project) =>
      totalAffectedFileCount +
      new Set(project.diagnostics.map((diagnostic) => diagnostic.normalizedFilePath)).size,
    0,
  );
  const summary = { ...diagnosticSummary, affectedFileCount };

  return {
    schemaVersion: 3,
    mode:
      input.baseline !== undefined
        ? "baseline"
        : input.baselineDegraded && input.mode === "baseline"
          ? "diff"
          : input.mode,
    ...(input.baseline
      ? {
          baseline: {
            baseRef: input.baseline.baseRef,
            newCount: summary.totalDiagnosticCount,
            fixedCount: input.baseline.fixedCount,
            baseTotalCount: input.baseline.baseTotalCount,
          },
        }
      : {}),
    ...(input.baselineDegraded ? { baselineDegraded: true } : {}),
    ...(input.scans.length > 0
      ? { reactDetected: input.scans.some((scan) => hasReactRuntime(scan.result.project)) }
      : {}),
    version: input.version,
    ok: true as const,
    directory: input.directory,
    diff: toJsonDiff(input.diff),
    projects,
    diagnostics: flattenedDiagnostics,
    summary,
    elapsedMilliseconds: input.totalElapsedMilliseconds,
    error: null,
  };
};
