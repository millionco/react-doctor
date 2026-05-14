import {
  MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE,
  MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
  MILLISECONDS_PER_SECOND,
  OUTPUT_DETAIL_WRAP_WIDTH_CHARS,
  RULE_NAME_COLUMN_WIDTH_CHARS,
} from "../constants.js";
import type { Diagnostic } from "../types/diagnostic.js";
import { buildHiddenDiagnosticsSummary } from "./build-hidden-diagnostics-summary.js";
import { groupBy } from "../core/group-by.js";
import { highlighter } from "../core/highlighter.js";
import { indentMultilineText } from "./indent-multiline-text.js";
import { logger } from "../core/logger.js";
import { toRelativePath } from "../core/to-relative-path.js";
import { wrapIndentedText } from "./wrap-indented-text.js";

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

const formatIssueCount = (count: number): string => `${count} ${count === 1 ? "issue" : "issues"}`;

const toRuleTitle = (ruleName: string): string => {
  const readableRuleName = ruleName
    .replace(/^(no|prefer|require|use)-/, "")
    .replace(/^(nextjs|tanstack-start)-/, "")
    .replaceAll("-", " ");
  const title = readableRuleName.charAt(0).toUpperCase() + readableRuleName.slice(1);
  return title.replace(/\b(css|html|url|svg|jsx|api|ua)\b/gi, (match) => match.toUpperCase());
};

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

const grayLine = (text: string): void => {
  logger.log(highlighter.gray(text));
};

const grayWrappedLine = (text: string, linePrefix: string): void => {
  grayLine(wrapIndentedText(text, linePrefix, OUTPUT_DETAIL_WRAP_WIDTH_CHARS));
};

const printCompactRuleGroupLine = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): void => {
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
  logger.log(`  ${icon} ${ruleNameRendering}${trailingBadge}`);
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

const printDefaultRuleGroup = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  rootDirectory: string,
): void => {
  const firstDiagnostic = ruleDiagnostics[0];
  const ruleTitle = toRuleTitle(firstDiagnostic.rule);
  const severitySymbol = firstDiagnostic.severity === "error" ? "✗" : "⚠";
  const icon = colorizeBySeverity(severitySymbol, firstDiagnostic.severity);
  const siteCountBadge = formatSiteCountBadge(ruleDiagnostics.length);
  const trailingBadge = siteCountBadge.length > 0 ? ` ${highlighter.gray(siteCountBadge)}` : "";

  logger.log(`  ${icon} ${ruleTitle}${trailingBadge}`);
  grayWrappedLine(firstDiagnostic.message, "    ");
  if (firstDiagnostic.help) {
    grayWrappedLine(firstDiagnostic.help, "    ");
  }
  if (firstDiagnostic.url) {
    grayLine(`    ${firstDiagnostic.url}`);
  }
  const firstLocation = ruleDiagnostics.find((diagnostic) => diagnostic.line > 0);
  if (firstLocation) {
    const locationPath = toRelativePath(firstLocation.filePath, rootDirectory);
    grayLine(`    ${locationPath}:${firstLocation.line}`);
  }
};

const printDefaultCategoryGroup = (
  categoryGroup: CategoryDiagnosticGroup,
  visibleRuleGroups: [string, Diagnostic[]][],
  rootDirectory: string,
): void => {
  const issueCount = formatIssueCount(categoryGroup.diagnostics.length);
  logger.log(`${highlighter.bold(categoryGroup.category)} ${highlighter.dim(issueCount)}`);
  for (const [ruleKey, ruleDiagnostics] of visibleRuleGroups) {
    printDefaultRuleGroup(ruleKey, ruleDiagnostics, rootDirectory);
  }
  logger.break();
};

const printVerboseRuleGroup = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
): void => {
  printCompactRuleGroupLine(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
  const firstDiagnostic = ruleDiagnostics[0];
  grayLine(indentMultilineText(firstDiagnostic.message, "      "));
  if (firstDiagnostic.help) {
    grayLine(indentMultilineText(`→ ${firstDiagnostic.help}`, "      "));
  }
  const fileSites = buildVerboseSiteMap(ruleDiagnostics);
  for (const [filePath, sites] of fileSites) {
    if (sites.length > 0) {
      for (const site of sites) {
        grayLine(`      ${filePath}:${site.line}`);
        if (site.suppressionHint) {
          grayLine(`        ↳ ${site.suppressionHint}`);
        }
      }
    } else {
      grayLine(`      ${filePath}`);
    }
  }
  logger.break();
};

const printHiddenDiagnosticsSummary = (hiddenRuleGroups: [string, Diagnostic[]][]): void => {
  const hiddenDiagnostics = hiddenRuleGroups.flatMap(([, ruleDiagnostics]) => ruleDiagnostics);
  const renderedParts = buildHiddenDiagnosticsSummary(hiddenDiagnostics).map((part) => {
    const [icon, ...labelParts] = part.text.split(" ");
    return `${colorizeBySeverity(icon, part.severity)} ${highlighter.dim(labelParts.join(" "))}`;
  });

  logger.log(`  ${renderedParts.join("  ")}`);
  grayLine("    Run `npx react-doctor@latest . --verbose` to get all details");
  logger.break();
};

const printDefaultDiagnostics = (diagnostics: Diagnostic[], rootDirectory: string): void => {
  const categoryGroups = buildCategoryDiagnosticGroups(diagnostics);
  const hiddenRuleGroups: [string, Diagnostic[]][] = [];
  const visibleCategoryGroups = categoryGroups.slice(0, MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE);
  const hiddenCategoryGroups = categoryGroups.slice(MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE);

  for (const categoryGroup of visibleCategoryGroups) {
    const visibleRuleGroups = categoryGroup.ruleGroups.slice(
      0,
      MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
    );
    const remainingRuleGroups = categoryGroup.ruleGroups.slice(
      MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE,
    );
    printDefaultCategoryGroup(categoryGroup, visibleRuleGroups, rootDirectory);
    hiddenRuleGroups.push(...remainingRuleGroups);
  }
  hiddenRuleGroups.push(
    ...hiddenCategoryGroups.flatMap((categoryGroup) => categoryGroup.ruleGroups),
  );

  if (hiddenRuleGroups.length > 0) {
    printHiddenDiagnosticsSummary(hiddenRuleGroups);
  }
};

export const printDiagnostics = (
  diagnostics: Diagnostic[],
  isVerbose: boolean,
  rootDirectory: string,
): void => {
  if (!isVerbose) {
    printDefaultDiagnostics(diagnostics, rootDirectory);
    return;
  }

  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );
  const sortedRuleGroups = sortByImportance([...ruleGroups.entries()]);
  const visibleRuleGroups = sortedRuleGroups;

  const ruleNameColumnWidth = computeRuleNameColumnWidth(
    visibleRuleGroups.map(([ruleKey]) => ruleKey),
  );

  visibleRuleGroups.forEach(([ruleKey, ruleDiagnostics]) => {
    printVerboseRuleGroup(ruleKey, ruleDiagnostics, ruleNameColumnWidth);
  });
};

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
