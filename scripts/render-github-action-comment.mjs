import fs from "node:fs";

const MARKER = "<!-- react-doctor:summary -->";
const BUG_REPORT_URL = "https://github.com/millionco/react-doctor";
const TOP_RULE_LIMIT = 5;

const [reportPath, commentPath] = process.argv.slice(2);

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

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
  const message = report.error?.message ?? "React Doctor failed before completing the scan.";
  const bodyLines = [
    "React Doctor Action failed before completing a scan.",
    "",
    "### Error",
    "",
    `\`${message}\``,
    "",
    "### Context",
    "",
    `- React Doctor version: ${report.version ?? "unknown"}`,
    `- Mode: ${report.mode ?? "unknown"}`,
    runUrl ? `- Workflow run: ${runUrl}` : null,
  ].filter(Boolean);
  const parameters = new URLSearchParams({
    title: "React Doctor Action failed",
    body: bodyLines.join("\n"),
  });
  return `${BUG_REPORT_URL}/issues/new?${parameters.toString()}`;
};

const formatScore = (summary) => {
  if (typeof summary?.score !== "number") return "Unavailable";
  const label = typeof summary.scoreLabel === "string" ? ` (${summary.scoreLabel})` : "";
  return `${summary.score} / 100${label}`;
};

const formatShortRef = (ref) =>
  typeof ref === "string" && ref.length > 0 ? ref.slice(0, 7) : "base";

// Small-font attribution footer, mirroring Cursor Bugbot's
// "Reviewed by … for commit `<sha>`." line. `<sub>` renders it below body size
// on GitHub. The commit segment is dropped when no head SHA was forwarded.
const buildReviewFooter = () => {
  const headSha = process.env.REACT_DOCTOR_HEAD_SHA?.trim();
  const commitSegment = headSha ? ` for commit \`${formatShortRef(headSha)}\`` : "";
  return `<sub>Reviewed by [React Doctor](https://react.doctor)${commitSegment}.</sub>`;
};

const formatScope = (report) => {
  if ((report.mode !== "diff" && report.mode !== "baseline") || !report.diff) return "Full project";
  const baseBranch = report.diff.baseBranch || "target branch";
  const currentBranch = report.diff.currentBranch || "current branch";
  return `${pluralize(report.diff.changedFileCount, "file")} changed on \`${currentBranch}\` vs. \`${baseBranch}\``;
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

const hasScannedProjects = (report) => (report.projects ?? []).length > 0;

const buildNoScanMessage = (report) => {
  if (report.mode === "staged") {
    return "No staged React or TypeScript source files were found, so React Doctor skipped the scan.";
  }
  if (report.mode === "diff") {
    const changedFileCount = report.diff?.changedFileCount ?? 0;
    if (changedFileCount === 0) {
      return "No changed files were found in this pull request, so React Doctor skipped the scan.";
    }
    return `React Doctor found ${pluralize(changedFileCount, "file")} changed in this pull request, but none matched the files covered by its enabled checks.`;
  }
  return "React Doctor did not find any files covered by its enabled checks.";
};

const buildStatusLine = (report) => {
  const summary = report.summary ?? {};
  const totalIssues = summary.totalDiagnosticCount ?? 0;
  if (totalIssues === 0 && hasIncompleteChecks(report)) {
    return "No React Doctor issues were found, but some checks were incomplete.";
  }
  if (totalIssues === 0) return "No React Doctor issues found in this scan.";
  return `React Doctor found ${pluralize(totalIssues, "issue")} in ${pluralize(summary.affectedFileCount ?? 0, "file")}.`;
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
    "### Top Findings",
    "",
    "| Rule | Severity | Category | Count |",
    "| --- | --- | --- | ---: |",
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
  const lines = ["### Incomplete Checks", ""];
  for (const skippedCheck of incompleteChecks) {
    const reason = (report.projects ?? [])
      .map((project) => project.skippedCheckReasons?.[skippedCheck])
      .find((value) => typeof value === "string" && value.length > 0);
    lines.push(`- \`${skippedCheck}\`${reason ? `: ${reason}` : ""}`);
  }
  return `${lines.join("\n")}\n\n`;
};

const buildNoScanBody = (report) =>
  renderLines([
    MARKER,
    "",
    buildNoScanMessage(report),
    "",
    `Scope: ${formatScope(report)}.`,
    "",
    buildReviewFooter(),
  ]);

const buildErrorBody = (report) => {
  const message = report.error?.message ?? "React Doctor failed before completing the scan.";
  const bugReportUrl = buildBugReportUrl(report);
  return renderLines([
    MARKER,
    "",
    "React Doctor could not complete this scan.",
    "",
    `> ${message}`,
    "",
    `[Report this bug](${bugReportUrl})`,
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
    newCount === 0
      ? "React Doctor reviewed your changes and found no new issues. 🎉"
      : `React Doctor reviewed your changes and found ${pluralize(newCount, "new issue")}.`;
  // Secondary context line (Bugbot's "There are N total …" slot): what the
  // change fixed and what pre-existing findings were left untouched.
  const detailParts = [];
  if (fixedCount > 0) detailParts.push(`${pluralize(fixedCount, "issue")} fixed`);
  if (baseTotalCount > 0) {
    detailParts.push(`${pluralize(baseTotalCount, "pre-existing issue")} left untouched`);
  }
  const detailLine =
    detailParts.length > 0
      ? `Compared against \`${escapeCell(formatShortRef(baseline.baseRef))}\`: ${detailParts.join(", ")}.`
      : null;

  const lines = [
    MARKER,
    "",
    leadLine,
    ...(detailLine ? ["", detailLine] : []),
    "",
    "| Score | New | Fixed | Errors | Warnings | Affected Files | Scope |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    `| ${escapeCell(formatScore(summary))} | ${newCount} | ${fixedCount} | ${summary.errorCount ?? 0} | ${summary.warningCount ?? 0} | ${summary.affectedFileCount ?? 0} | ${escapeCell(formatScope(report))} |`,
    "",
    buildTopRulesSection(report.diagnostics),
    buildSkippedChecksSection(report),
    buildReviewFooter(),
  ];
  return renderLines(lines);
};

const buildCommentBody = (report) => {
  if (!report.ok) return buildErrorBody(report);
  if (!hasScannedProjects(report)) return buildNoScanBody(report);
  if (report.schemaVersion === 2 || report.baseline) return buildBaselineBody(report);

  const summary = report.summary ?? {};
  const totalIssues = summary.totalDiagnosticCount ?? 0;

  const lines = [
    MARKER,
    "",
    buildStatusLine(report),
    "",
    "| Score | Issues | Errors | Warnings | Affected Files | Scope |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
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
  console.warn(
    "React Doctor: no scan report was found, so the summary comment was skipped. " +
      "This usually means the scan step did not run.",
  );
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
