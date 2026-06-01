import isUnicodeSupported from "is-unicode-supported";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CODE_FRAME_BATCH_MAX_SPAN_LINES,
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  groupBy,
  highlighter,
  MILLISECONDS_PER_SECOND,
  OUTPUT_MEASURE_WIDTH_CHARS,
  TOP_ERRORS_DISPLAY_COUNT,
} from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { boxText } from "./box-text.js";
import { buildCodeFrame } from "./build-code-frame.js";
import { buildSectionDivider } from "./build-section-divider.js";
import { CATEGORY_COUNTUP_FRAME_COUNT, CATEGORY_COUNTUP_FRAME_DELAY_MS } from "./constants.js";
import {
  buildSortedRuleGroups,
  compareByRulePriority,
  formatFixRecipeLine,
  formatLearnMoreLine,
} from "./diagnostic-grouping.js";
import { easeOutCubic } from "./ease-out-cubic.js";
import { indentMultilineText } from "./indent-multiline-text.js";
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

// Animated count-up of the category tally for a first interactive run; counts
// only grow, so frames never shrink and no per-line clear is needed. Lands on
// the exact same lines `buildCategoryTallyLines` prints statically.
const printCategoryCountUp = (tallies: ReadonlyArray<CategoryTally>): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let frame = 0; frame <= CATEGORY_COUNTUP_FRAME_COUNT; frame += 1) {
      const fraction = easeOutCubic(frame / CATEGORY_COUNTUP_FRAME_COUNT);
      const lines = tallies.map((tally) =>
        formatCategoryTallyLine(
          tally,
          Math.round(tally.errorCount * fraction),
          Math.round(tally.warningCount * fraction),
        ),
      );
      const cursorUp = frame === 0 ? "" : `\x1b[${tallies.length}A`;
      yield* writeStdout(`${cursorUp}\r${lines.join("\n\r")}\n`);
      if (frame < CATEGORY_COUNTUP_FRAME_COUNT)
        yield* Effect.sleep(CATEGORY_COUNTUP_FRAME_DELAY_MS);
    }
  });

const TOP_ERROR_DETAIL_INDENT = "    ";

const pickRepresentativeDiagnostic = (ruleDiagnostics: Diagnostic[]): Diagnostic =>
  ruleDiagnostics.find((diagnostic) => diagnostic.line > 0) ?? ruleDiagnostics[0];

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

  if (renderEverySite && isAgentEnvironment) {
    const fixRecipeLine = formatFixRecipeLine(representative);
    if (fixRecipeLine) {
      lines.push(highlighter.gray(`${TOP_ERROR_DETAIL_INDENT}${fixRecipeLine}`));
    }
  }

  // Errors always get the boxed code frame; in verbose every rule does
  // (warnings included) so the exhaustive view renders warnings in the same
  // format as errors. The default summary keeps frames error-only so a long
  // warning tail doesn't drown the report.
  const renderCodeFrame = severity === "error" || renderEverySite;
  const sites = renderEverySite ? ruleDiagnostics : [representative];
  for (const cluster of clusterNearbyDiagnostics(sites)) {
    lines.push(...buildDiagnosticClusterLines(cluster, resolveSourceRoot, renderCodeFrame));
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
// hidden, with `+N more rules` counting hidden error groups (the unit the
// top-errors block uses) and `+N optional warnings` counting individual
// warnings (matching the overview's per-category and total tallies).
const buildOverflowSummaryLine = (
  diagnostics: Diagnostic[],
  rulePriority?: ReadonlyMap<string, number>,
): string | undefined => {
  const errorRuleGroups = selectErrorRuleGroups(diagnostics, rulePriority);
  const shownErrorRuleCount = Math.min(TOP_ERRORS_DISPLAY_COUNT, errorRuleGroups.length);
  if (diagnostics.length <= shownErrorRuleCount) return undefined;

  const hiddenErrorRuleCount = errorRuleGroups.length - shownErrorRuleCount;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  const parts: string[] = [];
  if (hiddenErrorRuleCount > 0) {
    const ruleNoun = hiddenErrorRuleCount === 1 ? "rule" : "rules";
    parts.push(highlighter.bold(highlighter.error(`+${hiddenErrorRuleCount} more ${ruleNoun}`)));
  }
  if (warningCount > 0) {
    const warningNoun = warningCount === 1 ? "warning" : "warnings";
    parts.push(highlighter.bold(highlighter.warn(`+${warningCount} optional ${warningNoun}`)));
  }

  const command = highlighter.bold(highlighter.info("npx react-doctor@latest --verbose"));
  const lead =
    parts.length > 0
      ? `${parts.join(highlighter.dim(" and "))} ${highlighter.dim("- run")}`
      : highlighter.dim("Run");
  return `  ${lead} ${command} ${highlighter.dim("for details")}`;
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

  const lines: string[] = [
    // Dim rule separating the overview tally from the detailed fixes.
    buildSectionDivider(),
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

// The total-issue tally (e.g. "600 issues"), shown right under the
// category breakdown as part of the overview. The `--verbose` hint lives
// in the combined overflow line at the end of the run instead.
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

    // Overview first (category breakdown + total count), then the detail.
    // In verbose the detail is EVERY rule and EVERY site (not just the
    // top N representative) — same readable block layout, just exhaustive.
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

    const { lines, sectionStarts } = joinSections(
      categoryLines,
      buildCountsSummaryLines(diagnostics),
      detailLines,
      overflowLine ? [overflowLine] : [],
    );
    // joinSections preserves the argument order, so the 1st start is the
    // category block and the 3rd is the detail block.
    const [categoryStart, , detailStart] = sectionStarts;
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
