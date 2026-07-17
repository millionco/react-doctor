import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const STATE_HOOKS = new Set(["useState", "useReducer"]);
const VALUE_CHANGE_OPERATORS = new Set(["!==", "!=", "===", "=="]);

const isPrimitiveComparisonBoundary = (node: EsTreeNode): boolean => {
  const candidate = stripParenExpression(node);
  return (
    isNodeOfType(candidate, "Literal") ||
    (isNodeOfType(candidate, "Identifier") &&
      (candidate.name === "undefined" || candidate.name === "NaN" || candidate.name === "Infinity"))
  );
};

const branchGuaranteesValueChange = (
  test: EsTreeNode,
  didTestPass: boolean,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(test);
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    VALUE_CHANGE_OPERATORS.has(candidate.operator) &&
    !isPrimitiveComparisonBoundary(candidate.left) &&
    !isPrimitiveComparisonBoundary(candidate.right)
  ) {
    const isInequality = candidate.operator === "!==" || candidate.operator === "!=";
    return didTestPass === isInequality;
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return branchGuaranteesValueChange(candidate.argument, !didTestPass, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    const leftGuarantees = branchGuaranteesValueChange(
      candidate.left,
      didTestPass,
      scopes,
      new Set(visitedSymbolIds),
    );
    const rightGuarantees = branchGuaranteesValueChange(
      candidate.right,
      didTestPass,
      scopes,
      new Set(visitedSymbolIds),
    );
    const requiresEveryOperand = (candidate.operator === "&&") !== didTestPass;
    return requiresEveryOperand
      ? leftGuarantees && rightGuarantees
      : leftGuarantees || rightGuarantees;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return branchGuaranteesValueChange(symbol.initializer, didTestPass, scopes, visitedSymbolIds);
};

const isGuardedStateTransition = (
  setterCall: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let currentChild = setterCall;
  let currentAncestor = setterCall.parent;
  while (currentAncestor && currentAncestor !== callback) {
    if (isNodeOfType(currentAncestor, "CatchClause")) return true;
    if (isNodeOfType(currentAncestor, "IfStatement")) {
      const didTestPass =
        currentAncestor.consequent === currentChild
          ? true
          : currentAncestor.alternate === currentChild
            ? false
            : null;
      if (
        didTestPass !== null &&
        branchGuaranteesValueChange(currentAncestor.test, didTestPass, scopes)
      ) {
        return true;
      }
    }
    if (isNodeOfType(currentAncestor, "ConditionalExpression")) {
      const didTestPass =
        currentAncestor.consequent === currentChild
          ? true
          : currentAncestor.alternate === currentChild
            ? false
            : null;
      if (
        didTestPass !== null &&
        branchGuaranteesValueChange(currentAncestor.test, didTestPass, scopes)
      ) {
        return true;
      }
    }
    if (
      isNodeOfType(currentAncestor, "LogicalExpression") &&
      currentAncestor.right === currentChild &&
      (currentAncestor.operator === "&&" || currentAncestor.operator === "||") &&
      branchGuaranteesValueChange(currentAncestor.left, currentAncestor.operator === "&&", scopes)
    ) {
      return true;
    }
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent;
  }
  return false;
};

export const r3fNoStateInUseFrame = defineRule({
  id: "r3f-no-state-in-use-frame",
  title: "React state update inside useFrame",
  severity: "warn",
  recommendation:
    "Mutate Three.js refs or an external transient store inside useFrame; reserve React state for guarded, infrequent transitions",
  create: (context: RuleContext) => {
    const isStateSetterIdentifier = (identifier: EsTreeNode): boolean => {
      const visitedSymbolIds = new Set<number>();
      let symbol = context.scopes.symbolFor(identifier);
      while (symbol && !visitedSymbolIds.has(symbol.id)) {
        visitedSymbolIds.add(symbol.id);
        const declaration = symbol.declarationNode;
        if (
          isNodeOfType(declaration, "VariableDeclarator") &&
          declaration.init &&
          isNodeOfType(declaration.id, "ArrayPattern") &&
          declaration.id.elements[1] === symbol.bindingIdentifier &&
          isReactApiCall(declaration.init, STATE_HOOKS, context.scopes, {
            resolveNamedAliases: true,
          })
        ) {
          return true;
        }
        if (
          symbol.kind !== "const" ||
          !symbol.initializer ||
          !isNodeOfType(symbol.initializer, "Identifier") ||
          !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
          symbol.declarationNode.id !== symbol.bindingIdentifier
        ) {
          return false;
        }
        symbol = context.scopes.symbolFor(symbol.initializer);
      }
      return false;
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback) return;
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "Identifier")
          ) {
            return;
          }
          if (
            !isStateSetterIdentifier(candidate.callee) ||
            isGuardedStateTransition(candidate, callback, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This React state update can schedule a component render every frame. Mutate a Three.js ref or transient store, or guard an infrequent state transition",
          });
        });
      },
    };
  },
});
