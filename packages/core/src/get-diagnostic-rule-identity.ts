import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic } from "./types/index.js";

export interface DiagnosticRuleIdentity {
  ruleKey: string;
  category: string;
  tags: ReadonlyArray<string>;
}

/**
 * Projects a diagnostic onto the three axes rule-targeted controls
 * reason about:
 *
 * - `ruleKey` — the fully-qualified `"<plugin>/<rule>"` form users
 *   put in config files (consumed by top-level `rules` severity and
 *   `surfaces.*.{include,exclude}Rules`).
 * - `category` — the diagnostic's category label (consumed by
 *   top-level `categories` severity and
 *   `surfaces.*.{include,exclude}Categories`).
 * - `tags` — behavioral tags from the rule registry (consumed by
 *   `ignore.tags` and `surfaces.*.{include,exclude}Tags`). Empty
 *   for non-`react-doctor` plugins.
 */
export const getDiagnosticRuleIdentity = (diagnostic: Diagnostic): DiagnosticRuleIdentity => ({
  ruleKey: `${diagnostic.plugin}/${diagnostic.rule}`,
  category: diagnostic.category,
  tags:
    diagnostic.plugin === "react-doctor"
      ? (reactDoctorPlugin.rules[diagnostic.rule]?.tags ?? [])
      : [],
});
