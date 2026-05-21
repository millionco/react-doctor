import path from "node:path";
import { diagnose } from "react-doctor/api";
import {
  isReactDoctorError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
} from "react-doctor/api";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import { discoverReactSubprojects } from "@react-doctor/project-info";
import { INLINE_COMMENT_MARKER } from "./constants.ts";

export interface ChangedFile {
  filename: string;
  patch: string | null;
  addedLineContents: Map<number, string>;
}

export interface ReviewDiagnostic {
  relativePath: string;
  line: number;
  column: number;
  rule: string;
  plugin: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  url?: string;
  suppressionHint?: string;
}

export interface ReviewProjectSummary {
  projectName: string;
  relativeDirectory: string;
  reactVersion: string | null;
  framework: string;
  sourceFileCount: number;
  score: number | null;
  errorCount: number;
  warningCount: number;
}

export interface DiagnoseSnapshot {
  diagnostics: ReviewDiagnostic[];
  projects: ReviewProjectSummary[];
  combinedScore: number | null;
  hasReact: boolean;
}

export interface InlineCommentCandidate {
  relativePath: string;
  line: number;
  body: string;
  threadKey: string;
}

export interface ReviewDiff {
  newDiagnostics: ReviewDiagnostic[];
  fixedDiagnostics: ReviewDiagnostic[];
}

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export const parseAddedLineContents = (patch: string | null | undefined): Map<number, string> => {
  const addedLineContents = new Map<number, string>();
  if (!patch) return addedLineContents;

  let currentNewLine = 0;
  for (const rawLine of patch.split("\n")) {
    const hunkMatch = rawLine.match(HUNK_HEADER_PATTERN);
    if (hunkMatch) {
      currentNewLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      continue;
    }
    if (currentNewLine === 0) continue;

    const firstChar = rawLine.charAt(0);
    if (firstChar === "+") {
      if (rawLine.startsWith("+++ ")) continue;
      addedLineContents.set(currentNewLine, rawLine.slice(1));
      currentNewLine += 1;
    } else if (firstChar === "-") {
      if (rawLine.startsWith("--- ")) continue;
    } else if (firstChar === " " || rawLine.length === 0) {
      currentNewLine += 1;
    } else if (firstChar === "\\") {
      continue;
    }
  }

  return addedLineContents;
};

const isMissingReactProjectError = (error: unknown): boolean =>
  error instanceof NoReactDependencyError ||
  error instanceof PackageJsonNotFoundError ||
  error instanceof ProjectNotFoundError;

const resolveRelativePath = (
  rawFilePath: string,
  projectRootDirectory: string,
  rootDirectory: string,
  relativeProjectDirectory: string,
): string => {
  const normalizedFilePath = rawFilePath.replace(/\\/g, "/");
  const normalizedRoot = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedProjectRoot = projectRootDirectory.replace(/\\/g, "/").replace(/\/$/, "");

  if (path.isAbsolute(normalizedFilePath)) {
    if (
      normalizedFilePath === normalizedRoot ||
      normalizedFilePath.startsWith(`${normalizedRoot}/`)
    ) {
      return normalizedFilePath.slice(normalizedRoot.length + 1);
    }
    if (
      normalizedFilePath === normalizedProjectRoot ||
      normalizedFilePath.startsWith(`${normalizedProjectRoot}/`)
    ) {
      const insideProject = normalizedFilePath.slice(normalizedProjectRoot.length + 1);
      return relativeProjectDirectory
        ? `${relativeProjectDirectory}/${insideProject}`
        : insideProject;
    }
    return normalizedFilePath;
  }

  if (!relativeProjectDirectory) return normalizedFilePath;
  const projectPrefix = `${relativeProjectDirectory}/`;
  if (
    normalizedFilePath === relativeProjectDirectory ||
    normalizedFilePath.startsWith(projectPrefix)
  ) {
    return normalizedFilePath;
  }
  return `${relativeProjectDirectory}/${normalizedFilePath}`;
};

