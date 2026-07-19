import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isApiCallFromModules } from "./utils/is-api-call-from-modules.js";
import { DREI_CACHED_LOADER_HOOK_NAMES, DREI_PUBLIC_MODULES } from "./utils/drei-public-modules.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";

const isDirectNullishExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      scopes.isGlobalReference(candidate)) ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void")
  );
};

const readStaticTruthiness = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return Boolean(candidate.value);
  if (isNodeOfType(candidate, "Identifier")) {
    if (candidate.name === "undefined" && scopes.isGlobalReference(candidate)) return false;
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      !visitedSymbolIds.has(symbol.id) &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier
    ) {
      visitedSymbolIds.add(symbol.id);
      return readStaticTruthiness(symbol.initializer, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void") return false;
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    const argumentTruthiness = readStaticTruthiness(
      candidate.argument,
      scopes,
      new Set(visitedSymbolIds),
    );
    return argumentTruthiness === null ? null : !argumentTruthiness;
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    const testTruthiness = readStaticTruthiness(candidate.test, scopes, new Set(visitedSymbolIds));
    if (testTruthiness !== null) {
      return readStaticTruthiness(
        testTruthiness ? candidate.consequent : candidate.alternate,
        scopes,
        new Set(visitedSymbolIds),
      );
    }
    const consequentTruthiness = readStaticTruthiness(
      candidate.consequent,
      scopes,
      new Set(visitedSymbolIds),
    );
    const alternateTruthiness = readStaticTruthiness(
      candidate.alternate,
      scopes,
      new Set(visitedSymbolIds),
    );
    return consequentTruthiness !== null && consequentTruthiness === alternateTruthiness
      ? consequentTruthiness
      : null;
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    const leftTruthiness = readStaticTruthiness(candidate.left, scopes, new Set(visitedSymbolIds));
    if (candidate.operator === "&&" && leftTruthiness === false) return false;
    if (candidate.operator === "||" && leftTruthiness === true) return true;
    if (candidate.operator !== "&&" && candidate.operator !== "||") return null;
    const rightTruthiness = readStaticTruthiness(
      candidate.right,
      scopes,
      new Set(visitedSymbolIds),
    );
    if (leftTruthiness !== null) return rightTruthiness;
    if (candidate.operator === "&&" && rightTruthiness === false) return false;
    if (candidate.operator === "||" && rightTruthiness === true) return true;
    return null;
  }
  if (
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "ObjectExpression") ||
    isNodeOfType(candidate, "NewExpression") ||
    isNodeOfType(candidate, "ArrowFunctionExpression") ||
    isNodeOfType(candidate, "FunctionExpression")
  ) {
    return true;
  }
  return null;
};

const hasReachableNullishValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (isNodeOfType(expression, "ChainExpression")) return true;
  const candidate = stripParenExpression(expression);
  if (isDirectNullishExpression(candidate, scopes)) return true;
  if (
    (isNodeOfType(candidate, "MemberExpression") || isNodeOfType(candidate, "CallExpression")) &&
    candidate.optional === true
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasReachableNullishValue(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    const testTruthiness = readStaticTruthiness(candidate.test, scopes);
    if (testTruthiness === true) {
      return hasReachableNullishValue(candidate.consequent, scopes, visitedSymbolIds);
    }
    if (testTruthiness === false) {
      return hasReachableNullishValue(candidate.alternate, scopes, visitedSymbolIds);
    }
    return (
      hasReachableNullishValue(candidate.consequent, scopes, new Set(visitedSymbolIds)) ||
      hasReachableNullishValue(candidate.alternate, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    const leftTruthiness = readStaticTruthiness(candidate.left, scopes);
    if (candidate.operator === "&&") {
      if (leftTruthiness === false) {
        return hasReachableNullishValue(candidate.left, scopes, visitedSymbolIds);
      }
      if (leftTruthiness === true) {
        return hasReachableNullishValue(candidate.right, scopes, visitedSymbolIds);
      }
      return (
        hasReachableNullishValue(candidate.left, scopes, new Set(visitedSymbolIds)) ||
        hasReachableNullishValue(candidate.right, scopes, new Set(visitedSymbolIds))
      );
    }
    if (candidate.operator === "||") {
      if (leftTruthiness === true) return false;
      return hasReachableNullishValue(candidate.right, scopes, visitedSymbolIds);
    }
    if (candidate.operator === "??") {
      if (
        leftTruthiness !== null &&
        !hasReachableNullishValue(candidate.left, scopes, new Set(visitedSymbolIds))
      ) {
        return false;
      }
      return hasReachableNullishValue(candidate.right, scopes, visitedSymbolIds);
    }
    return false;
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some(
      (element) =>
        !element ||
        (!isNodeOfType(element, "SpreadElement") &&
          hasReachableNullishValue(element, scopes, new Set(visitedSymbolIds))),
    );
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    return candidate.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        hasReachableNullishValue(property.value, scopes, new Set(visitedSymbolIds)),
    );
  }
  return false;
};

const getLoaderInput = (node: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (isR3fApiCall(node, "useLoader", context.scopes)) {
    const input = node.arguments[1];
    return input && !isNodeOfType(input, "SpreadElement") ? input : null;
  }
  for (const hookName of DREI_CACHED_LOADER_HOOK_NAMES) {
    if (!isApiCallFromModules(node, hookName, DREI_PUBLIC_MODULES, context.scopes)) continue;
    const input = node.arguments[0];
    return input && !isNodeOfType(input, "SpreadElement") ? input : null;
  }
  return null;
};

export const r3fNoNullLoaderInput = defineRule({
  id: "r3f-no-null-loader-input",
  title: "Nullish R3F loader input",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Conditionally render a child component that calls the loader hook only after it has a real asset URL",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const loaderInput = getLoaderInput(node, context);
      if (!loaderInput || !hasReachableNullishValue(loaderInput, context.scopes)) return;
      context.report({
        node: loaderInput,
        message:
          "This loader input can be null or undefined, but R3F and Drei loader hooks forward asset identifiers to Three.js loaders instead of treating nullish values as a skip signal. Render the loading component conditionally",
      });
    },
  }),
});
