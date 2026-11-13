import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getRangeStart } from "./get-range-start.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "./is-presence-proven-before-node.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { stripThisParameter } from "./strip-this-parameter.js";

interface GuardedKeyValueInput {
  keyExpression: EsTreeNode;
  keyUse: EsTreeNode;
  mapCallback: EsTreeNode | null;
  iteratorCall: EsTreeNodeOfType<"CallExpression"> | null;
  scopes: ScopeAnalysis;
}

export const getNonNullishGuardedKeyValue = ({
  keyExpression,
  keyUse,
  mapCallback,
  iteratorCall,
  scopes,
}: GuardedKeyValueInput): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = keyUse;
  while (ancestor) {
    if (isNodeOfType(ancestor, "WithStatement")) return null;
    ancestor = ancestor.parent;
  }
  if (
    !iteratorCall ||
    iteratorCall.optional ||
    !isNodeOfType(iteratorCall.callee, "MemberExpression") ||
    iteratorCall.callee.computed ||
    iteratorCall.callee.optional ||
    getStaticPropertyName(iteratorCall.callee) !== "map" ||
    !isInlineFunctionExpression(mapCallback) ||
    mapCallback.async ||
    mapCallback.generator ||
    !isNodeOfType(mapCallback.body, "BlockStatement") ||
    findEnclosingFunction(keyUse) !== mapCallback
  ) {
    return null;
  }
  const [callbackArgument] = iteratorCall.arguments;
  const runtimeParameters = stripThisParameter(mapCallback.params);
  if (runtimeParameters !== mapCallback.params) return null;
  const [, indexParameter] = runtimeParameters;
  if (
    !callbackArgument ||
    stripParenExpression(callbackArgument) !== mapCallback ||
    !isNodeOfType(indexParameter, "Identifier")
  ) {
    return null;
  }
  const keyIdentifier = stripParenExpression(keyExpression);
  if (!isNodeOfType(keyIdentifier, "Identifier")) return null;
  const chosenSymbol = scopes.symbolFor(keyIdentifier);
  const chosenInitializer = chosenSymbol && getDirectConstInitializer(chosenSymbol);
  if (!chosenSymbol || !chosenInitializer || !isSymbolReadOnly(chosenSymbol)) return null;
  const fallback = stripParenExpression(chosenInitializer);
  if (!isNodeOfType(fallback, "LogicalExpression") || fallback.operator !== "??") return null;
  const captured = stripParenExpression(fallback.left);
  const fallbackIndex = stripParenExpression(fallback.right);
  if (!isNodeOfType(captured, "Identifier") || !isNodeOfType(fallbackIndex, "Identifier"))
    return null;
  const indexSymbol = scopes.symbolFor(indexParameter);
  if (
    !indexSymbol ||
    scopes.symbolFor(fallbackIndex) !== indexSymbol ||
    !isSymbolReadOnly(indexSymbol)
  ) {
    return null;
  }
  const capturedSymbol = scopes.symbolFor(captured);
  if (
    !capturedSymbol ||
    !getDirectConstInitializer(capturedSymbol) ||
    !isSymbolReadOnly(capturedSymbol) ||
    findEnclosingFunction(capturedSymbol.declarationNode) !== mapCallback ||
    findEnclosingFunction(chosenSymbol.declarationNode) !== mapCallback
  ) {
    return null;
  }
  const capturedBlock = capturedSymbol.declarationNode.parent?.parent;
  const chosenBlock = chosenSymbol.declarationNode.parent?.parent;
  if (
    !isNodeOfType(capturedBlock, "BlockStatement") ||
    !isNodeOfType(chosenBlock, "BlockStatement") ||
    !isAstDescendant(chosenSymbol.declarationNode, capturedBlock) ||
    !isAstDescendant(keyUse, chosenBlock)
  ) {
    return null;
  }
  const capturedStart = getRangeStart(capturedSymbol.declarationNode);
  const chosenStart = getRangeStart(chosenSymbol.declarationNode);
  const keyStart = getRangeStart(keyUse);
  if (
    capturedStart === null ||
    chosenStart === null ||
    keyStart === null ||
    capturedStart >= chosenStart ||
    chosenStart >= keyStart
  ) {
    return null;
  }
  const isCapturedNonNullish = isPresenceProvenBeforeNode(keyUse, (test) => {
    const guard = test.parent;
    if (
      !isNodeOfType(guard, "IfStatement") ||
      guard.test !== test ||
      !isAstDescendant(keyUse, guard.consequent)
    ) {
      return false;
    }
    const comparison = stripParenExpression(test);
    if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!=") return false;
    const left = stripParenExpression(comparison.left);
    const right = stripParenExpression(comparison.right);
    const guardedValue =
      isNodeOfType(left, "Literal") && left.value === null
        ? right
        : isNodeOfType(right, "Literal") && right.value === null
          ? left
          : null;
    return (
      isNodeOfType(guardedValue, "Identifier") && scopes.symbolFor(guardedValue) === capturedSymbol
    );
  });
  return isCapturedNonNullish ? captured : null;
};
