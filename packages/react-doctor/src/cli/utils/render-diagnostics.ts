import isUnicodeSupported from "is-unicode-supported";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CODE_FRAME_BATCH_MAX_SPAN_LINES,
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  DIAGNOSTIC_CATEGORY_BUCKETS,
  groupBy,
  highlighter,
  MILLISECONDS_PER_SECOND,
  TOP_ERRORS_DISPLAY_COUNT,
} from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { boxText } from "./box-text.js";
import { buildCodeFrame } from "./build-code-frame.js";
import { buildSectionDivider } from "./build-section-divider.js";
import {
  BOX_BORDER_WIDTH_CHARS,
  CATEGORY_COUNTUP_FRAME_DELAY_MS,
  CATEGORY_COUNTUP_MAX_STEPS,
  CATEGORY_COUNTUP_SETTLE_HOLD_MS,
} from "./constants.js";
import {
  buildSortedRuleGroups,
  formatFixRecipeLine,
  formatLearnMoreLine,
} from "./diagnostic-grouping.js";
import { indentMultilineText } from "./indent-multiline-text.js";
import { resolveMeasureWidth } from "./resolve-measure-width.js";
import { wrapTextToWidth } from "./wrap-indented-text.js";
import { writeStdout } from "./write-stdout.js";

const POINTER = isUnicodeSupported() ? "›" : ">";

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

export const collectAffectedFiles = (diagnostics: Diagnostic[]): Set<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath));

interface VerboseSiteEntry {
  line: number;
  suppressionHint?: string;
}

interface VerboseFileEntry {
  contextTag: string;
  sites: VerboseSiteEntry[];
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

// Dim "(test file)" / "(story file)" tag after a site's location, so a
// finding in a spec or story reads as non-shipping code rather than a
// production problem. Empty for production files (the default).
const formatFileContextTag = (diagnostic: Diagnostic): string =>
  diagnostic.fileContext ? ` (${diagnostic.fileContext} file)` : "";

const buildVerboseFileEntries = (diagnostics: Diagnostic[]): Map<string, VerboseFileEntry> => {
  const fileEntries = new Map<string, VerboseFileEntry>();
  for (const diagnostic of diagnostics) {
    let entry = fileEntries.get(diagnostic.filePath);
    if (entry === undefined) {
      entry = { contextTag: formatFileContextTag(diagnostic), sites: [] };
      fileEntries.set(diagnostic.filePath, entry);
    }
    if (diagnostic.line > 0) {
      entry.sites.push({ line: diagnostic.line, suppressionHint: diagnostic.suppressionHint });
    }
  }
  return fileEntries;
};

const formatSiteCountBadge = (count: number): string => (count > 1 ? `×${count}` : "");

// The dim `×N` badge that trails a rule's header line, or empty for a
// single site. Shared by the error and warning rule headers so the badge
// reads identically wherever a rule's occurrence count is shown.
const formatTrailingSiteBadge = (count: number): string => {
  const badge = formatSiteCountBadge(count);
  return badge.length > 0 ? ` ${highlighter.gray(badge)}` : "";
};

// Fixed display order for the category breakdown — Security at the top
// (most consequential class of issue), then Bugs, then Performance, then
// the rest. The score API's rule priority still drives the order of rules
// WITHIN a category, but the category list itself reads the same on every
// run so the reader can scan to a category by position, not by the day's
// score-weighting. Unknown categories (defensive — `DIAGNOSTIC_CATEGORY_BUCKETS`
// is the exhaustive set) sort alphabetically after the known ones.
const CATEGORY_DISPLAY_RANK: ReadonlyMap<string, number> = new Map(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category, index) => [category, index]),
);

const compareCategoriesByDisplayRank = (categoryA: string, categoryB: string): number => {
  const rankA = CATEGORY_DISPLAY_RANK.get(categoryA);
  const rankB = CATEGORY_DISPLAY_RANK.get(categoryB);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;
  return categoryA.localeCompare(categoryB);
};

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
    .toSorted((categoryGroupA, categoryGroupB) =>
      compareCategoriesByDisplayRank(categoryGroupA.category, categoryGroupB.category),
    );
};

interface CategoryTally {
  readonly category: string;
  readonly errorCount: number;
  readonly warningCount: number;
}

