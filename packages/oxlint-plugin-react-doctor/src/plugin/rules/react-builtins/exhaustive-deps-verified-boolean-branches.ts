import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getNodeEndIndex } from "../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isBoundReactMethodCall } from "./exhaustive-deps-fresh-callback-coverage.js";

export interface RegisteredBooleanTarget {
  readonly dependencyOffset: number;
  readonly dependencyLength: number;
  readonly recordField: string;
  readonly booleanField: string;
  readonly bindingOffset: number;
}

const getPropFieldPath = (symbol: SymbolDescriptor, owner: EsTreeNode) => {
  const binding = symbol.bindingIdentifier;
  const property = binding.parent;
  const record = property?.parent;
  const recordProperty = record?.parent;
  const props = recordProperty?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== binding ||
    property.computed ||
    !isNodeOfType(record, "ObjectPattern") ||
    !isNodeOfType(recordProperty, "Property") ||
    recordProperty.value !== record ||
    recordProperty.computed ||
    !isNodeOfType(props, "ObjectPattern") ||
    !isFunctionLike(owner) ||
    owner.params[0] !== props ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return null;

  const recordField = getStaticPropertyKeyName(recordProperty);
  const booleanField = getStaticPropertyKeyName(property);
  const bindingOffset = getNodeStartIndex(binding);
  return recordField && booleanField && bindingOffset >= 0
    ? { recordField, booleanField, bindingOffset }
    : null;
};

export const getEffectBooleanShortCircuitTargets = (
  hook: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): ReadonlyMap<SymbolDescriptor, RegisteredBooleanTarget> => {
  const result = new Map<SymbolDescriptor, RegisteredBooleanTarget>();
  const [callback, dependencies] = hook.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !isBoundReactMethodCall(hook, "useEffect", scopes)
  )
    return result;

  const owner = findEnclosingFunction(hook);
  if (!owner) return result;
  const dependencyOffset = getNodeStartIndex(dependencies);
  const dependencyLength = getNodeEndIndex(dependencies) - dependencyOffset;
  if (dependencyOffset < 0 || dependencyLength <= 0) return result;

  for (const { identifier, resolvedSymbol } of closureCaptures(callback, scopes)) {
    const expression = identifier.parent;
    if (
      !resolvedSymbol ||
      result.has(resolvedSymbol) ||
      !isNodeOfType(expression, "LogicalExpression") ||
      expression.operator !== "&&" ||
      expression.left !== identifier
    )
      continue;

    const path = getPropFieldPath(resolvedSymbol, owner);
    if (path) result.set(resolvedSymbol, { ...path, dependencyOffset, dependencyLength });
  }
  return result;
};

export const isCaptureSkippedByVerifiedFalseProp = (
  identifier: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  falseBindings: ReadonlySet<SymbolDescriptor>,
): boolean => {
  const binding = scopes.symbolFor(identifier);
  if (binding && falseBindings.has(binding)) return true;

  for (let node = identifier; node !== callback && node.parent; node = node.parent) {
    const parent = node.parent;
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === node &&
      isNodeOfType(parent.left, "Identifier")
    ) {
      const guard = scopes.symbolFor(parent.left);
      if (guard && falseBindings.has(guard)) return true;
    }
  }
  return false;
};
