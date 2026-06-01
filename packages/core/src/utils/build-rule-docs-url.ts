import { DOCS_RULES_BASE_URL } from "../constants.js";

/**
 * Canonical URL for a rule's documentation page — its reviewer-tested fix
 * recipe rendered for humans — served at
 * `https://www.react.doctor/docs/rules/<plugin>/<rule>`. The CLI links here
 * from its fix-recipe directive so each fix follows the canonical recipe
 * instead of being improvised per diagnostic.
 */
export const buildRuleDocsUrl = (plugin: string, rule: string): string =>
  `${DOCS_RULES_BASE_URL}/${plugin}/${rule}`;
