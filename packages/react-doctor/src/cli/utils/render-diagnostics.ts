import isUnicodeSupported from "is-unicode-supported";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CODE_FRAME_BATCH_MAX_SPAN_LINES,
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  groupBy,
  highlighter,
  MAX_WARNING_RULES_SHOWN_NON_VERBOSE,
  MILLISECONDS_PER_SECOND,
  OUTPUT_MEASURE_WIDTH_CHARS,
  RULE_NAME_COLUMN_WIDTH_CHARS,
  TOP_ERRORS_DISPLAY_COUNT,
} from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { boxText } from "./box-text.js";
import { buildCodeFrame } from "./build-code-frame.js";
import {
  buildSortedRuleGroups,
  compareByRulePriority,
  formatFixRecipeLine,
  formatLearnMoreLine,
} from "./diagnostic-grouping.js";
import { indentMultilineText } from "./indent-multiline-text.js";
import { wrapTextToWidth } from "./wrap-indented-text.js";

const POINTER = isUnicodeSupported() ? "›" : ">";

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

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

// Resolves the absolute project root a given diagnostic's relative
// `filePath` should be read from when building its inline code frame.
interface SourceRootResolver {
  (diagnostic: Diagnostic): string;
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

// The dim `×N` badge that trails a rule's header line, or empty for a
// single site. Shared by the error and warning rule headers so the badge
// reads identically wherever a rule's occurrence count is shown.
const formatTrailingSiteBadge = (count: number): string => {
  const badge = formatSiteCountBadge(count);
  return badge.length > 0 ? ` ${highlighter.gray(badge)}` : "";
};

// A category leads with its most valuable rule. `ruleGroups` are already
// priority-sorted, so the first one is the category's top.
const categoryTopRuleKey = (categoryGroup: CategoryDiagnosticGroup): string =>
  categoryGroup.ruleGroups[0][0];

const buildCategoryDiagnosticGroups = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): CategoryDiagnosticGroup[] => {
  const categoryGroups = groupBy(diagnostics, (diagnostic) => diagnostic.category);
  return [...categoryGroups.entries()]
    .map(([category, categoryDiagnostics]) => ({
      category,
      diagnostics: categoryDiagnostics,
      ruleGroups: buildSortedRuleGroups(categoryDiagnostics, rulePriority),
    }))
    .toSorted((categoryGroupA, categoryGroupB) => {
      // Categories rank by their top rule's API priority. With no API
      // priority (offline / `--no-score`) every category compares equal,
      // so fall back to a deterministic alphabetical order.
      const priorityDelta = compareByRulePriority(
        categoryTopRuleKey(categoryGroupA),
        categoryTopRuleKey(categoryGroupB),
        rulePriority,
      );
      if (priorityDelta !== 0) return priorityDelta;
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

const TOP_ERROR_DETAIL_INDENT = "    ";

const pickRepresentativeDiagnostic = (ruleDiagnostics: Diagnostic[]): Diagnostic =>
  ruleDiagnostics.find((diagnostic) => diagnostic.line > 0) ?? ruleDiagnostics[0];

// A rule group renders as an error block (boxed code frames) when its
// representative is an error; otherwise it's a warning block (compact list).
const isErrorRuleGroup = (ruleDiagnostics: Diagnostic[]): boolean =>
  pickRepresentativeDiagnostic(ruleDiagnostics).severity === "error";

// A run of same-file sites of one rule whose individual frames would
// overlap, rendered as a single spanning frame instead of N near-identical
// boxes. `lead` is the first (lowest-line) site, used for the file path and
// the single-site caret column.
interface DiagnosticCluster {
  readonly diagnostics: Diagnostic[];
  readonly startLine: number;
  readonly endLine: number;
}

// Two same-file sites' frames touch (and so should share one frame) when
// the gap between their lines fits inside the frame's own context window.
const FRAME_CONTEXT_REACH_LINES = CODE_FRAME_LINES_ABOVE + CODE_FRAME_LINES_BELOW + 1;

// Groups a rule's sites into spanning clusters: same file, lines close
// enough that their frames overlap, capped so one long contiguous run
// splits into a few bounded frames rather than a single wall of code.
// File grouping preserves first-seen order; sites already arrive sorted by
// stakes, so clusters surface in a stable, sensible order.
const clusterNearbyDiagnostics = (diagnostics: Diagnostic[]): DiagnosticCluster[] => {
  const byFile = groupBy(diagnostics, (diagnostic) => diagnostic.filePath);
  const clusters: DiagnosticCluster[] = [];

  for (const fileDiagnostics of byFile.values()) {
    const sorted = [...fileDiagnostics].sort((left, right) => left.line - right.line);
    let current: Diagnostic[] = [];

    const flush = (): void => {
      if (current.length === 0) return;
      clusters.push({
        diagnostics: current,
        startLine: current[0]!.line,
        endLine: current[current.length - 1]!.line,
      });
      current = [];
    };

    for (const diagnostic of sorted) {
      const previous = current[current.length - 1];
      const breaksCluster =
        previous != null &&
        (diagnostic.line - previous.line > FRAME_CONTEXT_REACH_LINES ||
          diagnostic.line - current[0]!.line > CODE_FRAME_BATCH_MAX_SPAN_LINES);
      if (breaksCluster) flush();
      current.push(diagnostic);
    }
    flush();
  }

  return clusters;
};

const formatClusterLocation = (cluster: DiagnosticCluster): string => {
  const { filePath } = cluster.diagnostics[0]!;
  if (cluster.startLine <= 0) return filePath;
  if (cluster.endLine > cluster.startLine)
    return `${filePath}:${cluster.startLine}-${cluster.endLine}`;
  return `${filePath}:${cluster.startLine}`;
};

// The location + inline code frame for a cluster of nearby same-file
// sites, indented under its rule block. The location sits on its own line
// directly above the frame so it's obvious which file the frame belongs to.
// A multi-site cluster marks the whole line span; a single site keeps its
// precise caret column. `renderCodeFrame` is false for warning blocks —
// they keep their `file:line` locations but drop the boxed source frame so
// the costlier errors stay the visual focus.
const buildDiagnosticClusterLines = (
  cluster: DiagnosticCluster,
  resolveSourceRoot: SourceRootResolver,
  renderCodeFrame: boolean,
): ReadonlyArray<string> => {
  const lead = cluster.diagnostics[0]!;
  const isMultiSite = cluster.diagnostics.length > 1;
  const lines: string[] = [
    "",
    highlighter.gray(`${TOP_ERROR_DETAIL_INDENT}${formatClusterLocation(cluster)}`),
  ];
  const codeFrame = renderCodeFrame
    ? buildCodeFrame({
        filePath: lead.filePath,
        line: cluster.startLine,
        column: isMultiSite ? 0 : lead.column,
        endLine: isMultiSite ? cluster.endLine : undefined,
        rootDirectory: resolveSourceRoot(lead),
      })
    : null;
  if (codeFrame) {
    lines.push(
      indentMultilineText(boxText(codeFrame, OUTPUT_MEASURE_WIDTH_CHARS), TOP_ERROR_DETAIL_INDENT),
    );
  }
  const seenHints = new Set<string>();
  for (const diagnostic of cluster.diagnostics) {
    if (diagnostic.suppressionHint && !seenHints.has(diagnostic.suppressionHint)) {
      seenHints.add(diagnostic.suppressionHint);
      lines.push(highlighter.gray(`${TOP_ERROR_DETAIL_INDENT}↳ ${diagnostic.suppressionHint}`));
    }
  }
  return lines;
};

// Shared "top errors" block style, used by both the default summary
// (representative site only) and `--verbose` (every site). The headline
// is the category-prefixed rule title (e.g. "Security: Use of eval()")
// so it's immediately clear which kind of problem this is — a
// vulnerability, a perf hit, a crash. Falls back to the `plugin/rule` id
// when a diagnostic has no title (adopted third-party rules).
const buildRuleDetailBlock = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  resolveSourceRoot: SourceRootResolver,
  renderEverySite: boolean,
): ReadonlyArray<string> => {
  const representative = pickRepresentativeDiagnostic(ruleDiagnostics);
  const { severity } = representative;
  const trailingBadge = formatTrailingSiteBadge(ruleDiagnostics.length);
  const headline = colorizeBySeverity(
    `${representative.category}: ${representative.title ?? ruleKey}`,
    severity,
  );
  const icon = colorizeBySeverity(severity === "error" ? "✗" : "⚠", severity);

  const lines: string[] = [`  ${icon} ${headline}${trailingBadge}`];

  // Verbose lists every rule & site, so the per-rule impact prose would
  // just repeat down the whole report — skip it there and let the boxed
  // frames carry the detail.
  if (!renderEverySite) {
    for (const explanationLine of wrapTextToWidth(
      representative.message,
      OUTPUT_MEASURE_WIDTH_CHARS,
      { breakLongWords: false },
    )) {
      // The description stays the terminal's default color (not dimmed) —
      // it's the load-bearing "what & why", so it shouldn't read as muted
      // secondary text like the file location / code frame below it.
      lines.push(`${TOP_ERROR_DETAIL_INDENT}${explanationLine}`);
    }
  }

  // The fix/recommendation, wrapped under the impact (a full sentence is
  // too long to sit at the code-frame caret). Dim `→` lead-in marks it as
  // the suggested action.
  if (representative.help) {
    for (const fixLine of wrapTextToWidth(`→ ${representative.help}`, OUTPUT_MEASURE_WIDTH_CHARS, {
      breakLongWords: false,
    })) {
      lines.push(highlighter.dim(`${TOP_ERROR_DETAIL_INDENT}${fixLine}`));
    }
  }

  // Code frames are reserved for errors: warnings list their sites but
  // skip the boxed source so the report doesn't drown in frames now that
  // warnings surface by default.
  const renderCodeFrame = severity === "error";
  const sites = renderEverySite ? ruleDiagnostics : [representative];
  for (const cluster of clusterNearbyDiagnostics(sites)) {
    lines.push(...buildDiagnosticClusterLines(cluster, resolveSourceRoot, renderCodeFrame));
  }

  return lines;
};

// Indent under a warning's header line — six spaces so the body sits
// just past the `  ⚠ ` marker.
const WARNING_DETAIL_INDENT = "      ";

// Column the warning rule names pad to so each `×N` site badge lines up
// regardless of name length. Grows past the default when a rule key is
// longer than the column.
const computeRuleNameColumnWidth = (ruleKeys: ReadonlyArray<string>): number =>
  ruleKeys.reduce(
    (widest, ruleKey) => Math.max(widest, ruleKey.length),
    RULE_NAME_COLUMN_WIDTH_CHARS,
  );

const padRuleNameToColumn = (ruleName: string, columnWidth: number): string =>
  ruleName.length >= columnWidth ? ruleName : ruleName + " ".repeat(columnWidth - ruleName.length);

// The `  ⚠ <rule> ×N` header shared by the verbose warning block and the
// non-verbose roll-up. Only the icon carries the warning color — the rule
// name stays neutral so a long list doesn't drown in yellow. The name pads
// to the shared column only when a badge follows, so the `×N` badges align
// without leaving trailing whitespace on single-site rules.
const buildWarningHeaderLine = (
  ruleKey: string,
  siteCount: number,
  ruleNameColumnWidth: number,
): string => {
  const hasBadge = formatSiteCountBadge(siteCount).length > 0;
  const ruleName = hasBadge ? padRuleNameToColumn(ruleKey, ruleNameColumnWidth) : ruleKey;
  return `  ${highlighter.warn("⚠")} ${ruleName}${formatTrailingSiteBadge(siteCount)}`;
};

// Compact warning block: the `plugin/rule` key + `×N` badge, the impact,
// the fix, the canonical fix-recipe directive, then a flat, unspaced list
// of every `file:line` site. Warnings skip the boxed code frames (reserved
// for errors) so a long tail of low-severity findings stays scannable.
const buildWarningRuleBlock = (
  ruleKey: string,
  ruleDiagnostics: Diagnostic[],
  ruleNameColumnWidth: number,
  isAgentEnvironment: boolean,
): ReadonlyArray<string> => {
  const representative = pickRepresentativeDiagnostic(ruleDiagnostics);
  const lines: string[] = [
    buildWarningHeaderLine(ruleKey, ruleDiagnostics.length, ruleNameColumnWidth),
  ];

  // Humans get a short, prominent docs link right under the rule name; an
  // agent instead gets the cache-busting fetch directive lower down so it
  // pulls and follows the canonical recipe before editing.
  if (!isAgentEnvironment) {
    const learnMoreLine = formatLearnMoreLine(representative);
    if (learnMoreLine) {
      lines.push(`${WARNING_DETAIL_INDENT}${highlighter.info(learnMoreLine)}`);
    }
  }

  lines.push(highlighter.gray(indentMultilineText(representative.message, WARNING_DETAIL_INDENT)));
  if (representative.help) {
    lines.push(
      highlighter.gray(indentMultilineText(`→ ${representative.help}`, WARNING_DETAIL_INDENT)),
    );
  }
  if (isAgentEnvironment) {
    const fixRecipeLine = formatFixRecipeLine(representative);
    if (fixRecipeLine) {
      lines.push(highlighter.gray(`${WARNING_DETAIL_INDENT}${fixRecipeLine}`));
    }
  }

  for (const [filePath, sites] of buildVerboseSiteMap(ruleDiagnostics)) {
    if (sites.length === 0) {
      lines.push(highlighter.gray(`${WARNING_DETAIL_INDENT}${filePath}`));
      continue;
    }
    for (const site of sites) {
      lines.push(highlighter.gray(`${WARNING_DETAIL_INDENT}${filePath}:${site.line}`));
      if (site.suppressionHint) {
        lines.push(highlighter.gray(`${WARNING_DETAIL_INDENT}  ↳ ${site.suppressionHint}`));
      }
    }
  }

  return lines;
};

// Every error rule group in display order (score-API priority first, then
// severity + stakes). The top-N slice headlines the "errors you should fix"
// block; the remainder feeds the "+N more" overflow line.
const selectErrorRuleGroups = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): [string, Diagnostic[]][] =>
  buildSortedRuleGroups(
    diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    rulePriority,
  );

const selectTopErrorRuleGroups = (
  diagnostics: Diagnostic[],
  limit: number,
  rulePriority?: ReadonlyMap<string, number>,
): [string, Diagnostic[]][] => selectErrorRuleGroups(diagnostics, rulePriority).slice(0, limit);

// The "+N more rules — run --verbose to view the rest …" overflow line
// shared by the capped error and warning lists. The count is rule groups
// (not individual findings), spelled out as "rules" so it can't be misread
// as "+N more errors" next to the occurrence tallies above. `accent` colors
// it to the section's severity (error red / warning yellow).
const buildMoreRulesLine = (
  hiddenRuleCount: number,
  severityNoun: "errors" | "warnings",
  accent: (text: string) => string,
): string => {
  const ruleNoun = hiddenRuleCount === 1 ? "rule" : "rules";
  return `  ${highlighter.bold(accent(`+${hiddenRuleCount} more ${ruleNoun}`))} ${highlighter.dim("— run")} ${highlighter.bold(highlighter.info("--verbose"))} ${highlighter.dim(`to view the rest of the ${severityNoun} and details about each`)}`;
};

// The exact rule keys surfaced in the top-errors block — the set the
// score projection assumes you fix, so "fix the top N" matches what's
// shown. Pass the same `rulePriority` the renderer uses so the projected
// rules match the displayed ones.
export const getTopErrorRuleKeys = (
  diagnostics: Diagnostic[],
  limit: number,
  rulePriority?: ReadonlyMap<string, number>,
): ReadonlySet<string> =>
  new Set(selectTopErrorRuleGroups(diagnostics, limit, rulePriority).map(([ruleKey]) => ruleKey));

const buildTopErrorsLines = (
  diagnostics: Diagnostic[],
  resolveSourceRoot: SourceRootResolver,
  rulePriority?: ReadonlyMap<string, number>,
): ReadonlyArray<string> => {
  const errorRuleGroups = selectErrorRuleGroups(diagnostics, rulePriority);
  const topRuleGroups = errorRuleGroups.slice(0, TOP_ERRORS_DISPLAY_COUNT);
  if (topRuleGroups.length === 0) return [];
  const hiddenRuleCount = errorRuleGroups.length - topRuleGroups.length;

  const lines: string[] = [
    // Dim rule separating the overview tally from the detailed fixes.
    highlighter.dim(`  ${"─".repeat(OUTPUT_MEASURE_WIDTH_CHARS)}`),
    `  ${highlighter.bold(`Top ${topRuleGroups.length} ${topRuleGroups.length === 1 ? "error" : "errors"} you should fix`)}`,
    "",
  ];
  for (const [ruleKey, ruleDiagnostics] of topRuleGroups) {
    lines.push(...buildRuleDetailBlock(ruleKey, ruleDiagnostics, resolveSourceRoot, false));
    lines.push("");
  }
  if (hiddenRuleCount > 0) {
    lines.push(buildMoreRulesLine(hiddenRuleCount, "errors", highlighter.error));
  }
  return lines;
};

// In non-verbose mode errors get the detailed top-N block; warnings are
// summarized here as a compact `rule ×count` list so users see what fired
// and how often without the full per-site detail (which lives behind
// --verbose). Sorted by score priority like every other rule list.
const buildWarningsListLines = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): ReadonlyArray<string> => {
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (warningDiagnostics.length === 0) return [];

  const sortedRuleGroups = buildSortedRuleGroups(warningDiagnostics, rulePriority);
  // A long tail of warning rules would bury the summary, so cap the list and
  // surface the overflow as a single "+N more" line that points at --verbose.
  const shownRuleGroups = sortedRuleGroups.slice(0, MAX_WARNING_RULES_SHOWN_NON_VERBOSE);
  const hiddenRuleCount = sortedRuleGroups.length - shownRuleGroups.length;
  const ruleNameColumnWidth = computeRuleNameColumnWidth(
    shownRuleGroups.map(([ruleKey]) => ruleKey),
  );

  const lines: string[] = [
    highlighter.dim(`  ${"─".repeat(OUTPUT_MEASURE_WIDTH_CHARS)}`),
    `  ${highlighter.bold(`${warningDiagnostics.length} ${warningDiagnostics.length === 1 ? "warning" : "warnings"}`)}`,
    "",
  ];
  for (const [ruleKey, ruleDiagnostics] of shownRuleGroups) {
    lines.push(buildWarningHeaderLine(ruleKey, ruleDiagnostics.length, ruleNameColumnWidth));
  }
  if (hiddenRuleCount > 0) {
    lines.push(buildMoreRulesLine(hiddenRuleCount, "warnings", highlighter.warn));
  }
  return lines;
};

