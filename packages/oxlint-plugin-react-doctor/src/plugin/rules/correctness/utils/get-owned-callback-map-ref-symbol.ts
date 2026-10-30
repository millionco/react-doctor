import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isDescendantScope } from "../../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { NO_VALUE_COUNT, SINGLE_VALUE_COUNT } from "./callback-map-snapshot/constants.js";
import { isRuntimeGlobalReference } from "./has-supported-callback-map-program.js";
import { isReadonlyCallbackMapSymbol as isReadonly } from "./is-readonly-callback-map-symbol.js";

export const getOwnedCallbackMapRefSymbol = (
  current: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (
    !isNodeOfType(current, "MemberExpression") ||
    current.optional ||
    current.computed ||
    !isNodeOfType(current.object, "Identifier") ||
    !isNodeOfType(current.property, "Identifier") ||
    current.property.name !== "current"
  )
    return null;
  const refSymbol = resolveReactRefSymbol(current, scopes, { allowUnboundBareCalls: false });
  if (
    !refSymbol ||
    scopes.symbolFor(current.object) !== refSymbol ||
    refSymbol.kind !== "const" ||
    !isReadonly(refSymbol) ||
    !isNodeOfType(refSymbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(refSymbol.declarationNode.id, "Identifier") ||
    !refSymbol.initializer
  )
    return null;
  const owner = findEnclosingFunction(refSymbol.declarationNode);
  const ownerScope = owner && scopes.ownScopeFor(owner);
  if (
    !ownerScope ||
    owner === callback ||
    !isDescendantScope(scopes.scopeFor(callback), ownerScope)
  )
    return null;
  const initializer = stripParenExpression(refSymbol.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== SINGLE_VALUE_COUNT ||
    !isReactApiCall(initializer, "useRef", scopes, {
      allowGlobalReactNamespace: false,
      allowUnboundBareCalls: false,
    })
  )
    return null;
  const allocation = stripParenExpression(initializer.arguments[NO_VALUE_COUNT]);
  if (
    !isNodeOfType(allocation, "NewExpression") ||
    !isNodeOfType(allocation.callee, "Identifier") ||
    allocation.callee.name !== "Map" ||
    allocation.arguments.length !== NO_VALUE_COUNT
  )
    return null;
  if (!isRuntimeGlobalReference(allocation.callee, scopes)) return null;
  return refSymbol;
};
