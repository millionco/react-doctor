import { buildRuleSeverityControls } from "../build-rule-severity-controls.js";
import {
  MAINTAINABILITY_CATEGORY,
  MAINTAINABILITY_DUPLICATE_JSX_RULE,
  MAINTAINABILITY_PLUGIN,
} from "../constants.js";
import type { ReactDoctorConfig, RuleSeverityOverride } from "../types/index.js";

const MAINTAINABILITY_RULE_KEY = `${MAINTAINABILITY_PLUGIN}/${MAINTAINABILITY_DUPLICATE_JSX_RULE}`;

const isSurfacingOverride = (override: RuleSeverityOverride | undefined): boolean =>
  override === "warn" || override === "error";

export const maintainabilityMaySurfaceWhenWarningsHidden = (
  userConfig: ReactDoctorConfig | null,
): boolean => {
  const severityControls = buildRuleSeverityControls(userConfig);
  if (!severityControls) return false;
  if (isSurfacingOverride(severityControls.categories?.[MAINTAINABILITY_CATEGORY])) return true;
  for (const [ruleKey, override] of Object.entries(severityControls.rules ?? {})) {
    if (ruleKey === MAINTAINABILITY_RULE_KEY && isSurfacingOverride(override)) return true;
  }
  return false;
};
