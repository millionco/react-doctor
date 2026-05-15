import type { RuleSeverity } from "./plugin/utils/rule.js";

// Oxlint config entries accept the plugin's per-rule severities plus
// `"off"`, which the plugin type intentionally omits (an "off" rule is
// just one that's never registered).
export type OxlintRuleSeverity = RuleSeverity | "off";
