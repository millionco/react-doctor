import type { Diagnostic, ReactDoctorConfig, RuleSeverityOverride } from "@react-doctor/types";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";
import { resolveRuleSeverityOverride } from "./resolve-rule-severity-override.js";

export const SEVERITY_FOR_OVERRIDE: Record<
  Exclude<RuleSeverityOverride, "off">,
  Diagnostic["severity"]
> = {
  error: "error",
  warn: "warning",
};

export const restampSeverity = (
  diagnostic: Diagnostic,
  override: Exclude<RuleSeverityOverride, "off">,
): Diagnostic => {
  const targetSeverity = SEVERITY_FOR_OVERRIDE[override];
  if (diagnostic.severity === targetSeverity) return diagnostic;
  return { ...diagnostic, severity: targetSeverity };
};

/**
 * Applies the user's top-level `rules` / `categories` / `tags`
 * severity config to a post-lint diagnostic list:
 *
 * - `"off"` drops the diagnostic entirely. For react-doctor rules
 *   this also happens at lint-registration time; this post-filter
 *   covers external plugins (`react/*`, `jsx-a11y/*`, custom adopted
 *   configs) whose severities the lint config can't reach.
 * - `"warn"` / `"error"` re-stamps `diagnostic.severity` so downstream
 *   consumers — `--fail-on`, the score input, the CLI summary — see
 *   the user-chosen severity rather than the rule's built-in one.
 *
 * Returns the input array by identity when no controls are configured
 * so the common path stays allocation-free.
 */
export const applySeverityControls = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig | null,
): Diagnostic[] => {
  const controls = buildRuleSeverityControls(config);
  if (!controls) return diagnostics;

  const adjusted: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const { ruleKey, category } = getDiagnosticRuleIdentity(diagnostic);
    const override = resolveRuleSeverityOverride({ ruleKey, category }, controls);
    if (override === "off") continue;
    adjusted.push(override === undefined ? diagnostic : restampSeverity(diagnostic, override));
  }
  return adjusted;
};
