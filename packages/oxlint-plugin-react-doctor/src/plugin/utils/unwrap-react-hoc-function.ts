import { REACT_HOC_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
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
 *   `memo(SomeIdentifier)`              → the identifier's same-file function when scopes are provided
 *
 * Component-shaped rules that previously gated on a direct function init
 * (via `isComponentAssignment`) use this so memo-wrapped components are
 * not silently skipped.
 */
const resolveReactHocFunction = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis | undefined,
  visitedSymbolIds: Set<number>,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression"> | null => {
  if (!node) return null;
  const current = stripParenExpression(node);
  if (isInlineFunctionExpression(current)) return current;
  if (isNodeOfType(current, "Identifier") && scopes) {
    const symbol = scopes.symbolFor(current);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      (symbol.kind !== "const" && symbol.kind !== "function")
    ) {
      return null;
    }
    if (
      symbol.kind === "const" &&
      (!isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        symbol.declarationNode.id !== symbol.bindingIdentifier)
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveReactHocFunction(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(current, "CallExpression")) {
    const calleeName = flattenCalleeName(current.callee);
    if (!calleeName || !REACT_HOC_NAMES.has(calleeName)) return null;
    const firstArgument = current.arguments[0] as EsTreeNode | undefined;
    if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return null;
    return resolveReactHocFunction(firstArgument, scopes, visitedSymbolIds);
  }
  return null;
};

export const unwrapReactHocFunction = (
  node: EsTreeNode | null | undefined,
  scopes?: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression"> | null =>
  resolveReactHocFunction(node, scopes, new Set());
