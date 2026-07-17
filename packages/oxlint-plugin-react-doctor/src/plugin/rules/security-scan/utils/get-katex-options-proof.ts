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

const getStaticObjectPropertyValue = (
  node: EsTreeNode,
  expectedPropertyName: string,
): EsTreeNode | null | undefined => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  let propertyValue: EsTreeNode | undefined;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return null;
    if (propertyName !== expectedPropertyName) continue;
    if (property.kind !== "init") return null;
    propertyValue = property.value;
  }
  return propertyValue;
};

const getPropertyDescriptorValue = (node: EsTreeNode): EsTreeNode | null | undefined => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null || propertyName === "get" || propertyName === "set") return null;
  }
  return getStaticObjectPropertyValue(expression, "value");
};

const getTrustStateAfterPropertyDescriptor = (
  currentState: KatexTrustState,
  propertyDescriptor: EsTreeNode,
  scopes: ScopeAnalysis,
): KatexTrustState => {
  const propertyValue = getPropertyDescriptorValue(propertyDescriptor);
  if (propertyValue === null) return "trusted";
  if (propertyValue === undefined) return currentState;
  return isStaticallyDisabledTrustValue(propertyValue, scopes) ? "untrusted" : "trusted";
};

const mergeConditionalTrustStates = (
  currentState: KatexTrustState,
  conditionalState: KatexTrustState,
): KatexTrustState => {
  if (currentState === conditionalState) return currentState;
  if (currentState === "trusted" || conditionalState === "trusted") return "trusted";
  if (currentState === "unsupported" || conditionalState === "unsupported") return "unsupported";
  return "untrusted";
};

const applyTrustMutation = (
  currentState: KatexTrustState,
  eventNode: EsTreeNode,
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
          source,
          scopes,
          new Set(visitedSymbolIds),
        );
        if (sourceState !== "absent") nextState = sourceState;
      }
      return nextState;
    }
    if (methodName === "defineProperties") {
      const propertyDescriptors = parent.arguments[1];
      if (!propertyDescriptors) return "unsupported";
      const trustDescriptor = getStaticObjectPropertyValue(propertyDescriptors, "trust");
      if (trustDescriptor === null) return "trusted";
      if (trustDescriptor === undefined) return currentState;
      return getTrustStateAfterPropertyDescriptor(currentState, trustDescriptor, scopes);
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
    return getTrustStateAfterPropertyDescriptor(currentState, propertyDescriptor, scopes);
  }
  if (
    mutationInspector.isGlobalNamespaceMethod(
      parent.callee,
      "Reflect",
      REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
    )
  ) {
    const callee = stripParenExpression(parent.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return "unsupported";
    const methodName = getStaticPropertyName(callee);
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
    if (!propertyValue) return "unsupported";
    if (methodName === "defineProperty") {
      return getTrustStateAfterPropertyDescriptor(currentState, propertyValue, scopes);
    }
    return isStaticallyDisabledTrustValue(propertyValue, scopes) ? "untrusted" : "trusted";
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
        scopes,
        nextVisitedSymbolIds,
      );
      if (replayedEvent.isConditional) {
        trustState = mergeConditionalTrustStates(trustState, nextTrustState);
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
        property.argument,
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
