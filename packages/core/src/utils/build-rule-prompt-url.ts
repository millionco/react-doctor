import { PROMPTS_RULES_BASE_URL } from "../constants.js";

/**
 * Canonical URL for a rule's reviewer-tested fix recipe, served at
 * `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md`. The
 * `/doctor` playbook fetches it on demand so each fix follows the
 * canonical recipe instead of being improvised per diagnostic.
 */
export const buildRulePromptUrl = (plugin: string, rule: string): string =>
  `${PROMPTS_RULES_BASE_URL}/${plugin}/${rule}.md`;
