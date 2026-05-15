import { ruleRegistry } from "./rule-registry.js";
import type { RulePlugin } from "./utils/rule-plugin.js";

// The plugin object loaded by oxlint (via `dist/react-doctor-plugin.js`)
// and by `eslint-plugin.ts`. Rules are sourced from the codegen-built
// `rule-registry.ts`, which scans every `defineRule({ id: "...", ... })`
// declaration under `src/plugin/rules/<bucket>/<rule>.ts`. Adding a new
// rule is a single-file operation: create the rule, set its `id`, run
// `pnpm gen`.
const plugin: RulePlugin = {
  meta: { name: "react-doctor" },
  rules: ruleRegistry,
};

export default plugin;
