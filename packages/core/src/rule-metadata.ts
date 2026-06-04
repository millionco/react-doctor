import reactDoctorPlugin from "oxlint-plugin-react-doctor";

/**
 * Static, presentation-oriented metadata for a single rule, resolved
 * from the bundled `oxlint-plugin-react-doctor` registry. Editor
 * integrations use this to enrich hovers and code actions (rule tags,
 * canonical recommendation, owning category) without importing the
 * plugin themselves — `@react-doctor/core` already loads it.
 */
export interface RuleMetadata {
  readonly id: string;
  readonly plugin: string;
  readonly category: string | null;
  readonly recommendation: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly defaultEnabled: boolean;
}

const lookupOwnRule = (
  rule: string,
):
  | {
      category?: string;
      recommendation?: string;
      tags?: ReadonlyArray<string>;
      defaultEnabled?: boolean;
    }
  | undefined =>
  Object.hasOwn(reactDoctorPlugin.rules, rule) ? reactDoctorPlugin.rules[rule] : undefined;

/**
 * Returns presentation metadata for `<plugin>/<rule>`, or `null` when the
 * rule is not part of the bundled react-doctor plugin (e.g. an adopted
 * `eslint` / `unicorn` rule folded in via the user's lint config — those
 * carry their own help/url on the diagnostic instead).
 */
export const getRuleMetadata = (plugin: string, rule: string): RuleMetadata | null => {
  if (plugin !== "react-doctor") return null;
  const definition = lookupOwnRule(rule);
  if (!definition) return null;
  return {
    id: rule,
    plugin,
    category: definition.category ?? null,
    recommendation: definition.recommendation ?? null,
    tags: definition.tags ?? [],
    defaultEnabled: definition.defaultEnabled ?? true,
  };
};
