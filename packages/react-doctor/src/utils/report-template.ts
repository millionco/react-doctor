import type { Diagnostic, ReportPayload } from "../types.js";

const PERFECT_SCORE = 100;
const SCORE_GOOD_THRESHOLD = 75;
const SCORE_OK_THRESHOLD = 50;

const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

const getScoreColor = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "#22c55e";
  if (score >= SCORE_OK_THRESHOLD) return "#eab308";
  return "#ef4444";
};

const getDoctorFace = (score: number): [string, string] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["\u25E0 \u25E0", " \u25BD "];
  if (score >= SCORE_OK_THRESHOLD) return ["\u2022 \u2022", " \u2500 "];
  return ["x x", " \u25BD "];
};

const groupByRule = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.plugin}/${diagnostic.rule}`;
    const existing = groups.get(key) ?? [];
    existing.push(diagnostic);
    groups.set(key, existing);
  }
  return groups;
};

const sortBySeverity = (entries: [string, Diagnostic[]][]): [string, Diagnostic[]][] => {
  const order = { error: 0, warning: 1 };
  return entries.toSorted(
    ([, diagnosticsA], [, diagnosticsB]) =>
      order[diagnosticsA[0].severity] - order[diagnosticsB[0].severity],
  );
};

const buildFileLineMap = (diagnostics: Diagnostic[]): Map<string, number[]> => {
  const fileLines = new Map<string, number[]>();
  for (const diagnostic of diagnostics) {
    const lines = fileLines.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) {
      lines.push(diagnostic.line);
    }
    fileLines.set(diagnostic.filePath, lines);
  }
  return fileLines;
};

export const buildReportHtml = (payload: ReportPayload): string => {
  const { diagnostics, score, label, projectName } = payload;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;

  const ruleGroups = groupByRule(diagnostics);
  const sortedRuleGroups = sortBySeverity([...ruleGroups.entries()]);

  const scoreBarPercent = score !== null ? Math.round((score / PERFECT_SCORE) * 100) : 0;
  const scoreColor = score !== null ? getScoreColor(score) : "#6b7280";
  const displayLabel = label ?? (score !== null ? getScoreLabel(score) : null);
  const [eyes, mouth] = score !== null ? getDoctorFace(score) : ["? ?", " ? "];

  const summaryParts: string[] = [];
  if (errorCount > 0) {
    summaryParts.push(
      `<span class="summary-error">\u2717 ${errorCount} error${errorCount === 1 ? "" : "s"}</span>`,
    );
  }
  if (warningCount > 0) {
    summaryParts.push(
      `<span class="summary-warning">\u26A0 ${warningCount} warning${warningCount === 1 ? "" : "s"}</span>`,
    );
  }
  summaryParts.push(
    `<span class="summary-muted">across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}</span>`,
  );

  let diagnosticsSections = "";
  for (const [ruleKey, ruleDiagnostics] of sortedRuleGroups) {
    const firstDiagnostic = ruleDiagnostics[0];
    const severityClass =
      firstDiagnostic.severity === "error" ? "severity-error" : "severity-warning";
    const severitySymbol = firstDiagnostic.severity === "error" ? "\u2717" : "\u26A0";
    const countLabel = ruleDiagnostics.length > 1 ? ` (${ruleDiagnostics.length})` : "";
    const fileLines = buildFileLineMap(ruleDiagnostics);

    let locationsHtml = "";
    for (const [filePath, lines] of fileLines) {
      const lineLabel = lines.length > 0 ? `:${lines.join(", ")}` : "";
      locationsHtml += `<li><code>${escapeHtml(filePath)}${escapeHtml(lineLabel)}</code></li>`;
    }

    const helpHtml = firstDiagnostic.help
      ? `<p class="diagnostic-help">${escapeHtml(firstDiagnostic.help)}</p>`
      : "";

    diagnosticsSections += `
