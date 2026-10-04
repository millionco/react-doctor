import type { Capability, CapabilityQuery } from "./capability.js";
import type { RuleFramework, RuleSeverity } from "./rule.js";

export interface CoreRuleMetadata {
  readonly id: string;
  readonly title?: string;
  readonly severity: RuleSeverity;
  readonly recommendation?: string;
  readonly recommendationFor?: (hasCapability: CapabilityQuery) => string | undefined;
  readonly category: string;
  readonly framework: RuleFramework;
  readonly requires?: ReadonlyArray<Capability>;
  readonly disabledWhen?: ReadonlyArray<Capability>;
  readonly tags?: ReadonlyArray<string>;
  readonly defaultEnabled?: boolean;
  readonly matchByOccurrence?: boolean;
  readonly isScanRule: boolean;
  readonly isProjectRule?: boolean;
}

export interface CoreRuleRegistryEntry {
  readonly key: string;
  readonly id: string;
  readonly source: "react-doctor";
  readonly originallyExternal: boolean;
  readonly rule: CoreRuleMetadata;
}
