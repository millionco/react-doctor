// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.
// Source of truth: every `export const <name> = defineRule({ id: "...", ... })`
// under `src/plugin/rules/<bucket>/<name>.ts`. The rule's `framework` and
// default `category` come from the bucket directory (see
// `scripts/generate-rule-registry.mjs`) — rule files only override
// `category` when needed. Adding a rule is a single-file operation:
// create the rule file, set its `id`, re-run codegen.

import type { Rule } from "./utils/rule.js";

import { A11yRuleEntries } from "./rule-registry/a11y.js";
import { ArchitectureRuleEntries } from "./rule-registry/architecture.js";
import { BundleSizeRuleEntries } from "./rule-registry/bundle-size.js";
import { ClientRuleEntries } from "./rule-registry/client.js";
import { CorrectnessRuleEntries } from "./rule-registry/correctness.js";
import { DesignRuleEntries } from "./rule-registry/design.js";
import { JsPerformanceRuleEntries } from "./rule-registry/js-performance.js";
import { NextjsRuleEntries } from "./rule-registry/nextjs.js";
import { PerformanceRuleEntries } from "./rule-registry/performance.js";
import { ReactBuiltinsRuleEntries } from "./rule-registry/react-builtins.js";
import { ReactNativeRuleEntries } from "./rule-registry/react-native.js";
import { ReactUiRuleEntries } from "./rule-registry/react-ui.js";
import { SecurityRuleEntries } from "./rule-registry/security.js";
import { ServerRuleEntries } from "./rule-registry/server.js";
import { StateAndEffectsRuleEntries } from "./rule-registry/state-and-effects.js";
import { TanstackQueryRuleEntries } from "./rule-registry/tanstack-query.js";
import { TanstackStartRuleEntries } from "./rule-registry/tanstack-start.js";
import { ViewTransitionsRuleEntries } from "./rule-registry/view-transitions.js";

export const reactDoctorRules = [
  ...A11yRuleEntries,
  ...ArchitectureRuleEntries,
  ...BundleSizeRuleEntries,
  ...ClientRuleEntries,
  ...CorrectnessRuleEntries,
  ...DesignRuleEntries,
  ...JsPerformanceRuleEntries,
  ...NextjsRuleEntries,
  ...PerformanceRuleEntries,
  ...ReactBuiltinsRuleEntries,
  ...ReactNativeRuleEntries,
  ...ReactUiRuleEntries,
  ...SecurityRuleEntries,
  ...ServerRuleEntries,
  ...StateAndEffectsRuleEntries,
  ...TanstackQueryRuleEntries,
  ...TanstackStartRuleEntries,
  ...ViewTransitionsRuleEntries,
] as const;

export const ruleRegistry: Record<string, Rule> = Object.fromEntries(
  reactDoctorRules.map((rule) => [rule.id, rule.rule]),
);