<section class="diagnostic-group" aria-labelledby="rule-${escapeHtml(ruleKey.replace(/\//g, "--"))}">
  <h2 id="rule-${escapeHtml(ruleKey.replace(/\//g, "--"))}" class="diagnostic-heading ${severityClass}">
    <span class="severity-icon" aria-hidden="true">${severitySymbol}</span>
    ${escapeHtml(firstDiagnostic.message)}${escapeHtml(countLabel)}
  </h2>
  <p class="diagnostic-rule"><code>${escapeHtml(ruleKey)}</code></p>
  ${helpHtml}
  <ul class="diagnostic-locations">${locationsHtml}</ul>
</section>`;
  }

  const scoreSection =
    score !== null
      ? `
  <div class="score-section">
    <pre class="doctor-face" aria-hidden="true">  \u250C\u2500\u2500\u2500\u2500\u2500\u2510
  \u2502 ${eyes} \u2502
  \u2502 ${mouth} \u2502
  \u2514\u2500\u2500\u2500\u2500\u2500\u2518</pre>
    <div class="score-gauge">
      <span class="score-value">${score}</span> / ${PERFECT_SCORE}
      <span class="score-label">${escapeHtml(displayLabel ?? "")}</span>
    </div>
    <div class="score-bar-track">
      <div class="score-bar-fill" style="width: ${scoreBarPercent}%; background-color: ${scoreColor};"></div>
    </div>
  </div>`
      : `
  <div class="score-section score-unavailable">
    <p>Score unavailable (offline or error).</p>
  </div>`;

  const projectTitle = projectName
    ? `${escapeHtml(projectName)} \u2014 React Doctor`
    : "React Doctor";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${projectTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; color: #e5e7eb; background: #111827; margin: 0; padding: 1.5rem; max-width: 56rem; margin-left: auto; margin-right: auto; }
    header { margin-bottom: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem 0; }
    .subtitle { font-size: 0.875rem; color: #9ca3af; margin-bottom: 1.5rem; }
    .summary { font-size: 0.875rem; margin-bottom: 1.5rem; }
    .summary-error { color: #f87171; }
    .summary-warning { color: #fbbf24; }
    .summary-muted { color: #9ca3af; }
    .score-section { margin-bottom: 2rem; }
    .score-unavailable p { color: #9ca3af; margin: 0; }
    .doctor-face { font-size: 1rem; margin: 0 0 0.5rem 0; line-height: 1.2; }
    .score-gauge { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .score-value { font-weight: 700; }
    .score-label { margin-left: 0.5rem; }
    .score-bar-track { height: 0.5rem; background: #374151; border-radius: 0.25rem; overflow: hidden; }
    .score-bar-fill { height: 100%; border-radius: 0.25rem; }
    main h2 { font-size: 1rem; margin: 0 0 0.25rem 0; }
    .diagnostic-group { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #374151; }
    .diagnostic-group:last-child { border-bottom: none; }
    .diagnostic-heading { display: flex; align-items: baseline; gap: 0.5rem; }
    .severity-error { color: #f87171; }
    .severity-warning { color: #fbbf24; }
    .severity-icon { flex-shrink: 0; }
    .diagnostic-rule { font-size: 0.8125rem; color: #9ca3af; margin: 0 0 0.25rem 0; }
    .diagnostic-help { font-size: 0.875rem; color: #d1d5db; margin: 0.25rem 0; }
    .diagnostic-locations { font-size: 0.8125rem; color: #9ca3af; margin: 0.25rem 0; padding-left: 1.25rem; }
    .diagnostic-locations code { word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <h1>React Doctor</h1>
    <p class="subtitle">www.react.doctor</p>
    ${scoreSection}
    <p class="summary">${summaryParts.join("  ")}</p>
  </header>
  <main>
    <h2 id="diagnostics-heading">Diagnostics</h2>
    ${diagnosticsSections}
  </main>
</body>
</html>`;
};
