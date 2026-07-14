import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
export { isOutsideAllFunctions } from "../../utils/is-outside-all-functions.js";

/**
 * Lowest-level helpers consumed by both the main `exhaustive-deps`
 * rule body AND the symbol-stability cluster
 * (`exhaustive-deps-symbol-stability.ts`). Sit in their own module so
 * the two top-level files can each import without a circular
 * dependency.
 *
 * Behaviour mirrors the previous inlined versions in `exhaustive-deps.ts`
 * exactly. The doc comment that used to argue against reusing the
 * shared `stripParenExpression` util still applies: this module's
 * `TRANSPARENT_WRAPPER_TYPES.has(...)` membership check is also read
 * directly by the member-chain walker in the main rule, so keeping
 * both `TRANSPARENT_WRAPPER_TYPES` and `unwrapExpression` co-located
 * here keeps that intent in one place.
 */

/**
 * Strip TypeScript expression wrappers transparently — `(x as T)`,
 * `x satisfies T`, `x!`, `(x)` — so they don't change the dep key.
 */
export const TRANSPARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
  "ChainExpression",
]);

export const unwrapExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    const inner = (current as { expression?: EsTreeNode | null }).expression;
    if (!inner) return current;
    current = inner;
  }
  return current;
};

/**
 * Get the hook name from a direct, wrapped, namespaced, or immutable
 * React import alias call.
 */
export const getHookName = (callee: EsTreeNode, scopes?: ScopeAnalysis): string | null => {
  const strippedCallee = unwrapExpression(callee);
  if (isNodeOfType(strippedCallee, "Identifier")) {
    const resolvedSymbol = scopes ? resolveConstIdentifierAlias(strippedCallee, scopes) : null;
    const importDeclaration = resolvedSymbol?.declarationNode.parent;
    if (
      resolvedSymbol?.kind === "import" &&
      importDeclaration &&
      isNodeOfType(importDeclaration, "ImportDeclaration") &&
      importDeclaration.source.value === "react"
    ) {
      return getImportedName(resolvedSymbol.declarationNode) ?? strippedCallee.name;
    }
    return strippedCallee.name;
  }
  if (
    isNodeOfType(strippedCallee, "MemberExpression") &&
    !strippedCallee.computed &&
    isNodeOfType(strippedCallee.property, "Identifier")
  ) {
    return strippedCallee.property.name;
  }
  return null;
};
