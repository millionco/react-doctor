import * as fs from "node:fs";
import * as path from "node:path";

const MARKER = "<!-- react-doctor:summary -->";
const BUG_REPORT_URL = "https://github.com/millionco/react-doctor";
const BRAND_LINK = "https://react.doctor";
const WARNING_LIST_LIMIT = 50;

// Emoji severity markers (match the CLI's ✖ / ⚠ at a glance on GitHub).
const SEVERITY_ICON = { error: "❌", warning: "⚠️" };

const [reportPath, commentPath] = process.argv.slice(2);

// Used to turn a diagnostic's repo-relative path + line into a blob link. All
// optional: a local render (no GitHub env) falls back to plain text.
const REPO_SLUG = process.env.GITHUB_REPOSITORY;
const SERVER_URL = (process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/, "");
const HEAD_SHA = process.env.REACT_DOCTOR_HEAD_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "";

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

/**
 * Every user-facing string the PR comment can render, in one place. Static
 * strings are plain values; lines with interpolation are functions. Edit copy
 * here — the `build*` renderers below only assemble layout, never literal text.
 */
const COPY = {
  // Small-font attribution footer. `fixesHint` points reviewers at the inline
  // review comments, which carry the per-line fix guidance + docs link.
  reviewFooter: (commitSegment, fixesHint) =>
    `<sub>Reviewed by [React Doctor](${BRAND_LINK})${commitSegment}.${fixesHint ? " See inline comments for fixes." : ""}</sub>`,
  reviewFooterCommit: (shortSha) => ` for commit \`${shortSha}\``,

  // One-liner summary segments (replace the old metrics tables). buildLeadLine
  // joins the active segments with " · ".
  leadCleanNew: "**React Doctor** found no new issues. 🎉",
  leadClean: "**React Doctor** found no issues. 🎉",
  leadCleanIncomplete: "**React Doctor** found no issues, but some checks were incomplete.",
  leadCount: (issues, files) => `**React Doctor** found **${issues}** in ${files}`,
  leadScore: (score) => `score ${score}`,
  leadFixed: (count) => `${count} fixed`,
  leadScopeChanged: (baseBranch) => `vs \`${baseBranch}\``,
  leadScopeUncommitted: "uncommitted changes",
  leadScopeFull: "full project",

  // Issue lists.
  errorsHeading: "**Errors**",
  warningsMore: (count) => `${count} not shown.`,
  incompleteChecksHeading: "### Incomplete Checks",

  // Clean success — shown when nothing was scanned (no matching source files),
  // which is a pass, not a finding.
  cleanSuccess: "No React Doctor issues found. 🎉",

  // Skipped — a pull request that changed no React-eligible files, so React
  // Doctor examined nothing it lints. Rendered into the job summary; the sticky
  // PR comment is suppressed and the commit status reads "Skipped" (both keyed
  // off the `skipped` output, set by `isSkippedScan`).
  skipped: "React Doctor skipped this pull request — it changed no React files.",

  // Error body.
  errorIntro: "React Doctor could not complete this scan.",
  errorFallbackMessage: "React Doctor failed before completing the scan.",
  reportBugLink: (url) => `[Report this bug](${url})`,
  sentryReference: (eventId) => `Sentry reference: \`${eventId}\``,

  // Bug-report issue prefill (title + body lines).
  bugReportTitle: "React Doctor Action failed",
  bugReportBodyIntro: "React Doctor Action failed before completing a scan.",
  bugReportErrorHeading: "### Error",
  bugReportContextHeading: "### Context",
  bugReportVersion: (version) => `- React Doctor version: ${version}`,
  bugReportMode: (mode) => `- Mode: ${mode}`,
  bugReportWorkflowRun: (url) => `- Workflow run: ${url}`,
  bugReportSentryReference: (eventId) => `- Sentry reference: ${eventId}`,

  // Score formatting.
  scoreUnavailable: "Unavailable",
  score: (score, label) => `${score} / 100${label}`,
  scoreLabel: (label) => ` (${label})`,

  // Stderr warning when no report exists.
  noReportWarning:
    "React Doctor: no scan report was found, so the summary comment was skipped. " +
    "This usually means the scan step did not run.",
};

