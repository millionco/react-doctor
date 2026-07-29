import type { Capability } from "./capability.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import type { RuleContext } from "./rule-context.js";
import type { RulePackageContext } from "./rule-package-context.js";

export const hasRulePackageCapability = (
  packageContext: RulePackageContext | null,
  settings: RuleContext["settings"],
  capability: Capability,
): boolean => {
  if (packageContext === null) return hasCapability(settings, capability);
  return packageContext.hasCapability(capability);
};
