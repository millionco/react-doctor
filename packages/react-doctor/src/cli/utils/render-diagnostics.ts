import isUnicodeSupported from "is-unicode-supported";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  groupBy,
  highlighter,
  MILLISECONDS_PER_SECOND,
  RULE_NAME_COLUMN_WIDTH_CHARS,
} from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { indentMultilineText } from "./indent-multiline-text.js";

const POINTER = isUnicodeSupported() ? "›" : ">";

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
};

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const sortByImportance = (diagnosticGroups: [string, Diagnostic[]][]): [string, Diagnostic[]][] =>
  diagnosticGroups.toSorted(([, diagnosticsA], [, diagnosticsB]) => {
    const severityDelta =
      SEVERITY_ORDER[diagnosticsA[0].severity] - SEVERITY_ORDER[diagnosticsB[0].severity];
    if (severityDelta !== 0) return severityDelta;
    return diagnosticsB.length - diagnosticsA.length;
  });

export const collectAffectedFiles = (diagnostics: Diagnostic[]): Set<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath));

interface VerboseSiteEntry {
  line: number;
  suppressionHint?: string;
}

interface CategoryDiagnosticGroup {
  category: string;
  diagnostics: Diagnostic[];
  ruleGroups: [string, Diagnostic[]][];
}

const buildVerboseSiteMap = (diagnostics: Diagnostic[]): Map<string, VerboseSiteEntry[]> => {
  const fileSites = new Map<string, VerboseSiteEntry[]>();
  for (const diagnostic of diagnostics) {
    const sites = fileSites.get(diagnostic.filePath) ?? [];
    if (diagnostic.line > 0) {
      sites.push({ line: diagnostic.line, suppressionHint: diagnostic.suppressionHint });
    }
    fileSites.set(diagnostic.filePath, sites);
  }
  return fileSites;
};

const formatSiteCountBadge = (count: number): string => (count > 1 ? `×${count}` : "");

const computeRuleNameColumnWidth = (ruleKeys: string[]): number => {
  const longestRuleNameLength = ruleKeys.reduce(
    (longest, ruleKey) => Math.max(longest, ruleKey.length),
    0,
  );
  return Math.max(RULE_NAME_COLUMN_WIDTH_CHARS, longestRuleNameLength);
};

const padRuleNameToColumn = (ruleName: string, columnWidth: number): string => {
  if (ruleName.length >= columnWidth) return ruleName;
  return ruleName + " ".repeat(columnWidth - ruleName.length);
};

const grayLine = (text: string): string => highlighter.gray(text);

const buildCompactRuleGroupLine = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): string => {
  const firstDiagnostic = ruleDiagnostics[0];
  const severitySymbol = firstDiagnostic.severity === "error" ? "✗" : "⚠";
  const icon = colorizeBySeverity(severitySymbol, firstDiagnostic.severity);
  const siteCountBadge = formatSiteCountBadge(ruleDiagnostics.length);
  const ruleNameRendering =
    siteCountBadge.length > 0
      ? colorizeBySeverity(
          padRuleNameToColumn(ruleKey, ruleNameColumnWidth),
          firstDiagnostic.severity,
        )
      : colorizeBySeverity(ruleKey, firstDiagnostic.severity);
  const trailingBadge = siteCountBadge.length > 0 ? ` ${highlighter.gray(siteCountBadge)}` : "";
  return `  ${icon} ${ruleNameRendering}${trailingBadge}`;
};

const getWorstSeverity = (diagnostics: Diagnostic[]): Diagnostic["severity"] =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "error" : "warning";

