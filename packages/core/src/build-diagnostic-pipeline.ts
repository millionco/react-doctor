import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type {
  Diagnostic,
  DiagnosticFileContext,
  ReactDoctorConfig,
  RuleSeverityOverride,
} from "./types/index.js";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "./apply-ignore-overrides.js";
import { restampSeverity } from "./apply-severity-controls.js";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { evaluateSuppression } from "./evaluate-suppression.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";
import { classifyFileContext } from "./classify-file-context.js";
import { resolveRuleSeverityOverride } from "./resolve-rule-severity-override.js";
import { isSameRuleKey } from "./rule-key-aliases.js";
import { APP_ONLY_RULE_KEYS } from "./constants.js";
import { classifyPackageRole } from "./utils/classify-package-role.js";
import { resolveCandidateReadPath } from "./utils/resolve-candidate-read-path.js";
import {
  isInsideStringOnlyWrapper,
  isInsideTextComponent,
} from "./utils/jsx-text-component-matchers.js";

interface BuildDiagnosticPipelineInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
  readonly readFileLinesSync: (filePath: string) => string[] | null;
  readonly respectInlineDisables: boolean;
  /**
   * Whether `"warning"`-severity diagnostics are allowed through. When
   * `true` (the default), warnings show; when `false`, every warning is
   * dropped UNLESS the user explicitly opted that specific rule / category
   * into `"warn"` via the severity-override config (an individual opt-in).
   * Resolved by the caller from the `--warnings` / `--no-warnings` flag →
   * `config.warnings` → `true`.
   */
  readonly showWarnings: boolean;
}

export interface DiagnosticPipeline {
  readonly apply: (diagnostic: Diagnostic) => Diagnostic | null;
}

const collectStringSet = (values: unknown): ReadonlySet<string> => {
  if (!Array.isArray(values)) return new Set();
  return new Set(values.filter((value): value is string => typeof value === "string"));
};

/**
 * Pre-compiles every stateful filter and returns a single
 * `apply(diagnostic)` closure that runs (in order):
 *
 * 1. auto-suppress (test-noise rules in test files; `migration-hint`
 *    wins over `test-noise`)
 * 2. severity overrides (top-level `rules` / `categories`, with
 *    `"off"` dropping)
 * 3. warning suppression (only when `showWarnings` is false: drops every
 *    `"warning"`-severity diagnostic unless a severity override opts a
 *    specific rule / category back in)
 * 4. ignore filters (rules / file patterns / per-file overrides)
 * 5. `rn-no-raw-text` suppression via configured `textComponents` and
 *    `rawTextWrapperComponents` (config-driven JSX enclosure checks)
 * 6. inline suppressions (`// react-doctor-disable-next-line ...`)
 * 7. file-context stamping (`fileContext: "test" | "story"` on
 *    survivors in non-production files, so renderers can label them)
 *
 * Returns `null` when the diagnostic is dropped, the (possibly
 * severity-restamped) diagnostic otherwise.
 *
 * This is the single source of truth for diagnostic filtering — both
 * `runInspect`'s streaming pipeline and the array-shaped
 * `mergeAndFilterDiagnostics` wrapper apply this closure per element.
 */
