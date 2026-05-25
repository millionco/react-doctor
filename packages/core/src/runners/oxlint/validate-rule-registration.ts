import reactDoctorPlugin, { ALL_REACT_DOCTOR_RULE_KEYS } from "oxlint-plugin-react-doctor";
import { getRuleCategory } from "./parse-output.js";

let didValidate = false;

/**
 * One-time lazy assertion that every shipped react-doctor rule has
 * the metadata the renderer + capability gating depend on:
 * `category` (drives the diagnostic grouping in CLI output) and
 * `recommendation` (the "Suggestion" line in `--verbose`).
 * Framework capability gates are generated from the rule bucket, so
 * individual rule files no longer need to repeat that metadata.
 *
 * Warns rather than throws so a metadata gap on one rule never
 * blocks the user's whole scan; surfaced to the user as a single
 * stderr line that's easy to grep / triage in CI logs.
 */
export const validateRuleRegistration = (): void => {
  if (didValidate) return;
  didValidate = true;
  const missingHelp: string[] = [];
  const missingCategory: string[] = [];
  for (const fullKey of ALL_REACT_DOCTOR_RULE_KEYS) {
    const ruleName = fullKey.replace(/^react-doctor\//, "");
    if (!getRuleCategory(ruleName)) {
      missingCategory.push(fullKey);
    }
    if (!reactDoctorPlugin.rules[ruleName]?.recommendation) {
      missingHelp.push(fullKey);
    }
  }
  if (missingCategory.length === 0 && missingHelp.length === 0) {
    return;
  }
  const detail = [
    missingCategory.length > 0
      ? `Missing rule categories (add to defineRule call): ${missingCategory.join(", ")}`
      : null,
    missingHelp.length > 0
      ? `Missing rule recommendations (add to defineRule call): ${missingHelp.join(", ")}`
      : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join("; ");
  // HACK: warn rather than throw — never block the user's scan over a metadata gap.
  console.warn(`[react-doctor] rule-registration drift: ${detail}`);
};