const buildCategoryDiagnosticGroups = (diagnostics: Diagnostic[]): CategoryDiagnosticGroup[] => {
  const categoryGroups = groupBy(diagnostics, (diagnostic) => diagnostic.category);
  return [...categoryGroups.entries()]
    .map(([category, categoryDiagnostics]) => {
      const ruleGroups = groupBy(
        categoryDiagnostics,
        (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
      );
      return {
        category,
        diagnostics: categoryDiagnostics,
        ruleGroups: sortByImportance([...ruleGroups.entries()]),
      };
    })
    .toSorted((categoryGroupA, categoryGroupB) => {
      const severityDelta =
        SEVERITY_ORDER[getWorstSeverity(categoryGroupA.diagnostics)] -
        SEVERITY_ORDER[getWorstSeverity(categoryGroupB.diagnostics)];
      if (severityDelta !== 0) return severityDelta;
      if (categoryGroupA.diagnostics.length !== categoryGroupB.diagnostics.length) {
        return categoryGroupB.diagnostics.length - categoryGroupA.diagnostics.length;
      }
      return categoryGroupA.category.localeCompare(categoryGroupB.category);
    });
};

const buildCompactCategoryLine = (categoryGroup: CategoryDiagnosticGroup): string => {
  const errorCount = categoryGroup.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = categoryGroup.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const parts: string[] = [];
  if (errorCount > 0)
    parts.push(highlighter.error(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`));
  if (warningCount > 0)
    parts.push(
      highlighter.warn(
        highlighter.dim(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`),
      ),
    );
  return `  ${highlighter.bold(categoryGroup.category)} ${highlighter.dim(POINTER)} ${parts.join(highlighter.dim(", "))}`;
};

const buildVerboseRuleGroupLines = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): ReadonlyArray<string> => {
  const lines: string[] = [];
  lines.push(buildCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth));
  const firstDiagnostic = ruleDiagnostics[0];
  lines.push(grayLine(indentMultilineText(firstDiagnostic.message, "      ")));
  if (firstDiagnostic.help) {
    lines.push(grayLine(indentMultilineText(`→ ${firstDiagnostic.help}`, "      ")));
  }
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    if (sites.length > 0) {
      for (const site of sites) {
        lines.push(grayLine(`      ${filePath}:${site.line}`));
        if (site.suppressionHint) {
          lines.push(grayLine(`        ↳ ${site.suppressionHint}`));
        }
      }
    } else {
      lines.push(grayLine(`      ${filePath}`));
    }
  }
  lines.push("");
  return lines;
};

const buildDefaultDiagnosticsLines = (diagnostics: Diagnostic[]): ReadonlyArray<string> => {
  const categoryGroups = buildCategoryDiagnosticGroups(diagnostics);
  const lines: string[] = [];
  for (const categoryGroup of categoryGroups) {
    lines.push(buildCompactCategoryLine(categoryGroup));
  }
  lines.push("");
  return lines;
};

/**
 * Effect-typed diagnostics renderer. Internal helpers build the
 * line array purely; the IO happens once at the boundary with a
 * single Effect.forEach over Console.log so failures or fiber
 * interruption produce predictable partial output.
 */
export const printDiagnostics = (
  diagnostics: Diagnostic[],
  isVerbose: boolean,
  rootDirectory: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    let lines: ReadonlyArray<string>;
    if (!isVerbose) {
      lines = buildDefaultDiagnosticsLines(diagnostics);
    } else {
      const ruleGroups = groupBy(
        diagnostics,
        (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
      );
      const sortedRuleGroups = sortByImportance([...ruleGroups.entries()]);
      const ruleNameColumnWidth = computeRuleNameColumnWidth(
        sortedRuleGroups.map(([ruleKey]) => ruleKey),
      );
      lines = sortedRuleGroups.flatMap(([ruleKey, ruleDiagnostics]) =>
        buildVerboseRuleGroupLines(ruleKey, ruleDiagnostics, ruleNameColumnWidth),
      );
    }
    for (const line of lines) {
      yield* Console.log(line);
    }
  });

export const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};

export const formatRuleSummary = (ruleKey: string, ruleDiagnostics: Diagnostic[]): string => {
  const firstDiagnostic = ruleDiagnostics[0];

  const sections = [
    `Rule: ${ruleKey}`,
    `Severity: ${firstDiagnostic.severity}`,
    `Category: ${firstDiagnostic.category}`,
    `Count: ${ruleDiagnostics.length}`,
    "",
    firstDiagnostic.message,
  ];

  if (firstDiagnostic.help) {
    sections.push("", `Suggestion: ${firstDiagnostic.help}`);
  }
  if (firstDiagnostic.url) {
    sections.push("", `Docs: ${firstDiagnostic.url}`);
  }

  sections.push("", "Files:");
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    if (sites.length > 0) {
      for (const site of sites) {
        sections.push(`  ${filePath}:${site.line}`);
        if (site.suppressionHint) {
          sections.push(`    ${site.suppressionHint}`);
        }
      }
    } else {
      sections.push(`  ${filePath}`);
    }
  }

  return sections.join("\n") + "\n";
};

export const sortRuleGroupsByImportance = sortByImportance;
