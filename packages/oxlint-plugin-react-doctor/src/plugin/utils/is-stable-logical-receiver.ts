import { findEnclosingFunction } from "./find-enclosing-function.js";
import { GLOBAL_RELEASE_METHOD_NAMES } from "../constants/react.js";
import { BOUND_RESOURCE_RELEASE_METHOD_NAMES } from "../constants/react.js";
import { SUBSCRIPTION_METHOD_NAMES } from "../constants/react.js";
import { REACT_COMPILER_EFFECT_HOOK_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookCall } from "./is-react-hook-call.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";

const stableReferencesByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean | null>>();

const hasSafeReceiverResultUse = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  checkedSymbolIds: Map<string, boolean | null>,
  allowCleanupResult = false,
): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  if (isWithinAssignmentTarget(expressionRoot)) return false;
  const parent = expressionRoot.parent;
  if (allowCleanupResult) {
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === expressionRoot &&
      parent.arguments.length === 0
    )
      return true;
    const returnOwner = isNodeOfType(parent, "ReturnStatement")
      ? findEnclosingFunction(parent)
      : isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expressionRoot
        ? isNodeOfType(parent.parent, "ReturnStatement")
          ? findEnclosingFunction(parent.parent)
          : parent
        : null;
    const callbackRoot = returnOwner ? findTransparentExpressionRoot(returnOwner) : null;
    const effectCall = callbackRoot?.parent;
    if (
      isNodeOfType(effectCall, "CallExpression") &&
      effectCall.arguments[0] === callbackRoot &&
      isReactHookCall(effectCall, REACT_COMPILER_EFFECT_HOOK_NAMES, scopes)
    )
      return true;
  }
  if (isNodeOfType(parent, "LogicalExpression")) {
    return hasSafeReceiverResultUse(parent, scopes, checkedSymbolIds, allowCleanupResult);
  }
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expressionRoot) {
    const memberRoot = findTransparentExpressionRoot(parent);
    const call = memberRoot.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== memberRoot) {
      return hasSafeReceiverResultUse(memberRoot, scopes, checkedSymbolIds, allowCleanupResult);
    }
    const methodName = getStaticPropertyName(parent);
    const isResourceLifecycleResult =
      methodName !== null &&
      (SUBSCRIPTION_METHOD_NAMES.has(methodName) ||
        GLOBAL_RELEASE_METHOD_NAMES.has(methodName) ||
        BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(methodName));
    return hasSafeReceiverResultUse(
      call,
      scopes,
      checkedSymbolIds,
      allowCleanupResult || isResourceLifecycleResult,
    );
  }
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expressionRoot &&
    isNodeOfType(parent.id, "Identifier") &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const"
  ) {
    return (
      isNodeOfType(expressionRoot, "Identifier") ||
      hasStableReceiverReferences(parent.id, scopes, checkedSymbolIds, allowCleanupResult)
    );
  }
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    (parent.operator === "!" || parent.operator === "typeof" || parent.operator === "void")
  )
    return true;
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    (parent.operator === "===" || parent.operator === "!==")
  )
    return true;
  if (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
    parent.test === expressionRoot
  )
    return true;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "ArrayExpression")) {
    const hookCall = parent.parent;
    if (
      isNodeOfType(hookCall, "CallExpression") &&
      isReactHookCall(hookCall, REACT_COMPILER_EFFECT_HOOK_NAMES, scopes)
    ) {
      const [, dependenciesArgument] = hookCall.arguments;
      return dependenciesArgument === parent;
    }
  }
  return false;
};

const hasStableReceiverReferences = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
  checkedSymbolIds: Map<string, boolean | null>,
  allowCleanupResult = false,
): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbols = getEquivalentSymbols(receiver, scopes);
  if (symbols.length === 0) return false;
  const existingProofs = symbols.filter((symbol) =>
    checkedSymbolIds.has(`${symbol.id}:${allowCleanupResult}`),
  );
  if (existingProofs.length > 0) {
    return existingProofs.every(
      (symbol) => checkedSymbolIds.get(`${symbol.id}:${allowCleanupResult}`) === true,
    );
  }
  for (const symbol of symbols) checkedSymbolIds.set(`${symbol.id}:${allowCleanupResult}`, null);
  const hasStableReferences = symbols.every((symbol) =>
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        hasSafeReceiverResultUse(
          reference.identifier,
          scopes,
          checkedSymbolIds,
          allowCleanupResult,
        ),
    ),
  );
  for (const symbol of symbols)
    checkedSymbolIds.set(`${symbol.id}:${allowCleanupResult}`, hasStableReferences);
  return hasStableReferences;
};

export const isStableLogicalReceiver = (receiver: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let checkedSymbolIds = stableReferencesByAnalysis.get(scopes);
  if (!checkedSymbolIds) {
    checkedSymbolIds = new Map();
    stableReferencesByAnalysis.set(scopes, checkedSymbolIds);
  }
  return hasStableReceiverReferences(receiver, scopes, checkedSymbolIds);
};
