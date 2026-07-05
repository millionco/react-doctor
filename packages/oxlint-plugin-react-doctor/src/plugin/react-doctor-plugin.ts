import { ruleRegistry } from "./rule-registry.js";
import type { Rule } from "./utils/rule.js";
import type { HostRule, RulePlugin } from "./utils/rule-plugin.js";
import { wrapReactNativeRule } from "./utils/wrap-react-native-rule.js";
import { wrapWithSemanticContext } from "./utils/wrap-with-semantic-context.js";

// Wraps every `framework: "react-native"` rule with the shared package-
// boundary check (`isReactNativeFileActive`) so they short-circuit on
// files that demonstrably target the web. Done at registry load rather
// than per-rule so adding a new `rn-*` rule never needs to remember to
// repeat the same gate — it just lands in the `react-native/` bucket
// and the registry takes care of the rest. Non-RN rules pass through
// unchanged.
//
// Then wraps EVERY rule with the semantic-context wrapper, which
// builds a scope tree and CFG for the file lazily on first access.
// Rules that never read `context.scopes` / `context.cfg` pay nothing.
const applyFrameworkRuleWrappers = (registry: Record<string, Rule>): Record<string, HostRule> => {
  const wrapped: Record<string, HostRule> = {};
  for (const [ruleId, rule] of Object.entries(registry)) {
    const frameworkWrapped = rule.framework === "react-native" ? wrapReactNativeRule(rule) : rule;
    wrapped[ruleId] = wrapWithSemanticContext(frameworkWrapped);
  }
  return wrapped;
};

// The plugin object loaded by oxlint and by eslint-plugin-react-doctor.
// Rules are sourced from the codegen-built
// `rule-registry.ts`, which scans every `defineRule({ id: "...", ... })`
// declaration under `src/plugin/rules/<bucket>/<rule>.ts`. Adding a new
// rule is a single-file operation: create the rule, set its `id`, run
// `pnpm gen`.
const plugin: RulePlugin = {
  meta: { name: "react-doctor" },
  rules: applyFrameworkRuleWrappers(ruleRegistry),
};

export default plugin;
