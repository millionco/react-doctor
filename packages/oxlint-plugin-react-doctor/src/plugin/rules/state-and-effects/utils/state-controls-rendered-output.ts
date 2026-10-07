import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { containsJsxElement } from "../../../utils/contains-jsx-element.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const expressionControlsRenderedOutput = (
  expressionNode: EsTreeNode,
  renderFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const expression = findTransparentExpressionRoot(expressionNode);
  const parent = expression.parent;
  if (!parent) return false;
  if (
    (isNodeOfType(parent, "ReturnStatement") && parent.argument === expression) ||
    isNodeOfType(parent, "JSXExpressionContainer") ||
    isNodeOfType(parent, "JSXAttribute")
  ) {
    return findEnclosingFunction(parent) === renderFunction;
  }
  if (isNodeOfType(parent, "IfStatement") && parent.test === expression) {
    return (
      containsJsxElement(parent.consequent) ||
      Boolean(parent.alternate && containsJsxElement(parent.alternate))
    );
  }
  if (
    (isNodeOfType(parent, "WhileStatement") || isNodeOfType(parent, "DoWhileStatement")) &&
    parent.test === expression
  ) {
    return containsJsxElement(parent.body);
  }
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expression &&
    isNodeOfType(parent.id, "Identifier") &&
    parent.parent &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const"
  ) {
    const aliasSymbol = scopes.symbolFor(parent.id);
    if (!aliasSymbol || visitedSymbolIds.has(aliasSymbol.id)) return false;
    visitedSymbolIds.add(aliasSymbol.id);
    const controlsOutput = aliasSymbol.references.some(
      (reference) =>
        reference.flag === "read" &&
        findEnclosingFunction(reference.identifier) === renderFunction &&
        expressionControlsRenderedOutput(
          reference.identifier,
          renderFunction,
          scopes,
          visitedSymbolIds,
        ),
    );
    visitedSymbolIds.delete(aliasSymbol.id);
    return controlsOutput;
  }
  if (
    isNodeOfType(parent, "ExpressionStatement") ||
    isNodeOfType(parent, "VariableDeclaration") ||
    isNodeOfType(parent, "BlockStatement")
  ) {
    return false;
  }
  return expressionControlsRenderedOutput(parent, renderFunction, scopes, visitedSymbolIds);
};

export const stateControlsRenderedOutput = (
  stateSymbol: SymbolDescriptor,
  renderFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  stateSymbol.references.some(
    (reference) =>
      reference.flag === "read" &&
      findEnclosingFunction(reference.identifier) === renderFunction &&
      expressionControlsRenderedOutput(reference.identifier, renderFunction, scopes, new Set()),
  );
