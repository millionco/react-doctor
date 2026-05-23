import path from "node:path";
import {
  diagnose,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
} from "react-doctor/api";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { discoverReactSubprojects } from "@react-doctor/core";

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
      addedLineContents.set(currentNewLine, rawLine.slice(1));
      currentNewLine += 1;
    } else if (firstChar === " " || rawLine.length === 0) {
      currentNewLine += 1;
    }
  }

  return addedLineContents;
};

export const isMissingReactProjectError = (error: unknown): boolean =>
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
  /**
   * Optional override for the directory that diagnostic
   * `relativePath`s are computed against. Defaults to
   * `rootDirectory` for the standalone-CLI case. The GitHub
   * action passes the repository root here even when `rootDirectory`
   * is a project sub-tree (per the action's `directory` input), so
   * the resulting paths line up with the PR-changed-file keys
   * returned by `pulls.listFiles` (which are always repository-root
   * relative). Without this, diagnostics from a non-root scan would
   * have paths like `src/App.tsx` while the PR keys say
   * `packages/my-app/src/App.tsx`, so the `changedFilesByPath.get`
   * lookup in `buildInlineCommentCandidates` always misses and no
   * inline comments are posted.
   */
  pathBaseDirectory: string = rootDirectory,
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
      const relativeProjectDirectory = path.relative(pathBaseDirectory, target.directory);
      const projectDiagnostics = result.diagnostics.map((diagnostic) =>
        toReviewDiagnostic(
          diagnostic,
          target.directory,
          pathBaseDirectory,
          relativeProjectDirectory,
        ),
      );
      allDiagnostics.push(...projectDiagnostics);

      const projectScore = result.score?.score ?? null;
      projectSummaries.push(
        summarizeProject(projectDiagnostics, result.project, pathBaseDirectory, projectScore),
      );

      if (projectScore !== null && result.project.sourceFileCount > 0) {
        weightedScoreSum += projectScore * result.project.sourceFileCount;
        totalSourceFiles += result.project.sourceFileCount;
      }
    } catch (error) {
      // Only project-discovery failures should silently skip the
      // workspace entry. AmbiguousProjectError is also a
      // ReactDoctorError but means "multiple React roots found here"
      // — propagating it surfaces the misconfiguration instead of
      // silently dropping the project from the workspace fan-out.
      if (isMissingReactProjectError(error)) continue;
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

const positionKey = (diagnostic: ReviewDiagnostic): string =>
  `${diagnostic.line}:${diagnostic.column}`;

export const computeDiagnosticsDelta = (
  headDiagnostics: ReviewDiagnostic[],
  baseDiagnostics: ReviewDiagnostic[],
): ReviewDiff => {
  const headByKey = indexDiagnosticsByKey(headDiagnostics);
  const baseByKey = indexDiagnosticsByKey(baseDiagnostics);

  const newDiagnostics: ReviewDiagnostic[] = [];
  const fixedDiagnostics: ReviewDiagnostic[] = [];

  // For each (relativePath, rule, message) key, diff at the
  // (line, column) granularity so we identify which specific
  // occurrence is genuinely new vs which one merely shifted lines.
  // Slicing the head bucket by count (the previous approach) systematically
  // picked the highest-line occurrences as "new", which mis-attributed
  // novelty when the new instance was at a lower line than an existing one.
  const allKeys = new Set<string>([...headByKey.keys(), ...baseByKey.keys()]);
  for (const key of allKeys) {
    const headOccurrences = headByKey.get(key) ?? [];
    const baseOccurrences = baseByKey.get(key) ?? [];
    const basePositionCounts = new Map<string, number>();
    for (const baseOccurrence of baseOccurrences) {
      const positionId = positionKey(baseOccurrence);
      basePositionCounts.set(positionId, (basePositionCounts.get(positionId) ?? 0) + 1);
    }
    for (const headOccurrence of headOccurrences) {
      const positionId = positionKey(headOccurrence);
      const remaining = basePositionCounts.get(positionId) ?? 0;
      if (remaining > 0) {
        basePositionCounts.set(positionId, remaining - 1);
        continue;
      }
      newDiagnostics.push(headOccurrence);
    }
    for (const baseOccurrence of baseOccurrences) {
      const positionId = positionKey(baseOccurrence);
      const remaining = basePositionCounts.get(positionId) ?? 0;
      if (remaining > 0) {
        basePositionCounts.set(positionId, remaining - 1);
        fixedDiagnostics.push(baseOccurrence);
      }
    }
  }

  return { newDiagnostics, fixedDiagnostics };
};

/**
 * Compact, stable hash of a diagnostic message so two violations
 * with the same `(path, line, rule)` but different messages stay
 * distinct in the thread-key space. Crockford base32-ish encoding
 * of the FNV-1a 32-bit hash keeps the key short while remaining
 * deterministic across runs (vs. e.g. encoding the full message,
 * which would blow up comment-marker length and break in
 * messages containing the marker delimiter).
 */
const messageDigest = (message: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

/**
 * Composite key for matching inline review threads across runs.
 * `(relativePath, line, rule, message-hash)` mirrors the
 * `(path, rule, message)` identity used by `computeDiagnosticsDelta`
 * — without the message component, two net-new errors with the
 * same rule on one line but different messages would collapse to
 * one thread, hiding the second violation.
 *
 * KNOWN LIMITATION: including `line` means a violation that
 * survives a push but lands on a different line (because the user
 * added/removed lines above it) gets a new thread key, so the
 * previous thread is resolved as "addressed" and a fresh inline
 * comment is posted at the new line. Removing `line` would
 * conflate distinct violations of the same rule + message on
 * different lines. A proper fix requires tracking original-line
 * anchors per thread (server-side state), which is out of scope
 * for this in-repo action and tracked in TODOS.md.
 */
export const buildThreadKey = (
  relativePath: string,
  line: number,
  rule: string,
  message: string,
): string => `${relativePath}:${line}|${rule}|${messageDigest(message)}`;

export const formatInlineCommentBody = (diagnostic: ReviewDiagnostic): string => {
  const lines: string[] = [];
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
  const candidatesByThreadKey = new Map<string, InlineCommentCandidate>();
  for (const diagnostic of newDiagnostics) {
    if (diagnostic.severity !== "error") continue;
    const changedFile = changedFilesByPath.get(diagnostic.relativePath);
    if (!changedFile) continue;
    if (!changedFile.addedLineContents.has(diagnostic.line)) continue;

    const threadKey = buildThreadKey(
      diagnostic.relativePath,
      diagnostic.line,
      diagnostic.rule,
      diagnostic.message,
    );
    // Dedupe by threadKey: duplicate diagnostics on the same
    // `(path, line, rule, message)` (e.g. two passes in the same
    // scan, or a rule firing twice on identical source) would
    // otherwise yield two inline candidates with the same key,
    // causing `createReview` to either duplicate-post or reject
    // the whole batch.
    if (candidatesByThreadKey.has(threadKey)) continue;
    candidatesByThreadKey.set(threadKey, {
      relativePath: diagnostic.relativePath,
      line: diagnostic.line,
      body: formatInlineCommentBody(diagnostic),
      threadKey,
    });
  }
  return [...candidatesByThreadKey.values()];
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
