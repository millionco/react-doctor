import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const resolveRawDevicePixelRatio = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "+") {
    return resolveRawDevicePixelRatio(candidate.argument, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "BinaryExpression")) {
    const rawLeft = resolveRawDevicePixelRatio(candidate.left, scopes, new Set(visitedSymbolIds));
    const rawRight = resolveRawDevicePixelRatio(candidate.right, scopes, new Set(visitedSymbolIds));
    if (rawLeft && !rawRight) {
      const rightOperand = stripParenExpression(candidate.right);
      if (
        isNodeOfType(rightOperand, "Literal") &&
        typeof rightOperand.value === "number" &&
        Number.isFinite(rightOperand.value) &&
        (candidate.operator === "+" ||
          candidate.operator === "-" ||
          ((candidate.operator === "*" ||
            candidate.operator === "/" ||
            candidate.operator === "**") &&
            rightOperand.value > 0))
      ) {
        return rawLeft;
      }
    }
    if (rawRight && !rawLeft) {
      const leftOperand = stripParenExpression(candidate.left);
      if (
        isNodeOfType(leftOperand, "Literal") &&
        typeof leftOperand.value === "number" &&
        Number.isFinite(leftOperand.value) &&
        (candidate.operator === "+" || (candidate.operator === "*" && leftOperand.value > 0))
      ) {
        return rawRight;
      }
    }
    return null;
  }
  if (isNodeOfType(candidate, "ArrayExpression") && candidate.elements.length === 2) {
    const upperBound = candidate.elements[1];
    return upperBound && !isNodeOfType(upperBound, "SpreadElement")
      ? resolveRawDevicePixelRatio(upperBound, scopes, new Set(visitedSymbolIds))
      : null;
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const receiver = stripParenExpression(candidate.object);
    return getStaticPropertyName(candidate) === "devicePixelRatio" &&
      isNodeOfType(receiver, "Identifier") &&
      (receiver.name === "window" || receiver.name === "globalThis") &&
      scopes.isGlobalReference(receiver)
      ? candidate
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "devicePixelRatio") {
    const initializer = stripParenExpression(symbol.initializer);
    if (
      isNodeOfType(initializer, "Identifier") &&
      (initializer.name === "window" || initializer.name === "globalThis") &&
      scopes.isGlobalReference(initializer)
    ) {
      return candidate;
    }
  }
  if (symbol.declarationNode.id !== symbol.bindingIdentifier) return null;
  return resolveRawDevicePixelRatio(symbol.initializer, scopes, visitedSymbolIds);
};
