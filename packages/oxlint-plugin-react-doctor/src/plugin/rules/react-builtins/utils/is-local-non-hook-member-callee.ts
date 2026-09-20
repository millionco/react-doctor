import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../../constants/thresholds.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "../../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../../utils/has-symbol-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const containsHookCall = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (
    visitedFunctions.has(functionNode) ||
    visitedFunctions.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  ) {
    return true;
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(functionNode);
  let foundHook = false;
  walkAst(functionNode, (node) => {
    if (foundHook) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    const calleeName = isNodeOfType(callee, "Identifier")
      ? callee.name
      : isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
    const importedName = resolveImportedApiReference(node.callee, scopes)?.importedName;
    if (isReactHookName(calleeName ?? "") || (importedName && isReactHookName(importedName))) {
      foundHook = true;
      return false;
    }
    const localFunction = resolveExactLocalFunction(node.callee, scopes);
    if (localFunction && containsHookCall(localFunction, scopes, nextVisitedFunctions)) {
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
  return resolveExactLocalFunction(callee, scopes);
};

export const isLocalNonHookMemberCallee = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const localFunction = resolveLocalMemberFunction(callee, scopes);
  return Boolean(localFunction && !containsHookCall(localFunction, scopes));
};
