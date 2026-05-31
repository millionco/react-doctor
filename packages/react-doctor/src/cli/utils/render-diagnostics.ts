import path from "node:path";
import isUnicodeSupported from "is-unicode-supported";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  buildRulePromptUrl,
  groupBy,
  highlighter,
  MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE,
  MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
  MILLISECONDS_PER_SECOND,
  OUTPUT_DETAIL_WRAP_WIDTH_CHARS,
  RULE_NAME_COLUMN_WIDTH_CHARS,
} from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildHiddenDiagnosticsSummary } from "./build-hidden-diagnostics-summary.js";
import { indentMultilineText } from "./indent-multiline-text.js";
import { wrapIndentedText } from "./wrap-indented-text.js";

const POINTER = isUnicodeSupported() ? "›" : ">";

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
};

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const getDiagnosticTriage = (diagnostic: Diagnostic) => {
  if (diagnostic.plugin !== "react-doctor") return null;
  return reactDoctorPlugin.rules[diagnostic.rule]?.triage ?? null;
};

// Build a `<plugin>/<rule>` -> priority lookup from the score API's per-rule
// payload (merged across scans). Rules the API didn't rank — or every rule when
// the score is unavailable — are simply absent and fall back to severity order.
export const buildRulePriorityMap = (
  scores: ReadonlyArray<ScoreResult | null>,
): ReadonlyMap<string, number> => {
  const rulePriority = new Map<string, number>();
  for (const score of scores) {
    if (!score?.rules) continue;
    for (const [ruleKey, info] of Object.entries(score.rules)) {
      if (typeof info.priority === "number") rulePriority.set(ruleKey, info.priority);
    }
  }
  return rulePriority;
};

// Effective sort weight for a rule group: its API-returned priority, or a
// severity-based midpoint when the rule isn't ranked (or the score is offline).
// With no priorities at all this degrades to the previous error-before-warning
// ordering (error 55 sorts ahead of warning 35).
const effectivePriority = (
  ruleKey: string,
  diagnostics: Diagnostic[],
  rulePriority: ReadonlyMap<string, number> | undefined,
): number => {
  const known = rulePriority?.get(ruleKey);
  if (known !== undefined) return known;
  return diagnostics[0].severity === "error" ? 55 : 35;
};

const sortByImportance = (
  diagnosticGroups: [string, Diagnostic[]][],
  rulePriority?: ReadonlyMap<string, number>,
): [string, Diagnostic[]][] =>
  diagnosticGroups.toSorted(([ruleKeyA, diagnosticsA], [ruleKeyB, diagnosticsB]) => {
    const priorityDelta =
      effectivePriority(ruleKeyB, diagnosticsB, rulePriority) -
      effectivePriority(ruleKeyA, diagnosticsA, rulePriority);
    if (priorityDelta !== 0) return priorityDelta;
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

// Directive (not a bare label) so the consuming agent treats the URL as
// a step to perform — fetch the canonical, reviewer-tested recipe and
// apply it — rather than as optional reference docs it can skip.
const FETCH_FIX_RECIPE_LABEL = "Fetch & follow the canonical fix recipe before fixing";

export const formatFixRecipeLine = (diagnostic: Diagnostic): string =>
  `${FETCH_FIX_RECIPE_LABEL}: ${buildRulePromptUrl(diagnostic.plugin, diagnostic.rule)}`;

const formatOptOutLine = (diagnostic: Diagnostic): string =>
  `Config opt-out: { "rules": { "${diagnostic.plugin}/${diagnostic.rule}": "off" } }`;

const formatAbsoluteFilePath = (filePath: string, rootDirectory: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(rootDirectory, filePath);

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

// A category leads with its most valuable rule. `ruleGroups` are already
// priority-sorted, so the first one is the category's top.
const categoryTopPriority = (
  categoryGroup: CategoryDiagnosticGroup,
  rulePriority: ReadonlyMap<string, number> | undefined,
): number => {
  const [topRuleKey, topDiagnostics] = categoryGroup.ruleGroups[0];
  return effectivePriority(topRuleKey, topDiagnostics, rulePriority);
};

const buildCategoryDiagnosticGroups = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): CategoryDiagnosticGroup[] => {
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
        ruleGroups: sortByImportance([...ruleGroups.entries()], rulePriority),
      };
    })
    .toSorted((categoryGroupA, categoryGroupB) => {
      const priorityDelta =
        categoryTopPriority(categoryGroupB, rulePriority) -
        categoryTopPriority(categoryGroupA, rulePriority);
      if (priorityDelta !== 0) return priorityDelta;
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
  rootDirectory: string,
): ReadonlyArray<string> => {
  const lines: string[] = [];
  lines.push(buildCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth));
  const firstDiagnostic = ruleDiagnostics[0];
  const triage = getDiagnosticTriage(firstDiagnostic);
  lines.push(grayLine(indentMultilineText(firstDiagnostic.message, "      ")));
  if (firstDiagnostic.help) {
    lines.push(grayLine(indentMultilineText(`→ ${firstDiagnostic.help}`, "      ")));
  }
  if (triage?.why) {
    lines.push(grayLine(indentMultilineText(`Why: ${triage.why}`, "      ")));
  }
  if (triage?.impact) {
    lines.push(grayLine(indentMultilineText(`Impact: ${triage.impact}`, "      ")));
  }
  if (triage?.confidence || triage?.effort) {
    const confidence = triage.confidence ?? "medium";
    const effort = triage.effort ?? "medium";
    lines.push(grayLine(`      Confidence: ${confidence}; effort: ${effort}`));
  }
  lines.push(grayLine(`      ${formatFixRecipeLine(firstDiagnostic)}`));
  lines.push(grayLine(`      ${formatOptOutLine(firstDiagnostic)}`));
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    const displayFilePath = formatAbsoluteFilePath(filePath, rootDirectory);
    if (sites.length > 0) {
      for (const site of sites) {
        lines.push(grayLine(`      ${displayFilePath}:${site.line}`));
        if (site.suppressionHint) {
          lines.push(grayLine(`        ↳ ${site.suppressionHint}`));
        }
      }
    } else {
      lines.push(grayLine(`      ${displayFilePath}`));
    }
  }
  lines.push("");
  return lines;
};