const toReviewDiagnostic = (
  diagnostic: Diagnostic,
  projectRootDirectory: string,
  rootDirectory: string,
  relativeProjectDirectory: string,
): ReviewDiagnostic => ({
  relativePath: resolveRelativePath(
    diagnostic.filePath,
    projectRootDirectory,
    rootDirectory,
    relativeProjectDirectory,
  ),
  line: diagnostic.line,
  column: diagnostic.column,
  rule: diagnostic.rule,
  plugin: diagnostic.plugin,
  severity: diagnostic.severity,
  message: diagnostic.message,
  help: diagnostic.help,
  ...(diagnostic.url ? { url: diagnostic.url } : {}),
  ...(diagnostic.suppressionHint ? { suppressionHint: diagnostic.suppressionHint } : {}),
});

const summarizeProject = (
  diagnostics: ReviewDiagnostic[],
  project: ProjectInfo,
  rootDirectory: string,
  score: number | null,
): ReviewProjectSummary => {
  const errorCount = diagnostics.filter((entry) => entry.severity === "error").length;
  const warningCount = diagnostics.filter((entry) => entry.severity === "warning").length;
  const relativeDirectory = path.relative(rootDirectory, project.rootDirectory) || ".";

  return {
    projectName: project.projectName,
    relativeDirectory,
    reactVersion: project.reactVersion,
    framework: project.framework,
    sourceFileCount: project.sourceFileCount,
    score,
    errorCount,
    warningCount,
  };
};

export const runDiagnoseAcrossWorkspace = async (
  rootDirectory: string,
): Promise<DiagnoseSnapshot> => {
  const subprojects = discoverReactSubprojects(rootDirectory);
  const targets =
    subprojects.length > 0 ? subprojects : [{ name: "root", directory: rootDirectory }];

  const allDiagnostics: ReviewDiagnostic[] = [];
  const projectSummaries: ReviewProjectSummary[] = [];
  let weightedScoreSum = 0;
  let totalSourceFiles = 0;
  let anyProjectHasReact = false;

  for (const target of targets) {
    try {
      const result = await diagnose(target.directory);
      anyProjectHasReact = true;
      const relativeProjectDirectory = path.relative(rootDirectory, target.directory);
      const projectDiagnostics = result.diagnostics.map((diagnostic) =>
        toReviewDiagnostic(diagnostic, target.directory, rootDirectory, relativeProjectDirectory),
      );
      allDiagnostics.push(...projectDiagnostics);

      const projectScore = result.score?.score ?? null;
      projectSummaries.push(
        summarizeProject(projectDiagnostics, result.project, rootDirectory, projectScore),
      );

      if (projectScore !== null && result.project.sourceFileCount > 0) {
        weightedScoreSum += projectScore * result.project.sourceFileCount;
        totalSourceFiles += result.project.sourceFileCount;
      }
    } catch (error) {
      if (isMissingReactProjectError(error) || isReactDoctorError(error)) continue;
      throw error;
    }
  }

  const combinedScore =
    totalSourceFiles > 0 ? Math.round(weightedScoreSum / totalSourceFiles) : null;

  return {
    diagnostics: allDiagnostics,
    projects: projectSummaries,
    combinedScore,
    hasReact: anyProjectHasReact,
  };
};

const diagnosticKey = (diagnostic: ReviewDiagnostic): string =>
  `${diagnostic.relativePath}|${diagnostic.rule}|${diagnostic.message}`;

const indexDiagnosticsByKey = (
  diagnostics: ReviewDiagnostic[],
): Map<string, ReviewDiagnostic[]> => {
  const indexed = new Map<string, ReviewDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const bucket = indexed.get(key);
    if (bucket) {
      bucket.push(diagnostic);
    } else {
      indexed.set(key, [diagnostic]);
    }
  }
  return indexed;
};

export const computeDiagnosticsDelta = (
  headDiagnostics: ReviewDiagnostic[],
  baseDiagnostics: ReviewDiagnostic[],
): ReviewDiff => {
  const headByKey = indexDiagnosticsByKey(headDiagnostics);
  const baseByKey = indexDiagnosticsByKey(baseDiagnostics);

  const newDiagnostics: ReviewDiagnostic[] = [];
  const fixedDiagnostics: ReviewDiagnostic[] = [];

  for (const [key, headOccurrences] of headByKey) {
    const baseCount = baseByKey.get(key)?.length ?? 0;
    if (headOccurrences.length > baseCount) {
      newDiagnostics.push(...headOccurrences.slice(baseCount));
    }
  }

  for (const [key, baseOccurrences] of baseByKey) {
    const headCount = headByKey.get(key)?.length ?? 0;
    if (baseOccurrences.length > headCount) {
      fixedDiagnostics.push(...baseOccurrences.slice(headCount));
    }
  }

  return { newDiagnostics, fixedDiagnostics };
};

