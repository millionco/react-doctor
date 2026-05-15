import type { Rule } from "./rule.js";

export interface RulePlugin {
  meta: { name: string };
  rules: Record<string, Rule>;
}
