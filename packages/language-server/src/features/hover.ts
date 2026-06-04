import { getRuleMetadata } from "@react-doctor/core";
import { MarkupKind, type Diagnostic as LspDiagnostic, type Hover } from "vscode-languageserver";
import type { ReactDoctorDiagnosticData } from "../types.js";
import { readDiagnosticData } from "../utils/read-diagnostic-data.js";
import { severityLabel } from "../utils/severity-label.js";

const buildSection = (diagnostic: LspDiagnostic, data: ReactDoctorDiagnosticData): string => {
  const metadata = getRuleMetadata(data.plugin, data.rule);
  const tags = metadata?.tags ?? [];
  const subtitleParts = [data.category, ...(tags.length > 0 ? [tags.join(", ")] : [])];

  const lines = [
    `**${data.ruleId}** — ${severityLabel(diagnostic.severity)}`,
    `_${subtitleParts.join(" · ")}_`,
  ];

  if (diagnostic.message) lines.push("", diagnostic.message);

  const recommendation = data.help || metadata?.recommendation || "";
  if (recommendation) lines.push("", `> ${recommendation.replace(/\n/g, "\n> ")}`);

  if (data.suppressionHint) lines.push("", `_${data.suppressionHint}_`);
  if (data.url) lines.push("", `[Rule documentation](${data.url})`);

  return lines.join("\n");
};

/**
 * Builds a rich Markdown hover for every React Doctor diagnostic under
 * the cursor: rule id, severity, category + tags, message, the rule's
 * recommendation, any suppression hint, and a docs link. Returns `null`
 * when no React Doctor diagnostic is at the position.
 */
export const buildHover = (diagnostics: ReadonlyArray<LspDiagnostic>): Hover | null => {
  const sections: string[] = [];
  for (const diagnostic of diagnostics) {
    const data = readDiagnosticData(diagnostic);
    if (data) sections.push(buildSection(diagnostic, data));
  }
  if (sections.length === 0) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value: sections.join("\n\n---\n\n") },
  };
};
