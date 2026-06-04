import { buildRuleDocsUrl, highlighter } from "@react-doctor/core";
import type { RuleSeverityOverride } from "@react-doctor/core";
import type { RuleCatalogEntry } from "./rule-catalog.js";
import type { EffectiveRuleSeverity } from "./resolve-effective-rule-severity.js";

const SEVERITY_COLUMN_WIDTH_CHARS = 6;

const colorizeSeverity = (severity: RuleSeverityOverride, text: string): string => {
  if (severity === "error") return highlighter.error(text);
  if (severity === "warn") return highlighter.warn(text);
  return highlighter.gray(text);
};

const formatSourceNote = (effective: EffectiveRuleSeverity): string =>
  effective.source === "default"
    ? highlighter.dim("(default)")
    : highlighter.dim(`(${effective.source})`);

export interface RenderedRuleRow {
  readonly entry: RuleCatalogEntry;
  readonly effective: EffectiveRuleSeverity;
}

export const renderRuleCatalog = (rows: ReadonlyArray<RenderedRuleRow>): string => {
  if (rows.length === 0) return highlighter.dim("No rules match the given filters.");

  const rowsByCategory = new Map<string, RenderedRuleRow[]>();
  for (const row of rows) {
    const bucket = rowsByCategory.get(row.entry.category) ?? [];
    bucket.push(row);
    rowsByCategory.set(row.entry.category, bucket);
  }

  const lines: string[] = [];
  for (const category of [...rowsByCategory.keys()].sort()) {
    const categoryRows = (rowsByCategory.get(category) ?? []).sort((leftRow, rightRow) =>
      leftRow.entry.key.localeCompare(rightRow.entry.key),
    );
    lines.push(highlighter.bold(`${category} ${highlighter.dim(`(${categoryRows.length})`)}`));
    for (const row of categoryRows) {
      const severityBadge = colorizeSeverity(
        row.effective.value,
        row.effective.value.padEnd(SEVERITY_COLUMN_WIDTH_CHARS),
      );
      const tagSuffix =
        row.entry.tags.length > 0 ? highlighter.dim(`  [${row.entry.tags.join(", ")}]`) : "";
      lines.push(
        `  ${severityBadge} ${row.entry.key} ${formatSourceNote(row.effective)}${tagSuffix}`,
      );
    }
    lines.push("");
  }
  lines.push(highlighter.dim(`${rows.length} rule${rows.length === 1 ? "" : "s"} shown.`));
  return lines.join("\n");
};

const DETAIL_LABEL_COLUMN_WIDTH_CHARS = 18;

const formatDetailRow = (label: string, value: string): string =>
  `  ${highlighter.dim(label.padEnd(DETAIL_LABEL_COLUMN_WIDTH_CHARS))}${value}`;

export const renderRuleExplanation = (row: RenderedRuleRow): string => {
  const { entry, effective } = row;
  const lines: string[] = [highlighter.bold(entry.key), ""];

  lines.push(formatDetailRow("Category", entry.category));
  lines.push(formatDetailRow("Default severity", entry.defaultSeverity));
  lines.push(
    formatDetailRow(
      "Current severity",
      `${colorizeSeverity(effective.value, effective.value)} ${formatSourceNote(effective)}`,
    ),
  );
  lines.push(formatDetailRow("Framework", entry.framework));
  lines.push(formatDetailRow("Tags", entry.tags.length > 0 ? entry.tags.join(", ") : "none"));
  lines.push(formatDetailRow("Default enabled", entry.defaultEnabled ? "yes" : "no (opt-in)"));

  lines.push("");
  lines.push(highlighter.bold("Why it matters"));
  lines.push(`  ${entry.recommendation ?? "No additional guidance recorded for this rule yet."}`);

  lines.push("");
  lines.push(highlighter.bold("Configure"));
  lines.push(highlighter.dim(`  react-doctor rules disable ${entry.key}`));
  lines.push(highlighter.dim(`  react-doctor rules enable ${entry.key} --severity error`));
  lines.push(highlighter.dim(`  react-doctor rules set ${entry.key} warn`));

  lines.push("");
  lines.push(highlighter.bold("Learn more"));
  lines.push(highlighter.dim(`  ${buildRuleDocsUrl("react-doctor", entry.id)}`));

  return lines.join("\n");
};
