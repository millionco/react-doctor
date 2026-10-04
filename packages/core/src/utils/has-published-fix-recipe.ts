import { REACT_DOCTOR_RULE_REGISTRY } from "oxlint-plugin-react-doctor/core";
import type { Diagnostic } from "../types/index.js";

/**
 * Whether a diagnostic's rule has a published per-rule fix recipe at
 * `${DOCS_RULES_BASE_URL}/react-doctor/<rule>`
 * (see `buildRuleDocsUrl`).
 *
 * Recipes are generated from React Doctor's registered rules. Synthetic
 * environment and supply-chain checks
 * (`require-reduced-motion`, `require-pnpm-hardening`,
 * `no-vulnerable-react-server-components` — `react-doctor`-namespaced but not
 * engine rules), and adopted
 * third-party plugins (`eslint`, `unicorn`, `react-hooks-js`, …) have no
 * recipe, so advertising "fetch the fix recipe" for them sends agents to
 * a 404. Gate the directive on this predicate.
 */
export const hasPublishedFixRecipe = (diagnostic: Pick<Diagnostic, "plugin" | "rule">): boolean =>
  diagnostic.plugin === "react-doctor" &&
  Object.hasOwn(REACT_DOCTOR_RULE_REGISTRY, diagnostic.rule);
