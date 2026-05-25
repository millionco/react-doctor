import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import {
  compileIgnoreOverrides,
  isDiagnosticIgnoredByOverrides,
} from "./apply-ignore-overrides.js";
import { restampSeverity } from "./apply-severity-controls.js";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { evaluateSuppression } from "./evaluate-suppression.js";
import { resolveCandidateReadPath } from "./filter-diagnostics.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";
import { compileIgnoredFilePatterns, isFileIgnoredByPatterns } from "./is-ignored-file.js";
import { isTestFilePath } from "./is-test-file.js";
import { resolveRuleSeverityOverride } from "./resolve-rule-severity-override.js";
import { isSameRuleKey } from "./rule-key-aliases.js";

interface BuildDiagnosticPipelineInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
  readonly readFileLinesSync: (filePath: string) => string[] | null;
  readonly respectInlineDisables: boolean;
}

export interface DiagnosticPipeline {
  readonly apply: (diagnostic: Diagnostic) => Diagnostic | null;
}

/**
 * Pre-compiles every stateful filter and returns a single
 * `apply(diagnostic)` closure that runs:
 *
 * 1. auto-suppress (test-noise rules in test files; `migration-hint`
 *    wins over `test-noise`)
 * 2. severity overrides (top-level `rules` / `categories`, with
 *    `"off"` dropping)
 * 3. ignore filters (rules / file patterns / per-file overrides)
 * 4. inline suppressions (`// react-doctor-disable-next-line ...`)
 *
 * Returns `null` when the diagnostic is dropped, the (possibly
 * severity-restamped) diagnostic otherwise. Shared by `runInspect`'s
 * streaming pipeline and the array-shaped `mergeAndFilterDiagnostics`
 * — single source of truth.
 */
export const buildDiagnosticPipeline = (
  input: BuildDiagnosticPipelineInput,
): DiagnosticPipeline => {
  const { rootDirectory, userConfig, readFileLinesSync, respectInlineDisables } = input;

  const severityControls = buildRuleSeverityControls(userConfig);
  const ignoredRules = new Set(
    Array.isArray(userConfig?.ignore?.rules)
      ? userConfig.ignore.rules.filter((rule): rule is string => typeof rule === "string")
      : [],
  );
  const ignoredFilePatterns = compileIgnoredFilePatterns(userConfig);
  const compiledOverrides = compileIgnoreOverrides(userConfig);
  const fileLinesCache = new Map<string, string[] | null>();
  const testFileCache = new Map<string, boolean>();

  const getFileLines = (filePath: string): string[] | null => {
    const cached = fileLinesCache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = resolveCandidateReadPath(rootDirectory, filePath);
    const lines = readFileLinesSync(absolutePath);
    fileLinesCache.set(filePath, lines);
    return lines;
  };

  const isTest = (filePath: string): boolean => {
    let cached = testFileCache.get(filePath);
    if (cached === undefined) {
      cached = isTestFilePath(filePath);
      testFileCache.set(filePath, cached);
    }
    return cached;
  };

  const shouldAutoSuppress = (diagnostic: Diagnostic): boolean => {
    if (diagnostic.plugin !== "react-doctor") return false;
    const rule = reactDoctorPlugin.rules[diagnostic.rule];
    if (!rule?.tags?.includes("test-noise")) return false;
    if (rule.tags.includes("migration-hint")) return false;
    return isTest(diagnostic.filePath);
  };

  const isRuleIgnored = (ruleIdentifier: string): boolean => {
    for (const ignored of ignoredRules) {
      if (isSameRuleKey(ignored, ruleIdentifier)) return true;
    }
    return false;
  };

  return {
    apply: (diagnostic) => {
      if (shouldAutoSuppress(diagnostic)) return null;

      let current = diagnostic;
      if (severityControls) {
        const { ruleKey, category } = getDiagnosticRuleIdentity(current);
        const override = resolveRuleSeverityOverride({ ruleKey, category }, severityControls);
        if (override === "off") return null;
        if (override !== undefined) current = restampSeverity(current, override);
      }

      if (userConfig) {
        const ruleIdentifier = `${current.plugin}/${current.rule}`;
        if (isRuleIgnored(ruleIdentifier)) return null;
        if (isFileIgnoredByPatterns(current.filePath, rootDirectory, ignoredFilePatterns)) {
          return null;
        }
        if (isDiagnosticIgnoredByOverrides(current, rootDirectory, compiledOverrides)) return null;
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

      return current;
    },
  };
};
