import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../constants.js";
import type { Diagnostic, ScoreResult } from "../types.js";

interface ScoreTier {
  min: number;
  emoji: string;
}

const SCORE_TIERS = [
  { min: SCORE_GOOD_THRESHOLD, emoji: "🟢" },
  { min: SCORE_OK_THRESHOLD, emoji: "🟡" },
  { min: 0, emoji: "🔴" },
] as const satisfies readonly ScoreTier[];

const DEFAULT_SCORE_EMOJI = "⚪";

const SEVERITY_EMOJI: Record<Diagnostic["severity"], string> = {
  error: "🚨",
  warning: "⚠️",
};

const getScoreEmoji = (score: number | null): string => {
  if (score === null) return DEFAULT_SCORE_EMOJI;
  return SCORE_TIERS.find((tier) => score >= tier.min)?.emoji ?? DEFAULT_SCORE_EMOJI;
};

const pluralize = (count: number, singular: string): string =>
  count === 1 ? singular : `${singular}s`;

const buildCountsLine = (diagnostics: Diagnostic[]): string => {
  const counts: Record<Diagnostic["severity"], number> = { error: 0, warning: 0 };
  for (const d of diagnostics) counts[d.severity]++;

  const parts = (Object.entries(counts) as [Diagnostic["severity"], number][])
    .filter(([, count]) => count > 0)
    .map(
      ([severity, count]) =>
        `${SEVERITY_EMOJI[severity]} <strong>${count}</strong> ${pluralize(count, severity)}`,
    );

  return parts.length > 0 ? parts.join(" · ") : "✅ No issues found.";
};

const buildIssueRow = (diagnostic: Diagnostic): string => {
  const emoji = SEVERITY_EMOJI[diagnostic.severity];
  const rule = `<code>${diagnostic.plugin}/${diagnostic.rule}</code>`;
  const location = `<code>${diagnostic.filePath}:${diagnostic.line}</code>`;
  return `    <tr><td>${emoji}</td><td>${rule}</td><td>${diagnostic.message}</td><td>${location}</td></tr>`;
};

const buildIssueTable = (diagnostics: Diagnostic[]): string => {
  if (diagnostics.length === 0) return "<p><em>No issues found.</em> ✨</p>";

  const rows = diagnostics.map(buildIssueRow).join("\n");
  return `<table>
  <thead>
    <tr>
      <th></th>
      <th>Rule</th>
      <th>Message</th>
      <th>Location</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
};

export const buildNoBrandingReport = (
  diagnostics: Diagnostic[],
  scoreResult: ScoreResult | null,
): string => {
  const score = scoreResult?.score ?? null;
  const label = scoreResult?.label ?? "";
  const scoreEmoji = getScoreEmoji(score);
  const scoreDisplay = score !== null ? String(score) : "N/A";

  return [
    `<h3>${scoreEmoji} Score: ${scoreDisplay} / 100 — ${label}</h3>`,
    "",
    `<p>${buildCountsLine(diagnostics)}</p>`,
    "",
    "<details>",
    "<summary>📋 View details</summary>",
    "",
    buildIssueTable(diagnostics),
    "",
    "</details>",
  ].join("\n");
};