export const buildThreadKey = (relativePath: string, line: number, rule: string): string =>
  `${relativePath}:${line}|${rule}`;

export const formatInlineCommentBody = (diagnostic: ReviewDiagnostic): string => {
  const lines: string[] = [INLINE_COMMENT_MARKER];
  lines.push(`**${diagnostic.rule}** (${diagnostic.severity})`);
  lines.push("");
  lines.push(diagnostic.message);
  if (diagnostic.help) {
    lines.push("");
    lines.push(diagnostic.help);
  }
  if (diagnostic.suppressionHint) {
    lines.push("");
    lines.push("```");
    lines.push(diagnostic.suppressionHint);
    lines.push("```");
  }
  if (diagnostic.url) {
    lines.push("");
    lines.push(`[Rule docs](${diagnostic.url})`);
  }
  return lines.join("\n");
};

export const buildInlineCommentCandidates = (
  newDiagnostics: ReviewDiagnostic[],
  changedFilesByPath: Map<string, ChangedFile>,
): InlineCommentCandidate[] => {
  const candidates: InlineCommentCandidate[] = [];
  for (const diagnostic of newDiagnostics) {
    if (diagnostic.severity !== "error") continue;
    const changedFile = changedFilesByPath.get(diagnostic.relativePath);
    if (!changedFile) continue;
    if (!changedFile.addedLineContents.has(diagnostic.line)) continue;

    candidates.push({
      relativePath: diagnostic.relativePath,
      line: diagnostic.line,
      body: formatInlineCommentBody(diagnostic),
      threadKey: buildThreadKey(diagnostic.relativePath, diagnostic.line, diagnostic.rule),
    });
  }
  return candidates;
};

const scoreLabel = (score: number): string => {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "Needs Work";
};

const formatScoreLine = (headScore: number | null, baseScore: number | null): string => {
  if (headScore === null) return "_Score unavailable._";
  const label = scoreLabel(headScore);
  if (baseScore === null) return `**Score:** ${headScore}/100 - ${label}`;
  const delta = headScore - baseScore;
  if (delta === 0) return `**Score:** ${headScore}/100 - ${label} (unchanged from base)`;
  const sign = delta > 0 ? "+" : "";
  return `**Score:** ${headScore}/100 - ${label} (${sign}${delta} vs base ${baseScore})`;
};

const formatProjectTable = (projects: ReviewProjectSummary[]): string => {
  if (projects.length === 0) return "";
  const rows: string[] = [];
  rows.push("| Project | Directory | Framework | React | Files | Errors | Warnings | Score |");
  rows.push("| --- | --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const project of projects) {
    const reactVersion = project.reactVersion ?? "-";
    const score = project.score === null ? "-" : `${project.score}`;
    rows.push(
      `| ${project.projectName} | \`${project.relativeDirectory}\` | ${project.framework} | ${reactVersion} | ${project.sourceFileCount} | ${project.errorCount} | ${project.warningCount} | ${score} |`,
    );
  }
  return rows.join("\n");
};

const formatDiagnosticList = (diagnostics: ReviewDiagnostic[], maxEntries: number): string => {
  if (diagnostics.length === 0) return "";
  const visible = diagnostics.slice(0, maxEntries);
  const lines = visible.map(
    (diagnostic) =>
      `- \`${diagnostic.relativePath}:${diagnostic.line}\` - **${diagnostic.rule}** (${diagnostic.severity}) - ${diagnostic.message}`,
  );
  if (diagnostics.length > visible.length) {
    lines.push(`- _…and ${diagnostics.length - visible.length} more_`);
  }
  return lines.join("\n");
};

const REACT_DOCTOR_FOOTER =
  "_Reviewed by [react-doctor](https://github.com/millionco/react-doctor) - local CI, no hosted service._";

const PROMPT_BLOCK = [
  "<details><summary>Have your agent fix these</summary>",
  "",
  "```",
  "Fix the diagnostics react-doctor reported on this PR. For each diagnostic:",
  "1. Open the file at the reported line.",
  "2. Read the rule's docs (linked above) so the fix matches intent, not just shape.",
  "3. Apply the smallest correct change, then re-run `pnpm exec react-doctor --diff <base>`.",
  "Resolve each thread once the fix lands; do not blanket-suppress.",
  "```",
  "",
  "</details>",
].join("\n");

