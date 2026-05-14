import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";

export interface DeprecatedReactImportRuleOptions {
  /** The exact `import "..."` source string this rule watches. */
  source: string;
  /** Per-imported-name message dictionary. Exact-match lookup. */
  messages: ReadonlyMap<string, string>;
  /**
   * Optional extra ImportDeclaration handler invoked BEFORE the standard
   * source check — used by the react-dom rule to flag every import from
   * `react-dom/test-utils` (whole entry point gone in React 19).
   * Return `true` to mark "handled, skip the standard branch".
   */
  handleExtraSource?: (
    node: EsTreeNodeOfType<"ImportDeclaration">,
    context: RuleContext,
  ) => boolean;
}
