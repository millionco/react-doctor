import type { Capability } from "./capability.js";
import { hasCapability } from "./get-react-doctor-setting.js";
import type { RuleContext } from "./rule-context.js";

export const shouldCreateRuleVisitors = (
  settings: RuleContext["settings"],
  disabledWhen: ReadonlyArray<Capability> | undefined,
): boolean => !disabledWhen?.some((capability) => hasCapability(settings, capability));
