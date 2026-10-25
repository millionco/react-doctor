import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getCallbackStatements } from "./get-callback-statements.js";
import { getReactUseCallbackCall } from "./get-react-use-callback-call.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface LocalComboboxCallback {
  readonly symbol: SymbolDescriptor;
  readonly node: EsTreeNodeOfType<"ArrowFunctionExpression" | "FunctionExpression">;
  readonly statements: EsTreeNode[];
  readonly wrapper: EsTreeNodeOfType<"CallExpression"> | null;
}

export const getLocalComboboxCallback = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): LocalComboboxCallback | null => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  )
    return null;
  const wrapper = getReactUseCallbackCall(identifier, scopes);
  if (
    wrapper &&
    (wrapper.optional ||
      wrapper.arguments.length !== 2 ||
      !isProvenUnmodifiedReactApiCall(wrapper, "useCallback", scopes) ||
      !isNodeOfType(wrapper.arguments[1], "ArrayExpression"))
  )
    return null;
  const argument = wrapper ? wrapper.arguments[0] : symbol.initializer;
  if (!argument) return null;
  const candidate = stripParenExpression(argument);
  if (
    (!isNodeOfType(candidate, "ArrowFunctionExpression") &&
      !isNodeOfType(candidate, "FunctionExpression")) ||
    candidate.async ||
    candidate.generator
  )
    return null;
  if (
    isNodeOfType(candidate.body, "BlockStatement") &&
    candidate.body.body.some(
      (statement) =>
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(stripParenExpression(statement.expression), "Identifier") &&
        !scopes.isGlobalReference(stripParenExpression(statement.expression)),
    )
  )
    return null;
  const dependencies = wrapper?.arguments[1];
  if (
    isNodeOfType(dependencies, "ArrayExpression") &&
    dependencies.elements.some(
      (element) =>
        !element ||
        !isNodeOfType(stripParenExpression(element), "Identifier") ||
        (() => {
          const dependency = scopes.symbolFor(stripParenExpression(element));
          return !dependency || hasSymbolBindingWrites(dependency);
        })(),
    )
  )
    return null;
  if (
    !symbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (isNodeOfType(parent, "CallExpression") && parent.callee === root && !parent.optional)
        return true;
      if (
        isNodeOfType(parent, "JSXExpressionContainer") &&
        isNodeOfType(parent.parent, "JSXAttribute")
      ) {
        const opening = parent.parent.parent;
        return (
          isNodeOfType(parent.parent.name, "JSXIdentifier") &&
          (parent.parent.name.name === "onKeyDown" || parent.parent.name.name === "onClick") &&
          isNodeOfType(opening, "JSXOpeningElement") &&
          isNodeOfType(opening.name, "JSXIdentifier") &&
          HTML_TAGS.has(opening.name.name)
        );
      }
      if (!isNodeOfType(parent, "ArrayExpression")) return false;
      const call = parent.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.arguments[1] === parent &&
        isProvenUnmodifiedReactApiCall(call, new Set(["useCallback", "useEffect"]), scopes)
      );
    })
  )
    return null;
  return { symbol, node: candidate, statements: getCallbackStatements(candidate), wrapper };
};