// One category line at arbitrary displayed counts (the count-up renders
// partial values). At full counts it matches the static breakdown output.
const formatCategoryTallyLine = (
  tally: CategoryTally,
  errorShown: number,
  warningShown: number,
): string => {
  const parts: string[] = [];
  if (tally.errorCount > 0)
    parts.push(highlighter.error(`${errorShown} ${errorShown === 1 ? "error" : "errors"}`));
  if (tally.warningCount > 0)
    parts.push(
      highlighter.warn(
        highlighter.dim(`${warningShown} ${warningShown === 1 ? "warning" : "warnings"}`),
      ),
    );
  return `  ${highlighter.bold(tally.category)} ${highlighter.dim(POINTER)} ${parts.join(highlighter.dim(", "))}`;
};

const buildCategoryTally = (categoryGroup: CategoryDiagnosticGroup): CategoryTally => ({
  category: categoryGroup.category,
  errorCount: categoryGroup.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .length,
  warningCount: categoryGroup.diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
    .length,
});

// The compact "Security › 6 errors" category tally lines, shown ABOVE the
// detailed blocks so the reader gets the at-a-glance breakdown first.
const buildCategoryTallyLines = (tallies: ReadonlyArray<CategoryTally>): string[] =>
  tallies.map((tally) => formatCategoryTallyLine(tally, tally.errorCount, tally.warningCount));

// Renders the breakdown with only the first `revealedUnitCount` issues shown,
// filled one category at a time (a category's errors before its warnings)
// so the reveal reads as issues landing one by one, top to bottom.
const buildPartiallyRevealedTallyLines = (
  tallies: ReadonlyArray<CategoryTally>,
  revealedUnitCount: number,
): string[] => {
  let remainingToReveal = revealedUnitCount;
  return tallies.map((tally) => {
    const errorShown = Math.min(tally.errorCount, remainingToReveal);
    remainingToReveal -= errorShown;
    const warningShown = Math.min(tally.warningCount, remainingToReveal);
    remainingToReveal -= warningShown;
    return formatCategoryTallyLine(tally, errorShown, warningShown);
  });
};

// Animated reveal of the category tally for an interactive run: issues land one
// at a time (errors then warnings, category by category) rather than every
// count easing up at once. Counts only grow, so frames never shrink and no
// per-line clear is needed; the last frame matches `buildCategoryTallyLines`.
const printCategoryCountUp = (tallies: ReadonlyArray<CategoryTally>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const totalUnitCount = tallies.reduce(
      (sum, tally) => sum + tally.errorCount + tally.warningCount,
      0,
    );
    // Step one issue per frame when there are few; otherwise grow the step so a
    // large breakdown still resolves within the frame budget.
    const unitsPerStep = Math.max(1, Math.ceil(totalUnitCount / CATEGORY_COUNTUP_MAX_STEPS));
    for (
      let revealedUnitCount = 0;
      revealedUnitCount < totalUnitCount;
      revealedUnitCount += unitsPerStep
    ) {
      const lines = buildPartiallyRevealedTallyLines(tallies, revealedUnitCount);
      const cursorUp = revealedUnitCount === 0 ? "" : `\x1b[${tallies.length}A`;
      yield* writeStdout(`${cursorUp}\r${lines.join("\n\r")}\n`);
      yield* Effect.sleep(CATEGORY_COUNTUP_FRAME_DELAY_MS);
    }
    // Land on the full tallies (the loop stops one step short when the total
    // isn't a clean multiple of the step).
    const cursorUp = totalUnitCount === 0 ? "" : `\x1b[${tallies.length}A`;
    yield* writeStdout(`${cursorUp}\r${buildCategoryTallyLines(tallies).join("\n\r")}\n`);
    yield* Effect.sleep(CATEGORY_COUNTUP_SETTLE_HOLD_MS);
  });

const TOP_ERROR_DETAIL_INDENT = "    ";

const pickRepresentativeDiagnostic = (ruleDiagnostics: Diagnostic[]): Diagnostic =>
  ruleDiagnostics.find((diagnostic) => diagnostic.line > 0) ?? ruleDiagnostics[0];

// True when a rule's sites all share one line-less location (e.g. every unused
// dependency reports at `package.json:0`), so only their messages tell them apart.
const hasIndistinctSiteLocations = (ruleDiagnostics: Diagnostic[]): boolean => {
  const firstDiagnostic = ruleDiagnostics[0];
  if (firstDiagnostic === undefined) return false;
  return ruleDiagnostics.every(
    (diagnostic) => diagnostic.line <= 0 && diagnostic.filePath === firstDiagnostic.filePath,
  );
};

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
  const lead = cluster.diagnostics[0]!;
  const contextTag = formatFileContextTag(lead);
  if (cluster.startLine <= 0) return `${lead.filePath}${contextTag}`;
  if (cluster.endLine > cluster.startLine)
    return `${lead.filePath}:${cluster.startLine}-${cluster.endLine}${contextTag}`;
  return `${lead.filePath}:${cluster.startLine}${contextTag}`;
};

