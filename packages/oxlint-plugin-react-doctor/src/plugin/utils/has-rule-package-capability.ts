import type { Capability } from "./capability.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import type { RuleContext } from "./rule-context.js";
import type { RulePackageContext } from "./rule-package-context.js";

const PROJECT_LEVEL_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "nextjs:static-export",
  "pre-es2023",
  "react-compiler",
  "target-blank-needs-explicit-protection",
  "target-blank-needs-noreferrer",
  "typescript",
]);

export const hasRulePackageCapability = (
  packageContext: RulePackageContext | null,
  settings: RuleContext["settings"],
  capability: Capability,
): boolean => {
  if (packageContext === null) return hasCapability(settings, capability);
  if (packageContext.hasCapability(capability)) return true;
  return PROJECT_LEVEL_CAPABILITIES.has(capability) && hasCapability(settings, capability);
};