const inlineText = (value) =>
  String(value ?? "")
    .replaceAll("\n", " ")
    .trim();

const appendOutput = (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value ?? ""}\n`);
};

const readReport = () => {
  if (!reportPath || !fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
};

const renderLines = (lines) =>
  lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

const buildBugReportUrl = (report) => {
  const runUrl = process.env.GITHUB_RUN_URL;
  const message = report.error?.message ?? COPY.errorFallbackMessage;
  const bodyLines = [
    COPY.bugReportBodyIntro,
    "",
    COPY.bugReportErrorHeading,
    "",
    `\`${message}\``,
    "",
    COPY.bugReportContextHeading,
    "",
    COPY.bugReportVersion(report.version ?? "unknown"),
    COPY.bugReportMode(report.mode ?? "unknown"),
    report.error?.sentryEventId ? COPY.bugReportSentryReference(report.error.sentryEventId) : null,
    runUrl ? COPY.bugReportWorkflowRun(runUrl) : null,
  ].filter(Boolean);
  const parameters = new URLSearchParams({
    title: COPY.bugReportTitle,
    body: bodyLines.join("\n"),
  });
  return `${BUG_REPORT_URL}/issues/new?${parameters.toString()}`;
};

const formatScore = (summary) => {
  if (typeof summary?.score !== "number") return COPY.scoreUnavailable;
  const label = typeof summary.scoreLabel === "string" ? COPY.scoreLabel(summary.scoreLabel) : "";
  return COPY.score(summary.score, label);
};

const formatShortRef = (ref) =>
  typeof ref === "string" && ref.length > 0 ? ref.slice(0, 7) : "base";

const buildReviewFooter = (withFixesHint) => {
  const commitSegment = HEAD_SHA ? COPY.reviewFooterCommit(formatShortRef(HEAD_SHA)) : "";
  return COPY.reviewFooter(commitSegment, withFixesHint);
};

const getIncompleteCheckNames = (report) => [
  ...new Set(
    (report.projects ?? []).flatMap((project) => [
      ...(project.skippedChecks ?? []),
      ...Object.keys(project.skippedCheckReasons ?? {}),
    ]),
  ),
];

const hasIncompleteChecks = (report) => getIncompleteCheckNames(report).length > 0;

const isBaselineReport = (report) => report.schemaVersion === 2 || Boolean(report.baseline);

// Concise scope chip for the lead line: the base ref for a diff/baseline run,
// or the whole project for a full scan.
const buildScopeSegment = (report) => {
  if (report.diff && (report.mode === "diff" || report.mode === "baseline")) {
    if (report.diff.isCurrentChanges) return COPY.leadScopeUncommitted;
    return COPY.leadScopeChanged(report.diff.baseBranch || "base");
  }
  return COPY.leadScopeFull;
};

const buildSeveritySegment = (summary) => {
  const parts = [];
  if ((summary.errorCount ?? 0) > 0) parts.push(pluralize(summary.errorCount, "error"));
  if ((summary.warningCount ?? 0) > 0) parts.push(pluralize(summary.warningCount, "warning"));
  return parts.join(" & ");
};

// Consolidates the old metrics table into a single active-voice line: issue
// count, affected files, severity split, score, fixed count, and scope.
const buildLeadLine = (report) => {
  const summary = report.summary ?? {};
  const baseline = report.baseline;
  const baselineMode = isBaselineReport(report);
  const total = baselineMode ? (baseline?.newCount ?? 0) : (summary.totalDiagnosticCount ?? 0);
  if (total === 0) {
    if (hasIncompleteChecks(report)) return COPY.leadCleanIncomplete;
    return baselineMode ? COPY.leadCleanNew : COPY.leadClean;
  }
  const segments = [
    COPY.leadCount(
      pluralize(total, baselineMode ? "new issue" : "issue"),
      pluralize(summary.affectedFileCount ?? 0, "file"),
    ),
  ];
  const severity = buildSeveritySegment(summary);
  if (severity) segments.push(severity);
  if (typeof summary.score === "number") segments.push(COPY.leadScore(formatScore(summary)));
  if (baselineMode) segments.push(COPY.leadFixed(baseline?.fixedCount ?? 0));
  segments.push(buildScopeSegment(report));
  return segments.join(" · ");
};

