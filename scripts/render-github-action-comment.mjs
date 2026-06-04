import fs from "node:fs";

const MARKER = "<!-- react-doctor:summary -->";
const BUG_REPORT_URL = "https://github.com/millionco/react-doctor";
const BRAND_LINK = "https://react.doctor";
const TOP_RULE_LIMIT = 5;

const [reportPath, commentPath] = process.argv.slice(2);

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

/**
 * Every user-facing string the PR comment can render, in one place. Static
 * strings are plain values; lines with interpolation are functions. Edit copy
 * here — the `build*` renderers below only assemble layout, never literal text.
 */
const COPY = {
  // Attribution footer (Cursor Bugbot-style, small font via <sub>).
  reviewFooter: (commitSegment) =>
    `<sub>Reviewed by [React Doctor](${BRAND_LINK})${commitSegment}.</sub>`,
  reviewFooterCommit: (shortSha) => ` for commit \`${shortSha}\``,

  // Baseline (PR-introduced-issues-only) body.
  baselineLeadClean: "React Doctor reviewed your changes and found no new issues. 🎉",
  baselineLead: (newIssues) => `React Doctor reviewed your changes and found ${newIssues}.`,
  baselineFixedPart: (issues) => `${issues} fixed`,
  baselineUntouchedPart: (preExistingIssues) => `${preExistingIssues} left untouched`,
  baselineDetail: (shortRef, parts) => `Compared against \`${shortRef}\`: ${parts}.`,

  // Clean success — shown when nothing was scanned (no matching source files),
  // which is a pass, not a finding. Rendered as a single line with no table.
  cleanSuccess: "No React Doctor issues found. 🎉",

  // Full / diff summary status line.
  statusIncompleteNoIssues: "No React Doctor issues were found, but some checks were incomplete.",
  statusNoIssues: "No React Doctor issues found in this scan.",
  status: (issues, files) => `React Doctor found ${issues} in ${files}.`,

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

  // Section headings + table headers.
  topFindingsHeading: "### Top Findings",
  topFindingsTableHeader: "| Rule | Severity | Category | Count |",
  topFindingsTableDivider: "| --- | --- | --- | ---: |",
  incompleteChecksHeading: "### Incomplete Checks",
  baselineTableHeader: "| Score | New | Fixed | Errors | Warnings | Affected Files | Scope |",
  baselineTableDivider: "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  summaryTableHeader: "| Score | Issues | Errors | Warnings | Affected Files | Scope |",
  summaryTableDivider: "| --- | ---: | ---: | ---: | ---: | --- |",

  // Score + scope formatting.
  scoreUnavailable: "Unavailable",
  score: (score, label) => `${score} / 100${label}`,
  scoreLabel: (label) => ` (${label})`,
  scopeFullProject: "Full project",
  scopeChanged: (files, currentBranch, baseBranch) =>
    `${files} changed on \`${currentBranch}\` vs. \`${baseBranch}\``,

  // Stderr warning when no report exists.
  noReportWarning:
    "React Doctor: no scan report was found, so the summary comment was skipped. " +
    "This usually means the scan step did not run.",
};

const escapeCell = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

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

// Small-font attribution footer, mirroring Cursor Bugbot's
// "Reviewed by … for commit `<sha>`." line. `<sub>` renders it below body size
// on GitHub. The commit segment is dropped when no head SHA was forwarded.
const buildReviewFooter = () => {
  const headSha = process.env.REACT_DOCTOR_HEAD_SHA?.trim();
  const commitSegment = headSha ? COPY.reviewFooterCommit(formatShortRef(headSha)) : "";
  return COPY.reviewFooter(commitSegment);
};

const formatScope = (report) => {
  if ((report.mode !== "diff" && report.mode !== "baseline") || !report.diff) {
    return COPY.scopeFullProject;
  }
  const baseBranch = report.diff.baseBranch || "target branch";
  const currentBranch = report.diff.currentBranch || "current branch";
  return COPY.scopeChanged(
    pluralize(report.diff.changedFileCount, "file"),
    currentBranch,
    baseBranch,
  );
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

const buildStatusLine = (report) => {
  const summary = report.summary ?? {};
  const totalIssues = summary.totalDiagnosticCount ?? 0;
  if (totalIssues === 0 && hasIncompleteChecks(report)) return COPY.statusIncompleteNoIssues;
  if (totalIssues === 0) return COPY.statusNoIssues;
  return COPY.status(
    pluralize(totalIssues, "issue"),
    pluralize(summary.affectedFileCount ?? 0, "file"),
  );
};

const groupDiagnosticsByRule = (diagnostics) => {
  const groups = new Map();
  for (const diagnostic of diagnostics ?? []) {
    const key = `${diagnostic.plugin}/${diagnostic.rule}`;
    const group = groups.get(key) ?? {
      key,
      severity: diagnostic.severity,
      category: diagnostic.category,
      count: 0,
    };
    group.count += 1;
    if (diagnostic.severity === "error") group.severity = "error";
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    const severityDelta = (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1);
    if (severityDelta !== 0) return severityDelta;
    return b.count - a.count;
  });
};

