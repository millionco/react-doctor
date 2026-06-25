import { highlighter } from "@react-doctor/core";
import {
  STATS_LEADERBOARD_TOP_N,
  STATS_SCORE_BAR_WIDTH,
  STATS_SCORE_COLOR_HIGH,
  STATS_SCORE_COLOR_MEDIUM,
} from "./constants.js";
import { modelLabel } from "./model-label.js";
import type { CommunityLeaderboard, CommunityModel, GroupStats, StatsReport } from "./types.js";

const colorForScore = (score: number): ((text: string) => string) => {
  if (score >= STATS_SCORE_COLOR_HIGH) return highlighter.success;
  if (score >= STATS_SCORE_COLOR_MEDIUM) return highlighter.warn;
  return highlighter.error;
};

const colorForProvider = (provider: string): ((text: string) => string) => {
  if (provider === "cursor") return highlighter.gray;
  if (provider === "claude") return highlighter.orange;
  if (provider === "codex") return highlighter.info;
  return highlighter.dim;
};

const renderScore = (group: GroupStats): string => {
  if (group.weightedScore === null) return highlighter.dim("n/a");
  const filledCount = Math.max(
    0,
    Math.min(
      STATS_SCORE_BAR_WIDTH,
      Math.round((group.weightedScore / 100) * STATS_SCORE_BAR_WIDTH),
    ),
  );
  const paint = colorForScore(group.weightedScore);
  const bar =
    paint("█".repeat(filledCount)) +
    highlighter.dim("░".repeat(STATS_SCORE_BAR_WIDTH - filledCount));
  return `${bar} ${paint(String(group.weightedScore).padStart(3))}`;
};

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");

const renderTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[columnIndex] ?? "").length)),
  );
  const pad = (cell: string, columnIndex: number): string => {
    const visibleLength = stripAnsi(cell).length;
    return cell + " ".repeat(Math.max(0, widths[columnIndex] - visibleLength));
  };
  const headerLine = headers.map((header, index) => highlighter.dim(pad(header, index))).join("  ");
  const bodyLines = rows.map((row) => row.map((cell, index) => pad(cell, index)).join("  "));
  return [headerLine, ...bodyLines].join("\n");
};

const renderModelTable = (models: ReadonlyArray<GroupStats>): string => {
  const rows = models.map((group, index) => [
    String(index + 1),
    highlighter.bold(modelLabel(group)),
    colorForProvider(group.provider)(group.provider),
    String(group.filesScanned),
    renderScore(group),
  ]);
  return renderTable(["#", "Model", "Tool", "Files", "Score"], rows);
};

const renderProviderTable = (providers: ReadonlyArray<GroupStats>): string => {
  const rows = providers.map((group) => [
    highlighter.bold(colorForProvider(group.provider)(group.provider)),
    String(group.filesScanned),
    renderScore(group),
  ]);
  return renderTable(["Tool", "Files", "Score"], rows);
};

const renderCommunityScore = (score: number | null): string =>
  score === null ? highlighter.dim("n/a") : colorForScore(score)(String(score).padStart(3));

const renderCommunityTable = (models: ReadonlyArray<CommunityModel>): string => {
  const rows = models.map((model, index) => [
    String(index + 1),
    highlighter.bold(model.model),
    colorForProvider(model.harness)(model.harness),
    renderCommunityScore(model.communityScore),
    // Sample size beside the score so a thinly-sampled model isn't read as authoritative.
    highlighter.dim(String(model.runs)),
  ]);
  return renderTable(["#", "Model", "Tool", "Score", "Runs"], rows);
};

const calloutScore = (group: GroupStats): string =>
  group.weightedScore !== null ? ` (${group.weightedScore})` : "";

const renderCallout = (report: StatsReport): string => {
  if (!report.best) return "";
  const lines: string[] = [];
  lines.push(
    `${highlighter.success("Best")}:  ${highlighter.bold(
      modelLabel(report.best),
    )}${calloutScore(report.best)}`,
  );
  if (report.worst && report.worst.key !== report.best.key) {
    lines.push(
      `${highlighter.error("Worst")}: ${highlighter.bold(
        modelLabel(report.worst),
      )}${calloutScore(report.worst)}`,
    );
  }
  return lines.join("\n");
};

/**
 * Render the leaderboard to a string for the terminal. When a `community` board is
 * supplied (telemetry on, `/api/stats` reachable), append how these agents rank
 * across everyone for context.
 */
export const renderStatsReport = (
  report: StatsReport,
  community: CommunityLeaderboard | null = null,
): string => {
  const scopePhrase = report.scope === "global" ? "across all your projects" : "in this project";
  const header = [
    highlighter.bold("React Doctor leaderboard"),
    highlighter.dim(
      `Which agent writes the cleanest React code ${scopePhrase}. Higher is better, 0 to 100.`,
    ),
  ].join("\n");

  if (report.models.length === 0) {
    return [
      header,
      "",
      highlighter.dim(
        "Nothing to rank yet. The edits touched only non-React files, were too few, or could not be replayed.",
      ),
    ].join("\n");
  }

  const shownModels = report.models.slice(0, STATS_LEADERBOARD_TOP_N);
  const hiddenCount = report.models.length - shownModels.length;
  const sections = [header, "", renderModelTable(shownModels)];
  if (hiddenCount > 0) {
    sections.push(highlighter.dim(`+ ${hiddenCount} more (see --json for the full ranking).`));
  }
  sections.push("", highlighter.dim("By tool:"), renderProviderTable(report.providers));

  const callout = renderCallout(report);
  if (callout) {
    sections.push("", callout);
  }

  if (community && community.models.length > 0) {
    sections.push(
      "",
      highlighter.dim("Community leaderboard (all react-doctor users):"),
      renderCommunityTable(community.models.slice(0, STATS_LEADERBOARD_TOP_N)),
    );
  }

  const notes: string[] = [];
  if (report.sessionsNonReact > 0) {
    notes.push(`Skipped ${report.sessionsNonReact} that changed only non-React files.`);
  }
  if (report.sessionsUnreconstructable > 0) {
    notes.push(`Skipped ${report.sessionsUnreconstructable} that used edits we could not replay.`);
  }
  if (notes.length > 0) {
    sections.push("", ...notes.map((note) => highlighter.dim(note)));
  }

  return sections.join("\n");
};
