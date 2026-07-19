import { ruleRegistry } from "./rule-registry.js";
import type { Rule } from "./utils/rule.js";
import type { HostRule } from "./utils/rule-plugin.js";
import type { RulePlugin } from "./utils/rule-plugin.js";
import { wrapInkRule } from "./utils/wrap-ink-rule.js";
import { wrapNextjsRule } from "./utils/wrap-nextjs-rule.js";
import { wrapReactNativeRule } from "./utils/wrap-react-native-rule.js";
import { wrapWithSemanticContext } from "./utils/wrap-with-semantic-context.js";

// Wraps every `framework: "react-native"` rule with the shared package-
// boundary check (`isReactNativeFileActive`) and every
// `framework: "nextjs"` rule with the parallel check (`isNextFileActive`)
// so they short-circuit on files whose own package demonstrably targets
// another platform. Done at registry load rather than per-rule so adding
// a new `rn-*` / `nextjs-*` rule never needs to remember to repeat the
// same gate — it just lands in its bucket directory and the registry
// takes care of the rest. Other rules pass through unchanged.
//
// Every rule then gets the lazy scope-tree and CFG wrapper — the analyses
// build on first `context.scopes` / `context.cfg` access and are memoized
// per Program, so rules that never read them pay only the root capture.
const applyFrameworkGate = (rule: Rule): Rule => {
  if (rule.minimumInkVersion) return wrapInkRule(rule);
  if (rule.framework === "react-native") return wrapReactNativeRule(rule);
  if (rule.framework === "nextjs") return wrapNextjsRule(rule);
  return rule;
};

const applyFrameworkRuleWrappers = (registry: Record<string, Rule>): Record<string, HostRule> => {
  const wrapped: Record<string, HostRule> = {};
  for (const [ruleId, rule] of Object.entries(registry)) {
    wrapped[ruleId] = wrapWithSemanticContext(applyFrameworkGate(rule));
  }
  return wrapped;
};

// The plugin object loaded by oxlint (via `dist/react-doctor-plugin.js`)
// and by `eslint-plugin.ts`. Rules are sourced from the codegen-built
// `rule-registry.ts`, which scans every `defineRule({ id: "...", ... })`
// declaration under `src/plugin/rules/<bucket>/<rule>.ts`. Adding a new
// rule is a single-file operation: create the rule, set its `id`, run
// `pnpm gen`.
const plugin: RulePlugin = {
  meta: { name: "react-doctor" },
  rules: applyFrameworkRuleWrappers(ruleRegistry),
};

export default plugin;