// `git show <ref>:<path>`-style: diagnostics carry project-relative paths, so
// re-root each against the repo to build a blob link. Returns null when the
// project sits outside the report root (can't safely prefix).
const repoRelativePrefix = (reportDirectory, projectDirectory) => {
  if (typeof reportDirectory !== "string" || typeof projectDirectory !== "string") return "";
  const relative = path.relative(reportDirectory, projectDirectory).replaceAll("\\", "/");
  if (relative === "") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative;
};

const collectDiagnostics = (report) => {
  const collected = [];
  for (const project of report.projects ?? []) {
    const prefix = repoRelativePrefix(report.directory, project.directory);
    for (const diagnostic of project.diagnostics ?? []) {
      const repoPath =
        prefix === null ? null : prefix ? `${prefix}/${diagnostic.filePath}` : diagnostic.filePath;
      collected.push({ ...diagnostic, repoPath });
    }
  }
  return collected;
};

const fileLink = (displayText, repoPath, line) => {
  if (!REPO_SLUG || !HEAD_SHA || !repoPath) return displayText;
  return `[${displayText}](${SERVER_URL}/${REPO_SLUG}/blob/${HEAD_SHA}/${repoPath}#L${line})`;
};

const byFileThenLine = (a, b) => {
  if (a.filePath === b.filePath) return a.line - b.line;
  return a.filePath < b.filePath ? -1 : 1;
};

// Errors always render expanded — they're what blocks CI and what a reviewer
// must act on — each naming its file:line (linked) so they're never buried.
const buildErrorsBlock = (collected) => {
  const errors = collected.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return "";
  errors.sort(byFileThenLine);
  const lines = [COPY.errorsHeading, ""];
  for (const error of errors) {
    const location = fileLink(`\`${error.filePath}:${error.line}\``, error.repoPath, error.line);
    const title = inlineText(error.title);
    const titlePart = title ? ` **${title}**` : "";
    lines.push(`- ${SEVERITY_ICON.error} ${location}${titlePart} \`${error.rule}\``);
  }
  return `${lines.join("\n")}\n\n`;
};

// Warnings collapse into a per-file list so the comment stays dense; the inline
// review comments carry the detail.
const buildWarningsBlock = (collected) => {
  const warnings = collected.filter((diagnostic) => diagnostic.severity === "warning");
  if (warnings.length === 0) return "";
  warnings.sort(byFileThenLine);
  const shown = warnings.slice(0, WARNING_LIST_LIMIT);
  const overflowCount = warnings.length - shown.length;
  const lines = [`<details><summary>${pluralize(warnings.length, "warning")}</summary>`, ""];
  let currentFile = null;
  for (const warning of shown) {
    if (warning.filePath !== currentFile) {
      if (currentFile !== null) lines.push("");
      lines.push(`**\`${warning.filePath}\`**`);
      currentFile = warning.filePath;
    }
    const location = fileLink(`L${warning.line}`, warning.repoPath, warning.line);
    const title = inlineText(warning.title);
    const titlePart = title ? ` ${title}` : "";
    lines.push(`- ${SEVERITY_ICON.warning} ${location}${titlePart} \`${warning.rule}\``);
  }
  if (overflowCount > 0) {
    lines.push("");
    lines.push(COPY.warningsMore(pluralize(overflowCount, "more warning")));
  }
  lines.push("");
  lines.push("</details>");
  return `${lines.join("\n")}\n\n`;
};