const buildTopRulesSection = (diagnostics) => {
  const groups = groupDiagnosticsByRule(diagnostics).slice(0, TOP_RULE_LIMIT);
  if (groups.length === 0) return "";
  const lines = [
    COPY.topFindingsHeading,
    "",
    COPY.topFindingsTableHeader,
    COPY.topFindingsTableDivider,
  ];
  for (const group of groups) {
    lines.push(
      `| \`${escapeCell(group.key)}\` | ${escapeCell(group.severity)} | ${escapeCell(group.category)} | ${group.count} |`,
    );
  }
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
    buildReviewFooter(),
  ]);
};

// Codecov-style delta comment for a baseline (PR-introduced-issues-only) run.
// `report.diagnostics` / `summary` counts are the introduced findings; the
// `baseline` block carries the fixed + base totals; `score` stays head's.
const buildBaselineBody = (report) => {
  const summary = report.summary ?? {};
  const baseline = report.baseline ?? {};
  const newCount = baseline.newCount ?? summary.totalDiagnosticCount ?? 0;
  const fixedCount = baseline.fixedCount ?? 0;
  const baseTotalCount = baseline.baseTotalCount ?? 0;
  // Lead sentence mirrors Cursor Bugbot's "… reviewed your changes and found N …".
  const leadLine =
    newCount === 0 ? COPY.baselineLeadClean : COPY.baselineLead(pluralize(newCount, "new issue"));
  // Secondary context line (Bugbot's "There are N total …" slot): what the
  // change fixed and what pre-existing findings were left untouched.
  const detailParts = [];
  if (fixedCount > 0) detailParts.push(COPY.baselineFixedPart(pluralize(fixedCount, "issue")));
  if (baseTotalCount > 0) {
    detailParts.push(COPY.baselineUntouchedPart(pluralize(baseTotalCount, "pre-existing issue")));
  }
  const detailLine =
    detailParts.length > 0
      ? COPY.baselineDetail(escapeCell(formatShortRef(baseline.baseRef)), detailParts.join(", "))
      : null;

  const lines = [
    MARKER,
    "",
    leadLine,
    ...(detailLine ? ["", detailLine] : []),
    "",
    COPY.baselineTableHeader,
    COPY.baselineTableDivider,
    `| ${escapeCell(formatScore(summary))} | ${newCount} | ${fixedCount} | ${summary.errorCount ?? 0} | ${summary.warningCount ?? 0} | ${summary.affectedFileCount ?? 0} | ${escapeCell(formatScope(report))} |`,
    "",
    buildTopRulesSection(report.diagnostics),
    buildSkippedChecksSection(report),
    buildReviewFooter(),
  ];
  return renderLines(lines);
};

const buildCleanSuccessBody = () =>
  renderLines([MARKER, "", COPY.cleanSuccess, "", buildReviewFooter()]);

const buildCommentBody = (report) => {
  if (!report.ok) return buildErrorBody(report);
  // A scan that matched no files (no changed/staged source, or nothing covered
  // by the enabled checks) is a pass, not a special case — render a plain
  // success line rather than a metrics table full of zeros / an "Unavailable"
  // score for a scan that never ran.
  if ((report.projects ?? []).length === 0) return buildCleanSuccessBody();
  if (report.schemaVersion === 2 || report.baseline) return buildBaselineBody(report);

  const summary = report.summary ?? {};
  const totalIssues = summary.totalDiagnosticCount ?? 0;

  const lines = [
    MARKER,
    "",
    buildStatusLine(report),
    "",
    COPY.summaryTableHeader,
    COPY.summaryTableDivider,
    `| ${escapeCell(formatScore(summary))} | ${totalIssues} | ${summary.errorCount ?? 0} | ${summary.warningCount ?? 0} | ${summary.affectedFileCount ?? 0} | ${escapeCell(formatScope(report))} |`,
    "",
    buildTopRulesSection(report.diagnostics),
    buildSkippedChecksSection(report),
    buildReviewFooter(),
  ];

  return renderLines(lines);
};

const report = readReport();
if (!report) {
  console.warn(COPY.noReportWarning);
  process.exit(0);
}
const body = buildCommentBody(report);

if (commentPath) {
  fs.writeFileSync(commentPath, body.endsWith("\n") ? body : `${body}\n`);
} else {
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

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
