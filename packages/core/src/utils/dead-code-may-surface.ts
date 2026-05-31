import { DEAD_CODE_CATEGORY, DEAD_CODE_PLUGIN } from "../check-dead-code.js";
import { buildRuleSeverityControls } from "../build-rule-severity-controls.js";
import type { ReactDoctorConfig, RuleSeverityOverride } from "../types/index.js";

const DEAD_CODE_RULE_KEY_PREFIX = `${DEAD_CODE_PLUGIN}/`;

const isSurfacingOverride = (override: RuleSeverityOverride | undefined): boolean =>
  override === "warn" || override === "error";

// Dead-code findings are all `"warning"`-severity in the `Maintainability`
// category, so they're dropped when warnings are hidden — UNLESS a severity
// override restamps them. A per-rule (`deslop/*`) or per-category
// (`Maintainability`) override to `"warn"` survives the global hide, and one
// to `"error"` shows unconditionally. When such an override exists the
// (expensive) analysis must still run even with warnings off, otherwise the
// findings the user asked to surface are never generated.
export const deadCodeMaySurfaceWhenWarningsHidden = (
  userConfig: ReactDoctorConfig | null,
): boolean => {
  const severityControls = buildRuleSeverityControls(userConfig);
  if (!severityControls) return false;
  if (isSurfacingOverride(severityControls.categories?.[DEAD_CODE_CATEGORY])) return true;
  for (const [ruleKey, override] of Object.entries(severityControls.rules ?? {})) {
    if (ruleKey.startsWith(DEAD_CODE_RULE_KEY_PREFIX) && isSurfacingOverride(override)) return true;
  }
  return false;
};
