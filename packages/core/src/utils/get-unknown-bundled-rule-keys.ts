import { ALL_REACT_DOCTOR_RULE_KEYS, EXTERNAL_RULES } from "oxlint-plugin-react-doctor/core";
import { canonicalizeUserRuleKey, getEquivalentRuleKeys } from "../rule-key-aliases.js";

const KNOWN_RULE_KEYS: ReadonlySet<string> = new Set([
  ...ALL_REACT_DOCTOR_RULE_KEYS,
  ...EXTERNAL_RULES.map((rule) => rule.key),
]);
const BUNDLED_RULE_NAMESPACES: ReadonlySet<string> = new Set(
  [...KNOWN_RULE_KEYS]
    .flatMap(getEquivalentRuleKeys)
    .map((key) => key.slice(0, key.lastIndexOf("/"))),
);

export const getUnknownBundledRuleKeys = (
  rules: Readonly<Record<string, unknown>> | undefined,
): string[] =>
  Object.keys(rules ?? {}).filter((key) => {
    const canonicalKey = canonicalizeUserRuleKey(key);
    const namespace = canonicalKey.slice(0, canonicalKey.lastIndexOf("/"));
    return BUNDLED_RULE_NAMESPACES.has(namespace) && !KNOWN_RULE_KEYS.has(canonicalKey);
  });
