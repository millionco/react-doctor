import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../../constants/thresholds.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "../../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../../utils/has-symbol-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isHookFreeIntrinsicCall } from "./is-hook-free-intrinsic-call.js";

const resolveArgument = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  bindings: ReadonlyMap<number, EsTreeNode | null>,
  visitedSymbols = new Set<number>(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier") || isReactHookName(candidate.name)) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    visitedSymbols.has(symbol.id) ||
    visitedSymbols.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  )
    return candidate;
  if (symbol.references.some((reference) => reference.flag !== "read")) return candidate;
  if (bindings.has(symbol.id)) return bindings.get(symbol.id) ?? null;
  if (symbol.kind !== "const" || !symbol.initializer) return candidate;
  return resolveArgument(
    symbol.initializer,
    scopes,
    bindings,
    new Set(visitedSymbols).add(symbol.id),
  );
};

const resolveDirectLocalFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const candidate = isNodeOfType(expression, "CallExpression")
    ? stripParenExpression(expression.callee)
    : expression;
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    ["bind", "call", "apply"].includes(getStaticPropertyName(candidate) ?? "")
  )
    return null;
  return resolveExactLocalFunction(expression, scopes);
};

const mayInvokeHook = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  argumentsList: readonly EsTreeNode[] = [],
  bindings: ReadonlyMap<number, EsTreeNode | null> = new Map(),
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (
    visitedFunctions.has(functionNode) ||
    visitedFunctions.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  ) {
    return true;
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(functionNode);
  const localBindings = new Map(bindings);
  if (
    isFunctionLike(functionNode) &&
    !argumentsList.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    for (const [index, parameter] of functionNode.params.entries()) {
      if (!isNodeOfType(parameter, "Identifier")) continue;
      const symbol = scopes.symbolFor(parameter);
      if (!symbol) continue;
      const argument = argumentsList[index];
      localBindings.set(symbol.id, argument ? resolveArgument(argument, scopes, bindings) : null);
    }
  }
  let foundHook = false;
  walkAst(functionNode, (node) => {
    if (foundHook) return false;
    if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "AssignmentPattern")) return;
    const expression = isNodeOfType(node, "CallExpression") ? node.callee : node.right;
    const callee = resolveArgument(expression, scopes, localBindings);
    if (!callee || isNodeOfType(callee, "Literal")) return;
    const calleeName = isNodeOfType(callee, "Identifier")
      ? callee.name
      : isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
    const importedName = resolveImportedApiReference(callee, scopes)?.importedName;
    if (isReactHookName(calleeName ?? "") || (importedName && isReactHookName(importedName))) {
      foundHook = true;
      return false;
    }
    const localFunction = resolveDirectLocalFunction(callee, scopes);
    const callArguments = isNodeOfType(node, "CallExpression") ? node.arguments : [];
    if (
      localFunction
        ? mayInvokeHook(localFunction, scopes, callArguments, localBindings, nextVisitedFunctions)
        : isNodeOfType(node, "CallExpression") &&
          !isHookFreeIntrinsicCall(node, scopes, (callback) => {
            const resolvedCallback = resolveArgument(callback, scopes, localBindings);
            if (!resolvedCallback) return true;
            const callbackFunction = resolveDirectLocalFunction(resolvedCallback, scopes);
            return Boolean(
              callbackFunction &&
              isFunctionLike(callbackFunction) &&
              callbackFunction.params.length === 0 &&
              !mayInvokeHook(callbackFunction, scopes, [], localBindings, nextVisitedFunctions),
            );
          })
    ) {
      foundHook = true;
      return false;
    }
  });
  return foundHook;
};

const resolveLocalMemberFunction = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(callee);
  const receiver = stripParenExpression(callee.object);
  const symbol = resolveConstIdentifierAlias(receiver, scopes);
  if (
    !propertyName ||
    !symbol?.initializer ||
    symbol.kind !== "const" ||
    hasSymbolWriteBefore(symbol, callee, scopes) ||
    hasPossibleStaticPropertyWrite(receiver, propertyName, scopes)
  ) {
    return null;
  }
  const propertyValue = getStaticObjectPropertyValue(symbol.initializer, propertyName);
  if (!propertyValue) return null;
  const resolvedValue = resolveArgument(propertyValue, scopes, new Map());
  if (!resolvedValue || !resolveDirectLocalFunction(resolvedValue, scopes)) return null;
  return resolveExactLocalFunction(callee, scopes);
};

export const isLocalNonHookMemberCallee = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  const localFunction = resolveLocalMemberFunction(callee, scopes);
  return Boolean(localFunction && !mayInvokeHook(localFunction, scopes, call.arguments));
};
