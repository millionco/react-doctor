import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isInsideRepeatedExecution } from "./is-inside-repeated-execution.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const POSITION_BUFFER_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "setX",
  "setXY",
  "setXYZ",
  "setXYZW",
  "setY",
  "setZ",
]);
const POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "copyWithin",
  "fill",
  "set",
]);

export const resolvesToPositionBufferAttribute = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  managedPositionBufferRefSymbolIds: ReadonlySet<number> = new Set(),
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  const refSymbol = resolveReactRefSymbol(candidate, scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
  if (refSymbol && managedPositionBufferRefSymbolIds.has(refSymbol.id)) return true;
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    const attributeName = candidate.arguments[0];
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "getAttribute" &&
      isNodeOfType(attributeName, "Literal") &&
      attributeName.value === "position",
    );
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    if (getStaticPropertyName(candidate) !== "position") return false;
    const attributes = stripParenExpression(candidate.object);
    return Boolean(
      isNodeOfType(attributes, "MemberExpression") &&
      getStaticPropertyName(attributes) === "attributes",
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
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
  return resolvesToPositionBufferAttribute(
    symbol.initializer,
    scopes,
    managedPositionBufferRefSymbolIds,
    visitedSymbolIds,
  );
};

const resolvesToPositionBufferArray = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  managedPositionBufferRefSymbolIds: ReadonlySet<number>,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression") && getStaticPropertyName(candidate) === "array") {
    return resolvesToPositionBufferAttribute(
      candidate.object,
      scopes,
      managedPositionBufferRefSymbolIds,
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
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
  return resolvesToPositionBufferArray(
    symbol.initializer,
    scopes,
    managedPositionBufferRefSymbolIds,
    visitedSymbolIds,
  );
};

const isRepeatedPositionBufferMutation = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  managedPositionBufferRefSymbolIds: ReadonlySet<number>,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    !POSITION_BUFFER_MUTATION_METHOD_NAMES.has(getStaticPropertyName(node.callee) ?? "") ||
    !resolvesToPositionBufferAttribute(
      node.callee.object,
      scopes,
      managedPositionBufferRefSymbolIds,
    )
  ) {
    return false;
  }
  return isInsideRepeatedExecution(node);
};

const isPositionBufferArrayElement = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  managedPositionBufferRefSymbolIds: ReadonlySet<number>,
): boolean => {
  const candidate = stripParenExpression(node);
  return Boolean(
    isNodeOfType(candidate, "MemberExpression") &&
    candidate.computed &&
    resolvesToPositionBufferArray(candidate.object, scopes, managedPositionBufferRefSymbolIds),
  );
};

const isPositionBufferArrayMutation = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  managedPositionBufferRefSymbolIds: ReadonlySet<number>,
): boolean => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    return (
      isPositionBufferArrayElement(node.left, scopes, managedPositionBufferRefSymbolIds) &&
      isInsideRepeatedExecution(node)
    );
  }
  if (isNodeOfType(node, "UpdateExpression")) {
    return (
      isPositionBufferArrayElement(node.argument, scopes, managedPositionBufferRefSymbolIds) &&
      isInsideRepeatedExecution(node)
    );
  }
  return Boolean(
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES.has(getStaticPropertyName(node.callee) ?? "") &&
    resolvesToPositionBufferArray(node.callee.object, scopes, managedPositionBufferRefSymbolIds),
  );
};

export const findRepeatedPositionBufferMutations = (
  callback: EsTreeNode,
  context: RuleContext,
  managedPositionBufferRefSymbolIds: ReadonlySet<number> = new Set(),
  includeConditionallyExecuted = true,
): ReadonlyArray<EsTreeNode> => {
  const mutations = new Set<EsTreeNode>();
  walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
    if (!includeConditionallyExecuted && isConditionallyExecuted) return;
    if (
      isRepeatedPositionBufferMutation(
        candidate,
        context.scopes,
        managedPositionBufferRefSymbolIds,
      ) ||
      isPositionBufferArrayMutation(candidate, context.scopes, managedPositionBufferRefSymbolIds)
    ) {
      mutations.add(candidate);
    }
  });
  return [...mutations];
};

export const callbackMarksPositionBufferForUpdate = (
  callback: EsTreeNode,
  context: RuleContext,
  managedPositionBufferRefSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  let marksPositionBufferForUpdate = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (
      marksPositionBufferForUpdate ||
      !isNodeOfType(candidate, "AssignmentExpression") ||
      candidate.operator !== "=" ||
      readStaticBoolean(candidate.right) !== true
    ) {
      return;
    }
    const target = stripParenExpression(candidate.left);
    if (
      isNodeOfType(target, "MemberExpression") &&
      getStaticPropertyName(target) === "needsUpdate" &&
      resolvesToPositionBufferAttribute(
        target.object,
        context.scopes,
        managedPositionBufferRefSymbolIds,
      )
    ) {
      marksPositionBufferForUpdate = true;
    }
  });
  return marksPositionBufferForUpdate;
};