const buildDefaultDiagnosticsLines = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): ReadonlyArray<string> => {
  const categoryGroups = buildCategoryDiagnosticGroups(diagnostics, rulePriority);
  const visibleCategoryGroups = categoryGroups.slice(0, MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE);
  const hiddenDiagnostics = categoryGroups
    .slice(MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE)
    .flatMap((categoryGroup) => categoryGroup.diagnostics);
  const lines: string[] = [];
  for (const categoryGroup of visibleCategoryGroups) {
    lines.push(buildCompactCategoryLine(categoryGroup));
    const visibleRuleGroups = categoryGroup.ruleGroups.slice(
      0,
      MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
    );
    const hiddenRuleGroups = categoryGroup.ruleGroups.slice(
      MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
    );
    hiddenDiagnostics.push(...hiddenRuleGroups.flatMap(([, ruleDiagnostics]) => ruleDiagnostics));
    const ruleNameColumnWidth = computeRuleNameColumnWidth(
      visibleRuleGroups.map(([ruleKey]) => ruleKey),
    );
    for (const [ruleKey, ruleDiagnostics] of visibleRuleGroups) {
      lines.push(buildCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth));
    }
  }
  const hiddenSummary = buildHiddenDiagnosticsSummary(hiddenDiagnostics);
  if (hiddenSummary.length > 0) {
    const hiddenParts = hiddenSummary.map((part) => colorizeBySeverity(part.text, part.severity));
    lines.push(`  ${hiddenParts.join(highlighter.dim(", "))}`);
  }
  lines.push(
    grayLine(
      wrapIndentedText(
        "Showing the highest-signal findings first. Run with --verbose for every file, or --staged to focus on the next commit.",
        "  ",
        OUTPUT_DETAIL_WRAP_WIDTH_CHARS,
      ),
    ),
  );
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
  rulePriority?: ReadonlyMap<string, number>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    let lines: ReadonlyArray<string>;
    if (!isVerbose) {
      lines = buildDefaultDiagnosticsLines(diagnostics, rulePriority);
    } else {
      const ruleGroups = groupBy(
        diagnostics,
        (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
      );
      const sortedRuleGroups = sortByImportance([...ruleGroups.entries()], rulePriority);
      const ruleNameColumnWidth = computeRuleNameColumnWidth(
        sortedRuleGroups.map(([ruleKey]) => ruleKey),
      );
      lines = sortedRuleGroups.flatMap(([ruleKey, ruleDiagnostics]) =>
        buildVerboseRuleGroupLines(ruleKey, ruleDiagnostics, ruleNameColumnWidth, rootDirectory),
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
  const triage = getDiagnosticTriage(firstDiagnostic);

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
  if (triage?.why) {
    sections.push("", `Why: ${triage.why}`);
  }
  if (triage?.impact) {
    sections.push("", `Impact: ${triage.impact}`);
  }
  if (triage?.confidence || triage?.effort) {
    sections.push(
      "",
      `Confidence: ${triage.confidence ?? "medium"}`,
      `Effort: ${triage.effort ?? "medium"}`,
    );
  }
  if (firstDiagnostic.url) {
    sections.push("", `Docs: ${firstDiagnostic.url}`);
  }
  sections.push("", formatFixRecipeLine(firstDiagnostic), formatOptOutLine(firstDiagnostic));

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