// The location + inline code frame for a cluster of nearby same-file
// sites, indented under its rule block. The location sits on its own line
// directly above the frame so it's obvious which file the frame belongs to.
// A multi-site cluster marks the whole line span; a single site keeps its
// precise caret column. `renderCodeFrame` is false for warning blocks —
// they keep their `file:line` locations but drop the boxed source frame
// (in both the default summary and `--verbose`) so the costlier errors
// stay the visual focus and a long warning tail doesn't drown the report.
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
    const boxInnerWidth = resolveMeasureWidth(
      TOP_ERROR_DETAIL_INDENT.length + BOX_BORDER_WIDTH_CHARS,
    );
    lines.push(indentMultilineText(boxText(codeFrame, boxInnerWidth), TOP_ERROR_DETAIL_INDENT));
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
  isAgentEnvironment: boolean,
): ReadonlyArray<string> => {
  const representative = pickRepresentativeDiagnostic(ruleDiagnostics);
  const { severity } = representative;
  const trailingBadge = formatTrailingSiteBadge(ruleDiagnostics.length);
  const headline = colorizeBySeverity(
    `${representative.category}: ${representative.title ?? ruleKey}`,
    severity,
  );
  const icon = colorizeBySeverity(severity === "error" ? "✖" : "⚠", severity);

  const lines: string[] = [`  ${icon} ${headline}${trailingBadge}`];

  // Verbose lists every site, so humans get a prominent docs link right
  // under the rule name; agents instead get the cache-busting fetch
  // directive lower down (after the fix) so they pull and follow the
  // canonical recipe before editing.
  if (renderEverySite && !isAgentEnvironment) {
    const learnMoreLine = formatLearnMoreLine(representative);
    if (learnMoreLine) {
      lines.push(`${TOP_ERROR_DETAIL_INDENT}${highlighter.info(learnMoreLine)}`);
    }
  }

  // Impact prose, once per rule — except a warning group collapsed to one
  // line-less location lists every distinct message so each name shows (#690).
  const isCollapsedWarningGroup =
    severity === "warning" && hasIndistinctSiteLocations(ruleDiagnostics);
  const impactMessages = isCollapsedWarningGroup
    ? [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.message))]
    : [representative.message];
  for (const impactMessage of impactMessages) {
    for (const explanationLine of wrapTextToWidth(
      impactMessage,
      resolveMeasureWidth(TOP_ERROR_DETAIL_INDENT.length),
      { breakLongWords: false },
    )) {
      lines.push(`${TOP_ERROR_DETAIL_INDENT}${explanationLine}`);
    }
  }

  // The fix/recommendation, wrapped under the impact (a full sentence is
  // too long to sit at the code-frame caret). Dim `→` lead-in marks it as
  // the suggested action.
  if (representative.help) {
    for (const fixLine of wrapTextToWidth(
      `→ ${representative.help}`,
      resolveMeasureWidth(TOP_ERROR_DETAIL_INDENT.length),
      { breakLongWords: false },
    )) {
      lines.push(highlighter.dim(`${TOP_ERROR_DETAIL_INDENT}${fixLine}`));
    }
  }

  if (renderEverySite && isAgentEnvironment) {
    const fixRecipeLine = formatFixRecipeLine(representative);
    if (fixRecipeLine) {
      lines.push(highlighter.gray(`${TOP_ERROR_DETAIL_INDENT}${fixRecipeLine}`));
    }
  }

  // Errors always get the boxed code frame; warnings never do — even in
  // `--verbose`, where listing every warning site with its own frame would
  // drown the report. Warnings keep their `file:line` locations so they're
  // still navigable, just without the inline source preview.
  const renderCodeFrame = severity === "error";
  const sites = renderEverySite ? ruleDiagnostics : [representative];
  // A collapsed group's sites share one line-less location. When the help
  // already names it ("remove it from package.json"), the bare location line
  // would just dangle — no frame, no line to navigate to — so skip it. Rules
  // whose location is the subject (unused files) keep it: their help names no path.
  const skipSharedLocation =
    isCollapsedWarningGroup && representative.help.includes(representative.filePath);
  if (!skipSharedLocation) {
    for (const cluster of clusterNearbyDiagnostics(sites)) {
      lines.push(...buildDiagnosticClusterLines(cluster, resolveSourceRoot, renderCodeFrame));
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

// The non-verbose run only shows one representative site per top error rule
// group and no warnings at all, so anything past that — extra error rule
// groups, the other sites of a shown rule, or any warning — only appears
// under `--verbose`. The line surfaces that pointer whenever detail is
// hidden. The "+N more rules / +N warnings" stats deliberately stay OUT:
// the `All N issues` header + per-category breakdown directly above already
// give the totals and the error/warning split, so repeating them here read
// as a contradiction ("you have all 727 issues — also, 664 warnings are
// hidden"). The clean CTA answers the only remaining question: how do I
// see each one individually?
const buildOverflowSummaryLine = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): string | undefined => {
  const errorRuleGroups = selectErrorRuleGroups(diagnostics, rulePriority);
  const shownErrorRuleCount = Math.min(TOP_ERRORS_DISPLAY_COUNT, errorRuleGroups.length);
  if (diagnostics.length <= shownErrorRuleCount) return undefined;

  const command = highlighter.bold(highlighter.info("npx react-doctor@latest --verbose"));
  return `  ${highlighter.dim("Run")} ${command} ${highlighter.dim("to list every error and warning")}`;
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

// The top-errors section, with each rule block's start offset (within `lines`)
// so the renderer can play the onboarding beat before each error reveals.
interface TopErrorsSection {
  readonly lines: ReadonlyArray<string>;
  readonly blockOffsets: ReadonlyArray<number>;
}

const buildTopErrorsSection = (
  diagnostics: Diagnostic[],
  resolveSourceRoot: SourceRootResolver,
  rulePriority?: ReadonlyMap<string, number>,
): TopErrorsSection => {
  const errorRuleGroups = selectErrorRuleGroups(diagnostics, rulePriority);
  const topRuleGroups = errorRuleGroups.slice(0, TOP_ERRORS_DISPLAY_COUNT);
  if (topRuleGroups.length === 0) return { lines: [], blockOffsets: [] };

  // The detail block leads the report now (the most actionable content
  // first), so no leading divider — `printDiagnostics` emits one BELOW
  // this section as a separator between the detail and the overview
  // breakdown that follows.
  const lines: string[] = [
    `  ${highlighter.bold(`Top ${topRuleGroups.length} ${topRuleGroups.length === 1 ? "error" : "errors"} you should fix`)}`,
    "",
  ];
  const blockOffsets: number[] = [];
  for (const [ruleKey, ruleDiagnostics] of topRuleGroups) {
    blockOffsets.push(lines.length);
    lines.push(...buildRuleDetailBlock(ruleKey, ruleDiagnostics, resolveSourceRoot, false, false));
    lines.push("");
  }
  return { lines, blockOffsets };
};

// Joins sections with a single blank line between non-empty ones (and a
// trailing blank). Also returns each section's start index in the result
// (null for an empty section) so the renderer can animate/pace a section.
const joinSections = (
  ...sections: ReadonlyArray<string>[]
): { lines: string[]; sectionStarts: ReadonlyArray<number | null> } => {
  const lines: string[] = [];
  const sectionStarts: (number | null)[] = [];
  for (const section of sections) {
    if (section.length === 0) {
      sectionStarts.push(null);
      continue;
    }
    if (lines.length > 0) lines.push("");
    sectionStarts.push(lines.length);
    lines.push(...section);
  }
  if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  return { lines, sectionStarts };
};

// Bold "All N issues" header that introduces the category-breakdown block,
// matching the cadence of "Top N errors you should fix". The total moves
// INTO this header (rather than sitting under the breakdown as an orphan
// "557 issues" line) so the reader immediately reads the section as
// "here's the full breakdown of N total issues".
const buildOverviewHeaderLines = (diagnostics: Diagnostic[]): ReadonlyArray<string> => {
  const totalIssueCount = diagnostics.length;
  if (totalIssueCount === 0) return [];
  const issueNoun = totalIssueCount === 1 ? "issue" : "issues";
  return [`  ${highlighter.bold(`All ${totalIssueCount} ${issueNoun}`)}`];
};

// First-run onboarding reveal knobs for `printDiagnostics`. Both default off,
// so non-onboarding runs render instantly with no extra output.
export interface DiagnosticsOnboarding {
  // Beat to wait before each top-error block (a sleep on a TTY; else a no-op).
  readonly sectionPause?: Effect.Effect<void>;
  // Count the category tallies up from zero instead of printing them at once.
  readonly animateCountUp?: boolean;
}

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
  // True when a coding agent is driving the CLI. Verbose rule blocks then
  // emit the cache-busting fetch directive instead of the human "Learn more"
  // link. Defaults to false (human) so tests render deterministically.
  isAgentEnvironment = false,
  // First-run onboarding reveal. Defaults to an instant, static render so
  // normal runs print the whole report at once.
  onboarding: DiagnosticsOnboarding = {},
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // The beat played before each top-error block reveals; a no-op off onboarding.
    const sectionPause = onboarding.sectionPause ?? Effect.void;
    const animateCountUp = onboarding.animateCountUp ?? false;
    const resolveSourceRoot: SourceRootResolver =
      typeof sourceRoot === "function" ? sourceRoot : () => sourceRoot;

    // Detail block leads (the most actionable content — the specific
    // errors to fix). The category breakdown + total then land BELOW it as
    // a wrap-up overview that sets the score's context, separated from the
    // detail by a dim divider. In verbose the detail is EVERY rule and
    // EVERY site (not just the top N representative) — same readable block
    // layout, just exhaustive.
    let detailLines: ReadonlyArray<string>;
    // Offsets within `detailLines` where each top-error block begins, to pace
    // the reveal between errors. Empty in verbose (lists every rule, not top-N).
    let topErrorBlockOffsets: ReadonlyArray<number> = [];
    if (!isVerbose) {
      const topErrors = buildTopErrorsSection(diagnostics, resolveSourceRoot, rulePriority);
      detailLines = topErrors.lines;
      topErrorBlockOffsets = topErrors.blockOffsets;
    } else {
      const sortedRuleGroups = buildSortedRuleGroups(diagnostics, rulePriority);
      detailLines = sortedRuleGroups.flatMap(([ruleKey, ruleDiagnostics]) => {
        const block = buildRuleDetailBlock(
          ruleKey,
          ruleDiagnostics,
          resolveSourceRoot,
          true,
          isAgentEnvironment,
        );
        return [...block, ""];
      });
    }

    const overflowLine = isVerbose
      ? undefined
      : buildOverflowSummaryLine(diagnostics, rulePriority);

    const categoryTallies = buildCategoryDiagnosticGroups(diagnostics, rulePriority).map(
      buildCategoryTally,
    );
    const categoryLines = buildCategoryTallyLines(categoryTallies);

    // Only emit the divider when BOTH the detail and overview will print —
    // otherwise we'd open or end the report with a stray rule line.
    const overviewDividerLines =
      detailLines.length > 0 && categoryLines.length > 0 ? [buildSectionDivider()] : [];

    const { lines, sectionStarts } = joinSections(
      detailLines,
      overviewDividerLines,
      buildOverviewHeaderLines(diagnostics),
      categoryLines,
      overflowLine ? [overflowLine] : [],
    );
    // joinSections preserves the argument order, so the 1st start is the
    // detail block and the 4th is the category block (the header sits
    // between the divider and the breakdown).
    const [detailStart, , , categoryStart] = sectionStarts;
    const pauseBeforeLineIndices =
      detailStart == null
        ? new Set<number>()
        : new Set(topErrorBlockOffsets.map((offset) => detailStart + offset));

    let lineIndex = 0;
    while (lineIndex < lines.length) {
      // The category block counts up in place rather than printing flat; skip
      // the static lines it replaces.
      if (animateCountUp && lineIndex === categoryStart && categoryLines.length > 0) {
        yield* printCategoryCountUp(categoryTallies);
        lineIndex += categoryLines.length;
        continue;
      }
      if (pauseBeforeLineIndices.has(lineIndex)) yield* sectionPause;
      yield* Console.log(lines[lineIndex]);
      lineIndex += 1;
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
  // Most rules emit one fixed message, but per-site messages (React
  // Compiler bail-out reasons) vary — list every distinct one so the
  // first site's reason isn't presented as if it described all N sites.
  const distinctMessages = [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.message))];

  const sections = [
    `Rule: ${ruleKey}`,
    `Severity: ${firstDiagnostic.severity}`,
    `Category: ${firstDiagnostic.category}`,
    `Count: ${ruleDiagnostics.length}`,
    "",
    distinctMessages.join("\n\n"),
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
  const fileEntries = buildVerboseFileEntries(ruleDiagnostics);
  for (const [filePath, { contextTag, sites }] of fileEntries) {
    if (sites.length > 0) {
      for (const site of sites) {
        sections.push(`  ${filePath}:${site.line}${contextTag}`);
        if (site.suppressionHint) {
          sections.push(`    ${site.suppressionHint}`);
        }
      }
    } else {
      sections.push(`  ${filePath}${contextTag}`);
    }
  }

  return sections.join("\n") + "\n";
};