export const formatPendingReviewComment = (): string =>
  ["## React Doctor Review", "", "_Analyzing this PR…_", "", REACT_DOCTOR_FOOTER].join("\n");

export const formatAnalysisFailureComment = (errorMessage: string): string =>
  [
    "## React Doctor Review",
    "",
    "**Analysis failed.**",
    "",
    "```",
    errorMessage,
    "```",
    "",
    REACT_DOCTOR_FOOTER,
  ].join("\n");

export interface CommentBodyInput {
  headScore: number | null;
  baseScore: number | null;
  projects: ReviewProjectSummary[];
  newDiagnostics: ReviewDiagnostic[];
  fixedDiagnostics: ReviewDiagnostic[];
  headSha: string;
}

const MAX_LISTED_DIAGNOSTICS = 20;

export const formatNoIssuesComment = (input: CommentBodyInput): string => {
  const parts: string[] = [];
  parts.push("## React Doctor Review");
  parts.push("");
  parts.push(formatScoreLine(input.headScore, input.baseScore));
  parts.push("");
  parts.push("No new React Doctor regressions in this PR.");
  if (input.fixedDiagnostics.length > 0) {
    parts.push("");
    parts.push(`**Fixed in this PR (${input.fixedDiagnostics.length}):**`);
    parts.push("");
    parts.push(formatDiagnosticList(input.fixedDiagnostics, MAX_LISTED_DIAGNOSTICS));
  }
  const projectTable = formatProjectTable(input.projects);
  if (projectTable) {
    parts.push("");
    parts.push("<details><summary>Doctor metrics</summary>");
    parts.push("");
    parts.push(projectTable);
    parts.push("");
    parts.push("</details>");
  }
  parts.push("");
  parts.push(REACT_DOCTOR_FOOTER);
  return parts.join("\n");
};

export const formatRegressionComment = (input: CommentBodyInput): string => {
  const parts: string[] = [];
  parts.push("## React Doctor Review");
  parts.push("");
  parts.push(formatScoreLine(input.headScore, input.baseScore));
  parts.push("");
  parts.push(`**New diagnostics (${input.newDiagnostics.length}):**`);
  parts.push("");
  parts.push(formatDiagnosticList(input.newDiagnostics, MAX_LISTED_DIAGNOSTICS));
  if (input.fixedDiagnostics.length > 0) {
    parts.push("");
    parts.push(`**Fixed in this PR (${input.fixedDiagnostics.length}):**`);
    parts.push("");
    parts.push(formatDiagnosticList(input.fixedDiagnostics, MAX_LISTED_DIAGNOSTICS));
  }
  parts.push("");
  parts.push(PROMPT_BLOCK);
  const projectTable = formatProjectTable(input.projects);
  if (projectTable) {
    parts.push("");
    parts.push("<details><summary>Doctor metrics</summary>");
    parts.push("");
    parts.push(projectTable);
    parts.push("");
    parts.push("</details>");
  }
  parts.push("");
  parts.push(REACT_DOCTOR_FOOTER);
  return parts.join("\n");
};

export const getReviewCheckAssessment = (input: CommentBodyInput): string => {
  const parts: string[] = [];
  parts.push(formatScoreLine(input.headScore, input.baseScore));
  parts.push("");
  if (input.newDiagnostics.length === 0) {
    parts.push("No new React Doctor regressions detected.");
  } else {
    parts.push(`**New diagnostics (${input.newDiagnostics.length}):**`);
    parts.push("");
    parts.push(formatDiagnosticList(input.newDiagnostics, MAX_LISTED_DIAGNOSTICS));
  }
  if (input.fixedDiagnostics.length > 0) {
    parts.push("");
    parts.push(`**Fixed in this PR (${input.fixedDiagnostics.length}):**`);
    parts.push("");
    parts.push(formatDiagnosticList(input.fixedDiagnostics, MAX_LISTED_DIAGNOSTICS));
  }
  const projectTable = formatProjectTable(input.projects);
  if (projectTable) {
    parts.push("");
    parts.push("### Projects");
    parts.push("");
    parts.push(projectTable);
  }
  return parts.join("\n");
};
