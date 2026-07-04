import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic } from "./types/index.js";
import { NON_REGISTRY_DIAGNOSTIC_TAGS, NON_REGISTRY_PLUGIN_TAGS } from "./constants.js";

export interface DiagnosticRuleIdentity {
  ruleKey: string;
  category: string;
  tags: ReadonlyArray<string>;
}

/**
 * The classification/behavioral tags for a diagnostic, single-sourced
 * for the surfaces filter, the `ignore.tags` gate, and per-diagnostic
 * tag stamping. Registered `react-doctor` rules carry their registry
 * tags (including the projected `impact:*` / `confidence:*` / `fix:*`);
 * first-party producers outside the registry (dead-code, supply-chain,
 * a few project checks) fall back to the maps in `constants.ts`;
 * everything else — third-party plugins, untagged producers — has none.
 */
export const resolveDiagnosticTags = (diagnostic: Diagnostic): ReadonlyArray<string> => {
  if (diagnostic.plugin === "react-doctor") {
    const registryTags = reactDoctorPlugin.rules[diagnostic.rule]?.tags;
    if (registryTags) return registryTags;
    return NON_REGISTRY_DIAGNOSTIC_TAGS[`react-doctor/${diagnostic.rule}`] ?? [];
  }
  return NON_REGISTRY_PLUGIN_TAGS[diagnostic.plugin] ?? [];
};

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
 * - `tags` — classification/behavioral tags (consumed by `ignore.tags`
 *   and `surfaces.*.{include,exclude}Tags`); see `resolveDiagnosticTags`.
 */
export const getDiagnosticRuleIdentity = (diagnostic: Diagnostic): DiagnosticRuleIdentity => ({
  ruleKey: `${diagnostic.plugin}/${diagnostic.rule}`,
  category: diagnostic.category,
  tags: resolveDiagnosticTags(diagnostic),
});