// The compact "Security › 6 errors" category tally, shown ABOVE the
// detailed blocks so the reader gets the at-a-glance breakdown first,
// then drills into specifics.
const buildCategoryBreakdownLines = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): string[] =>
  buildCategoryDiagnosticGroups(diagnostics, rulePriority).map(buildCompactCategoryLine);

const joinSections = (...sections: ReadonlyArray<string>[]): string[] => {
  const lines: string[] = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(...section);
  }
  if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  return lines;
};

// The total-issue tally (e.g. "600 issues"), shown right under the
// category breakdown as part of the overview. The "list every issue"
// hint lives at the very bottom of the run instead (see `printVerboseTip`).
const buildCountsSummaryLines = (diagnostics: Diagnostic[]): ReadonlyArray<string> => {
  const totalIssueCount = diagnostics.length;
  if (totalIssueCount === 0) return [];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = totalIssueCount - errorCount;
  const issueCountColor =
    errorCount > 0 ? highlighter.error : warningCount > 0 ? highlighter.warn : highlighter.dim;
  return [
    `  ${issueCountColor(`${totalIssueCount} ${totalIssueCount === 1 ? "issue" : "issues"}`)}`,
  ];
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
  // The directory each diagnostic's relative `filePath` is resolved
  // against for the inline code frame. A bare string works for a
  // single-project scan; multi-project scans pass a resolver so each
  // diagnostic reads from its own project root (their relative paths
  // would otherwise miss against a single shared root → no frame).
  sourceRoot: string | SourceRootResolver,
  // Score-API rule priorities (see `buildRulePriorityMap`). When present,
  // rule groups, categories, and the top-errors selection order
  // most-valuable-first; absent (offline / `--no-score`) ordering falls
  // back to severity + stakes.
  rulePriority?: ReadonlyMap<string, number>,
  // True when a coding agent is driving the CLI. Verbose warning blocks then
  // emit the cache-busting fetch directive instead of the human "Learn more"
  // link. Defaults to false (human) so tests render deterministically.
  isAgentEnvironment = false,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const resolveSourceRoot: SourceRootResolver =
      typeof sourceRoot === "function" ? sourceRoot : () => sourceRoot;

    // Overview first (category breakdown + total count), then the detail.
    // In verbose the detail is EVERY rule and EVERY site (not just the
    // top N representative) — same readable block layout, just exhaustive.
    let detailLines: ReadonlyArray<string>;
    if (!isVerbose) {
      detailLines = buildTopErrorsLines(diagnostics, resolveSourceRoot, rulePriority);
    } else {
      const sortedRuleGroups = buildSortedRuleGroups(diagnostics, rulePriority);
      // Warnings share one padded name column so their `×N` badges align;
      // errors render in the boxed-code-frame format instead.
      const warningRuleNameColumnWidth = computeRuleNameColumnWidth(
        sortedRuleGroups
          .filter(([, ruleDiagnostics]) => !isErrorRuleGroup(ruleDiagnostics))
          .map(([ruleKey]) => ruleKey),
      );
      detailLines = sortedRuleGroups.flatMap(([ruleKey, ruleDiagnostics]) => {
        const block = isErrorRuleGroup(ruleDiagnostics)
          ? buildRuleDetailBlock(ruleKey, ruleDiagnostics, resolveSourceRoot, true)
          : buildWarningRuleBlock(
              ruleKey,
              ruleDiagnostics,
              warningRuleNameColumnWidth,
              isAgentEnvironment,
            );
        return [...block, ""];
      });
    }

    const lines = joinSections(
      buildCategoryBreakdownLines(diagnostics, rulePriority),
      buildCountsSummaryLines(diagnostics),
      detailLines,
      // Verbose already renders every warning in full; the compact
      // warning roll-up is non-verbose only.
      isVerbose ? [] : buildWarningsListLines(diagnostics, rulePriority),
    );
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

// Plain-text per-rule summary written to the diagnostics directory (one
// `<plugin>--<rule>.txt` per rule) so the full findings are browsable on
// disk alongside the machine-readable `diagnostics.json`.
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
  const fixRecipeLine = formatFixRecipeLine(firstDiagnostic);
  if (fixRecipeLine) {
    sections.push("", fixRecipeLine);
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
