import { REACT_HOC_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { flattenCalleeName } from "./flatten-callee-name.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

/**
 * Resolves a `VariableDeclarator.init` (or any expression) to the inline
 * function expression it binds, seeing through chains of `memo` /
 * `forwardRef` / `React.memo` / `React.forwardRef` wrappers:
 *
 *   `() => {}`                          → the arrow
 *   `memo(function Foo() {})`           → the named function expression
 *   `React.memo(forwardRef(() => {}))`  → the inner arrow
 *   `memo(SomeIdentifier)`              → `null` (no inline function)
 *
 * Component-shaped rules that previously gated on a direct function init
 * (via `isComponentAssignment`) use this so memo-wrapped components are
 * not silently skipped.
 */
export const unwrapReactHocFunction = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression"> | null => {
  if (!node) return null;
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "CallExpression")) {
    const calleeName = flattenCalleeName(current.callee);
    if (!calleeName || !REACT_HOC_NAMES.has(calleeName)) return null;
    const firstArgument = current.arguments[0] as EsTreeNode | undefined;
    if (!firstArgument) return null;
    current = stripParenExpression(firstArgument);
  }
  return isInlineFunctionExpression(current) ? current : null;
};
