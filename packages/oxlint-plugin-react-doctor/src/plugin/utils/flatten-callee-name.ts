import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

/**
 * Flattens a call-expression `callee` AST node into its dotted source
 * string when it's an `Identifier` or a `MemberExpression` chain.
 *
 *   `memo`                  → `"memo"`
 *   `React.memo`            → `"React.memo"`
 *   `a.b.c.memo`            → `"a.b.c.memo"`
 *   `obj[computed]`         → `null` (computed members can't flatten)
 *   `someCall().foo`        → `null` (only Identifier roots flatten)
 *
 * Used by HOC-detection sites (`no-multi-comp`, `exhaustive-deps`,
 * `rules-of-hooks`, `build-same-file-memo-registry`) which were each
 * carrying their own near-identical inlined implementation.
 */
export const flattenCalleeName = (callee: EsTreeNode): string | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isNodeOfType(unwrappedCallee, "Identifier")) return unwrappedCallee.name;
  if (isNodeOfType(unwrappedCallee, "MemberExpression") && !unwrappedCallee.computed) {
    const objectName = flattenCalleeName(unwrappedCallee.object);
    if (!objectName) return null;
    if (isNodeOfType(unwrappedCallee.property, "Identifier")) {
      return `${objectName}.${unwrappedCallee.property.name}`;
    }
  }
  return null;
};
