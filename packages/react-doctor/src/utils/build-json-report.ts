import type {
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportMode,
  JsonReportProjectEntry,
  ScanResult,
} from "../types.js";
import { summarizeDiagnostics } from "./summarize-diagnostics.js";

interface BuildJsonReportInput {
  version: string;
  directory: string;
  mode: JsonReportMode;
  diff: DiffInfo | null;
  scans: Array<{ directory: string; result: ScanResult }>;
  totalElapsedMilliseconds: number;
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
  projects: JsonReportProjectEntry[],
): JsonReportProjectEntry | null => {
  const scoredProjects = projects.filter((entry) => entry.score !== null);
  if (scoredProjects.length === 0) return null;
  return scoredProjects.reduce((lowest, current) =>
    (current.score?.score ?? Number.POSITIVE_INFINITY) <
    (lowest.score?.score ?? Number.POSITIVE_INFINITY)
      ? current
      : lowest,
  );
};

export const buildJsonReport = (input: BuildJsonReportInput): JsonReport => {
  const projects: JsonReportProjectEntry[] = input.scans.map(({ directory, result }) => ({
    directory,
    project: result.project,
    diagnostics: result.diagnostics,
    score: result.scoreResult,
    skippedChecks: result.skippedChecks,
    elapsedMilliseconds: result.elapsedMilliseconds,
  }));

  const flattenedDiagnostics = projects.flatMap((entry) => entry.diagnostics);
  const worstScoredProject = findWorstScoredProject(projects);

  const summary = summarizeDiagnostics(
    flattenedDiagnostics,
    worstScoredProject?.score?.score ?? null,
    worstScoredProject?.score?.label ?? null,
  );

  return {
    schemaVersion: 1,
    version: input.version,
    ok: true,
    directory: input.directory,
    mode: input.mode,
    diff: toJsonDiff(input.diff),
    projects,
    diagnostics: flattenedDiagnostics,
    summary,
    elapsedMilliseconds: input.totalElapsedMilliseconds,
  };
};
