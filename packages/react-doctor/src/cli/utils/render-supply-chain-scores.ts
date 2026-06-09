import { highlighter, SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@react-doctor/core";
import type { DependencyScore } from "@react-doctor/core";
import { colorizeByScore } from "./colorize-by-score.js";

const scoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Healthy";
  if (score >= SCORE_OK_THRESHOLD) return "Review";
  return "At risk";
};

// Worst score first so the riskiest dependencies lead; unscored packages
// (unknown to Socket / lookup failed) sink to the bottom.
const byRiskThenName = (left: DependencyScore, right: DependencyScore): number => {
  if (left.overall === null) return right.overall === null ? 0 : 1;
  if (right.overall === null) return -1;
  if (left.overall !== right.overall) return left.overall - right.overall;
  return left.name.localeCompare(right.name);
};

/**
 * Renders the `--sfw` demo table: every direct dependency with its Socket.dev
 * supply-chain score (0–100), color-coded and labelled. Pure string builder —
 * the command prints the result through `cliLogger`.
 */
export const renderSupplyChainScores = (rows: ReadonlyArray<DependencyScore>): string => {
  if (rows.length === 0) {
    return highlighter.dim("  No direct dependencies found in package.json.");
  }

  const sorted = [...rows].sort(byRiskThenName);
  const nameWidth = Math.max(...sorted.map((row) => row.name.length));
  const versionWidth = Math.max(...sorted.map((row) => row.version.length));

  const lines: string[] = [
    highlighter.bold("  Socket supply-chain scores"),
    highlighter.dim(`  ${rows.length} ${rows.length === 1 ? "dependency" : "dependencies"}`),
    "",
  ];

  for (const row of sorted) {
    const paddedName = row.name.padEnd(nameWidth);
    const paddedVersion = row.version.padEnd(versionWidth);
    if (row.overall === null) {
      lines.push(
        `  ${highlighter.dim(paddedName)}  ${highlighter.dim(paddedVersion)}  ${highlighter.dim("  — no score")}`,
      );
      continue;
    }
    const score = colorizeByScore(String(row.overall).padStart(3), row.overall);
    const label = colorizeByScore(scoreLabel(row.overall), row.overall);
    lines.push(`  ${paddedName}  ${highlighter.dim(paddedVersion)}  ${score}  ${label}`);
  }

  return lines.join("\n");
};
