import type { Capability } from "./capability.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import type { RuleContext } from "./rule-context.js";
import type { RulePackageContext } from "./rule-package-context.js";

const PROJECT_FALLBACK_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "target-blank-needs-explicit-protection",
  "target-blank-needs-noreferrer",
]);

export const hasRulePackageCapability = (
  packageContext: RulePackageContext | null,
  settings: RuleContext["settings"],
  capability: Capability,
): boolean => {
  if (packageContext === null) return hasCapability(settings, capability);
  if (packageContext.hasCapability(capability)) return true;
  return PROJECT_FALLBACK_CAPABILITIES.has(capability) && hasCapability(settings, capability);
};