const buildSkippedChecksSection = (report) => {
  const incompleteChecks = getIncompleteCheckNames(report);
  if (incompleteChecks.length === 0) return "";
  const lines = [COPY.incompleteChecksHeading, ""];
  for (const skippedCheck of incompleteChecks) {
    const reason = (report.projects ?? [])
      .map((project) => project.skippedCheckReasons?.[skippedCheck])
      .find((value) => typeof value === "string" && value.length > 0);
    lines.push(`- \`${skippedCheck}\`${reason ? `: ${reason}` : ""}`);
  }
  return `${lines.join("\n")}\n\n`;
};

const buildErrorBody = (report) => {
  const message = report.error?.message ?? COPY.errorFallbackMessage;
  const sentryEventId = report.error?.sentryEventId;
  const bugReportUrl = buildBugReportUrl(report);
  return renderLines([
    MARKER,
    "",
    COPY.errorIntro,
    "",
    `> ${message}`,
    "",
    sentryEventId ? COPY.sentryReference(sentryEventId) : "",
    "",
    COPY.reportBugLink(bugReportUrl),
    "",
    buildReviewFooter(false),
  ]);
};

// A one-liner body (marker + message + footer) for the no-finding outcomes:
// a clean pass and a skipped no-op.
const buildSingleLineBody = (line) => renderLines([MARKER, "", line, "", buildReviewFooter(false)]);

// A pull-request scan that examined no React-eligible files and surfaced
// nothing. The changed files held no `.tsx`/`.jsx` (or framework entry) source
// React Doctor lints — `scannedFileCount` is 0 for every project (or there are
// no projects at all) — so there's nothing to report. Distinct from a clean
// scan of real React changes (`scannedFileCount >= 1`), which still earns a
// "no issues 🎉" comment. Guarded to never fire on a failed/incomplete scan,
// and only on a diff/baseline run (`report.diff` is null for `scope: full`,
// which always reports).
const isSkippedScan = (report) => {
  if (!report.ok) return false;
  if (!report.diff) return false;
  if ((report.summary?.totalDiagnosticCount ?? 0) > 0) return false;
  if (hasIncompleteChecks(report)) return false;
  return (report.projects ?? []).every((project) => project.scannedFileCount === 0);
};

// Unified body for every successful scan (baseline, diff, full). The lead line
// adapts to the mode; the error/warning lists are shared.
const buildIssuesBody = (report) => {
  const collected = collectDiagnostics(report);
  const lines = [
    MARKER,
    "",
    buildLeadLine(report),
    "",
    buildErrorsBlock(collected),
    buildWarningsBlock(collected),
    buildSkippedChecksSection(report),
    buildReviewFooter(collected.length > 0),
  ];
  return renderLines(lines);
};

const buildCommentBody = (report) => {
  if (!report.ok) return buildErrorBody(report);
  // A scan that matched no files (no changed/staged source, or nothing covered
  // by the enabled checks) is a pass, not a special case — render a plain
  // success line rather than a metrics table full of zeros.
  if ((report.projects ?? []).length === 0) return buildSingleLineBody(COPY.cleanSuccess);
  return buildIssuesBody(report);
};

const report = readReport();
if (!report) {
  console.warn(COPY.noReportWarning);
  process.exit(0);
}
const skipped = isSkippedScan(report);
const body = skipped ? buildSingleLineBody(COPY.skipped) : buildCommentBody(report);

if (commentPath) {
  fs.writeFileSync(commentPath, body.endsWith("\n") ? body : `${body}\n`);
} else {
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

// The Action reads this to suppress the sticky PR comment (it still mirrors the
// body into the job summary + commit status, which read "skipped").
appendOutput("skipped", skipped ? "true" : "false");

appendOutput(
  "score",
  typeof report.summary?.score === "number" ? String(report.summary.score) : "",
);
appendOutput("total-issues", String(report.summary?.totalDiagnosticCount ?? 0));
appendOutput("error-count", String(report.summary?.errorCount ?? 0));
appendOutput("warning-count", String(report.summary?.warningCount ?? 0));
appendOutput("affected-files", String(report.summary?.affectedFileCount ?? 0));
// Baseline runs only: how many findings the PR resolved (0 / absent otherwise).
appendOutput("fixed-issues", String(report.baseline?.fixedCount ?? 0));