export const buildDiagnosticPipeline = (
  input: BuildDiagnosticPipelineInput,
): DiagnosticPipeline => {
  const { rootDirectory, userConfig, readFileLinesSync, respectInlineDisables, showWarnings } =
    input;

  const severityControls = buildRuleSeverityControls(userConfig);
  const ignoredRules = new Set(
    Array.isArray(userConfig?.ignore?.rules)
      ? userConfig.ignore.rules.filter((rule): rule is string => typeof rule === "string")
      : [],
  );
  const ignoredFilePatterns = compileIgnoredFilePatterns(userConfig);
  const compiledOverrides = compileIgnoreOverrides(userConfig);
  const textComponentNames = collectStringSet(userConfig?.textComponents);
  const rawTextWrapperComponentNames = collectStringSet(userConfig?.rawTextWrapperComponents);
  const hasTextComponents = textComponentNames.size > 0;
  const hasRawTextWrappers = rawTextWrapperComponentNames.size > 0;
  const fileLinesCache = new Map<string, string[] | null>();
  const fileContextCache = new Map<string, DiagnosticFileContext>();
  const libraryFileCache = new Map<string, boolean>();

  // App-only rules (`static-components`, `no-render-prop-children`) describe
  // patterns that are noise in published libraries — silence them on files
  // confidently classified as `library`. Cached per diagnostic path; the
  // classifier itself memoizes by package directory.
  const isLibraryFile = (filePath: string): boolean => {
    let cached = libraryFileCache.get(filePath);
    if (cached === undefined) {
      const absolutePath = resolveCandidateReadPath(rootDirectory, filePath);
      cached = classifyPackageRole(absolutePath) === "library";
      libraryFileCache.set(filePath, cached);
    }
    return cached;
  };

  const getFileLines = (filePath: string): string[] | null => {
    const cached = fileLinesCache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = resolveCandidateReadPath(rootDirectory, filePath);
    const lines = readFileLinesSync(absolutePath);
    fileLinesCache.set(filePath, lines);
    return lines;
  };

  const getFileContext = (filePath: string): DiagnosticFileContext => {
    let cached = fileContextCache.get(filePath);
    if (cached === undefined) {
      cached = classifyFileContext(filePath);
      fileContextCache.set(filePath, cached);
    }
    return cached;
  };

  const shouldAutoSuppress = (diagnostic: Diagnostic): boolean => {
    if (diagnostic.plugin !== "react-doctor") return false;
    const rule = reactDoctorPlugin.rules[diagnostic.rule];
    if (!rule?.tags?.includes("test-noise")) return false;
    if (rule.tags.includes("migration-hint")) return false;
    return getFileContext(diagnostic.filePath) !== "production";
  };

  const isRuleIgnored = (ruleIdentifier: string): boolean => {
    for (const ignored of ignoredRules) {
      if (isSameRuleKey(ignored, ruleIdentifier)) return true;
    }
    return false;
  };

  // Alias-aware membership for the app-only set (mirrors `isRuleIgnored`): a
  // future alias of `static-components` / `no-render-prop-children` is still
  // caught by the library gate, where a raw `Set.has` would miss it.
  const isAppOnlyRule = (ruleIdentifier: string): boolean => {
    for (const appOnlyRuleKey of APP_ONLY_RULE_KEYS) {
      if (isSameRuleKey(appOnlyRuleKey, ruleIdentifier)) return true;
    }
    return false;
  };

  const isRnRawTextSuppressedByConfig = (diagnostic: Diagnostic): boolean => {
    if (diagnostic.rule !== "rn-no-raw-text") return false;
    if (diagnostic.line <= 0) return false;
    if (!hasTextComponents && !hasRawTextWrappers) return false;
    const lines = getFileLines(diagnostic.filePath);
    if (!lines) return false;
    if (hasTextComponents && isInsideTextComponent(lines, diagnostic.line, textComponentNames)) {
      return true;
    }
    if (
      hasRawTextWrappers &&
      isInsideStringOnlyWrapper(
        lines,
        diagnostic.line,
        diagnostic.column,
        rawTextWrapperComponentNames,
      )
    ) {
      return true;
    }
    return false;
  };

  return {
    apply: (diagnostic) => {
      if (shouldAutoSuppress(diagnostic)) return null;

      let current = diagnostic;
      let explicitSeverityOverride: RuleSeverityOverride | undefined;
      // A *per-rule* override (vs. a broad `categories` bump) — the only signal
      // that should re-enable an app-only rule on a library file.
      let explicitRuleOverride: RuleSeverityOverride | undefined;
      if (severityControls) {
        const { ruleKey, category } = getDiagnosticRuleIdentity(current);
        // No `category` → resolves against `rules` (+ aliases) only, ignoring
        // any matching `categories` entry.
        explicitRuleOverride = resolveRuleSeverityOverride({ ruleKey }, severityControls);
        explicitSeverityOverride = resolveRuleSeverityOverride(
          { ruleKey, category },
          severityControls,
        );
        if (explicitSeverityOverride === "off") return null;
        if (explicitSeverityOverride !== undefined) {
          current = restampSeverity(current, explicitSeverityOverride);
        }
      }

      // App-only rules stay silent on library files unless the user opted the
      // rule in explicitly. Only a per-rule override counts: a broad category
      // bump (e.g. `categories: { Maintainability: "error" }`) is not a
      // deliberate "I want static-components in my library" and must not leak
      // these rules back into published packages.
      if (explicitRuleOverride === undefined) {
        const ruleKey = `${current.plugin}/${current.rule}`;
        if (isAppOnlyRule(ruleKey) && isLibraryFile(current.filePath)) return null;
      }

      // When the user opts out of warnings (`showWarnings` false), an
      // explicit `"warn"` override (per-rule or per-category) is an
      // individual opt-in that survives the global hide; everything else
      // is dropped.
      if (!showWarnings && current.severity === "warning" && explicitSeverityOverride !== "warn") {
        return null;
      }

      if (userConfig) {
        const ruleIdentifier = `${current.plugin}/${current.rule}`;
        if (isRuleIgnored(ruleIdentifier)) return null;
        if (isFileIgnoredByPatterns(current.filePath, rootDirectory, ignoredFilePatterns)) {
          return null;
        }
        if (isDiagnosticIgnoredByOverrides(current, rootDirectory, compiledOverrides)) return null;
        if (isRnRawTextSuppressedByConfig(current)) return null;
      }

      if (respectInlineDisables && current.line > 0) {
        const lines = getFileLines(current.filePath);
        if (lines) {
          const ruleIdentifier = `${current.plugin}/${current.rule}`;
          const diagnosticLineIndex = current.line - 1;
          const evaluation = evaluateSuppression(lines, diagnosticLineIndex, ruleIdentifier);
          if (evaluation.isSuppressed) return null;
          if (evaluation.nearMissHint) {
            current = { ...current, suppressionHint: evaluation.nearMissHint };
          }
        }
      }

      const fileContext = getFileContext(current.filePath);
      if (fileContext !== "production") {
        current = { ...current, fileContext };
      }

      return current;
    },
  };
};
