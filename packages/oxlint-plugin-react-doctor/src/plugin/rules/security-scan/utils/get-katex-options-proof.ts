import {
  OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
  REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
} from "../../../constants/mutation-methods.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getSymbolMutationInspector } from "./get-symbol-mutation-inspector.js";

export interface KatexOptionsProof {
  readonly isConclusive: boolean;
  readonly isSafe: boolean;
}

type KatexTrustState = "absent" | "trusted" | "unsupported" | "untrusted";

const parameterOptionsProofsByScopes = new WeakMap<
  ScopeAnalysis,
  ReadonlyMap<number, KatexOptionsProof>
>();

const isStaticallyDisabledTrustValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    return expression.name === "undefined" && scopes.isGlobalReference(expression);
  }
  return isNodeOfType(expression, "Literal") && !expression.value;
};

const getPropertyDescriptorValue = (node: EsTreeNode): EsTreeNode | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  for (const property of expression.properties) {
    if (
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "value"
    ) {
      return property.value;
    }
  }
  return null;
};

const applyTrustMutation = (
  currentState: KatexTrustState,
  eventNode: EsTreeNode,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): KatexTrustState => {
  const mutationInspector = getSymbolMutationInspector(scopes);
  const target = mutationInspector.getOutermostTarget(eventNode);
  const parent = target.parent;
  if (!parent) return "unsupported";
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === target) {
    if (!isNodeOfType(target, "MemberExpression")) return "unsupported";
    const propertyName = getStaticPropertyName(target);
    if (propertyName === null) return "trusted";
    if (propertyName !== "trust") return currentState;
    return isStaticallyDisabledTrustValue(parent.right, scopes) ? "untrusted" : "trusted";
  }
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete") {
    if (!isNodeOfType(target, "MemberExpression")) return "unsupported";
    const propertyName = getStaticPropertyName(target);
    if (propertyName === null) return "trusted";
    return propertyName === "trust" ? "absent" : currentState;
  }
  if (isNodeOfType(parent, "UpdateExpression")) {
    if (!isNodeOfType(target, "MemberExpression")) return "unsupported";
    const propertyName = getStaticPropertyName(target);
    return propertyName === "trust" || propertyName === null ? "trusted" : currentState;
  }
  if (!isNodeOfType(parent, "CallExpression") || parent.arguments[0] !== target) {
    return "unsupported";
  }
  if (
    mutationInspector.isGlobalNamespaceMethod(
      parent.callee,
      "Object",
      OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
    )
  ) {
    const callee = stripParenExpression(parent.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return "unsupported";
    const methodName = getStaticPropertyName(callee);
    if (methodName === "assign") {
      let nextState = currentState;
      for (const source of parent.arguments.slice(1)) {
        const sourceState = getKatexOptionsTrustState(
          source,
          usageNode,
          scopes,
          new Set(visitedSymbolIds),
        );
        if (sourceState !== "absent") nextState = sourceState;
      }
      return nextState;
    }
    const propertyKey = parent.arguments[1];
    if (
      !propertyKey ||
      !isNodeOfType(propertyKey, "Literal") ||
      typeof propertyKey.value !== "string"
    ) {
      return "trusted";
    }
    if (propertyKey.value !== "trust") return currentState;
    const propertyDescriptor = parent.arguments[2];
    if (!propertyDescriptor) return "unsupported";
    const propertyValue = getPropertyDescriptorValue(propertyDescriptor);
    return propertyValue === null || isStaticallyDisabledTrustValue(propertyValue, scopes)
      ? "untrusted"
      : "trusted";
  }
  if (
    mutationInspector.isGlobalNamespaceMethod(
      parent.callee,
      "Reflect",
      REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
    )
  ) {
    const propertyKey = parent.arguments[1];
    if (
      !propertyKey ||
      !isNodeOfType(propertyKey, "Literal") ||
      typeof propertyKey.value !== "string"
    ) {
      return "trusted";
    }
    if (propertyKey.value !== "trust") return currentState;
    const propertyValue = parent.arguments[2];
    return propertyValue && isStaticallyDisabledTrustValue(propertyValue, scopes)
      ? "untrusted"
      : "trusted";
  }
  return "unsupported";
};

const getKatexOptionsTrustState = (
  rawNode: EsTreeNode | undefined,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): KatexTrustState => {
  if (rawNode === undefined) return "absent";
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Identifier")) {
    if (node.name === "undefined" && scopes.isGlobalReference(node)) return "absent";
    const symbol = resolveConstIdentifierAlias(node, scopes);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return "unsupported";
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    const mutationInspector = getSymbolMutationInspector(scopes);
    if (mutationInspector.isMutationOrderAmbiguous(symbol, usageNode, "trust")) {
      return "unsupported";
    }
    let trustState = getKatexOptionsTrustState(
      symbol.initializer,
      usageNode,
      scopes,
      nextVisitedSymbolIds,
    );
    for (const replayedEvent of mutationInspector.getEventsBefore(symbol, usageNode)) {
      const nextTrustState = applyTrustMutation(
        trustState,
        replayedEvent.node,
        usageNode,
        scopes,
        nextVisitedSymbolIds,
      );
      if (replayedEvent.isConditional) {
        if (nextTrustState !== trustState) trustState = "unsupported";
      } else {
        trustState = nextTrustState;
      }
    }
    return trustState;
  }
  if (!isNodeOfType(node, "ObjectExpression")) return "unsupported";

  let trustState: KatexTrustState = "absent";
  for (const property of node.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      const spreadState = getKatexOptionsTrustState(
        property.argument,
        usageNode,
        scopes,
        new Set(visitedSymbolIds),
      );
      if (spreadState !== "absent") {
        trustState = spreadState === "unsupported" ? "trusted" : spreadState;
      }
      continue;
    }
    if (!isNodeOfType(property, "Property")) {
      trustState = "trusted";
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) {
      trustState = "trusted";
      continue;
    }
    if (propertyName === "trust") {
      trustState = isStaticallyDisabledTrustValue(property.value, scopes) ? "untrusted" : "trusted";
    }
  }
  return trustState;
};

export const setKatexParameterOptionsProofs = (
  scopes: ScopeAnalysis,
  proofs: ReadonlyMap<number, KatexOptionsProof>,
): void => {
  parameterOptionsProofsByScopes.set(scopes, proofs);
};

export const getKatexOptionsProof = (
  rawNode: EsTreeNode | undefined,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): KatexOptionsProof => {
  const node = rawNode ? stripParenExpression(rawNode) : undefined;
  if (node && isNodeOfType(node, "Identifier")) {
    const parameterSymbol = scopes.referenceFor(node)?.resolvedSymbol;
    const parameterProof = parameterSymbol
      ? parameterOptionsProofsByScopes.get(scopes)?.get(parameterSymbol.id)
      : undefined;
    if (parameterProof) return parameterProof;
  }
  const trustState = getKatexOptionsTrustState(rawNode, usageNode, scopes, visitedSymbolIds);
  return {
    isConclusive: trustState !== "unsupported",
    isSafe: trustState === "absent" || trustState === "untrusted",
  };
};
