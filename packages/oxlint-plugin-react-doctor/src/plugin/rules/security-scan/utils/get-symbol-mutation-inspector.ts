import {
  OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
  REFLECT_PROPERTY_MUTATION_METHOD_NAMES,
} from "../../../constants/mutation-methods.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface MutationEvent {
  readonly node: EsTreeNode;
  readonly owner: EsTreeNode;
  readonly propertyNames: ReadonlySet<string> | null;
}

interface LocalCallEvent {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode;
  readonly targetOwner: EsTreeNode;
}

interface ReplayedSymbolMutation {
  readonly isConditional: boolean;
  readonly node: EsTreeNode;
}

interface SymbolMutationInspector {
  readonly getEventsBefore: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
  ) => ReplayedSymbolMutation[];
  readonly getOutermostTarget: (node: EsTreeNode) => EsTreeNode;
  readonly isGlobalNamespaceMethod: (
    node: EsTreeNode,
    namespaceName: string,
    methodNames: ReadonlySet<string>,
  ) => boolean;
  readonly isExecutionOrderAmbiguous: (usageNode: EsTreeNode) => boolean;
  readonly isMutationOrderAmbiguous: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ) => boolean;
  readonly isMutatedBefore: (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ) => boolean;
}

const inspectorCache = new WeakMap<ScopeAnalysis, SymbolMutationInspector>();

const getOutermostTarget = (node: EsTreeNode): EsTreeNode => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const parent = current.parent;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== current) break;
    current = findTransparentExpressionRoot(parent);
  }
  return current;
};

const getExecutionOwner = (node: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current) || isNodeOfType(current, "Program")) return current;
    current = current.parent;
  }
  return node;
};

const isInsideStaticallyUnreachableBranch = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === current) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && isNodeOfType(parent.test, "Literal")) {
      if (parent.test.value === false && parent.consequent === current) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.right === current &&
      isNodeOfType(parent.left, "Literal")
    ) {
      if (parent.operator === "&&" && !parent.left.value) return true;
      if (parent.operator === "||" && Boolean(parent.left.value)) return true;
    }
    current = parent;
  }
  return false;
};

const isConditionallyExecuted = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let current = node;
  while (current.parent && current !== owner) {
    const parent = current.parent;
    if (isNodeOfType(parent, "IfStatement")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (!isNodeOfType(parent.test, "Literal")) return true;
      if (parent.test.value === true && parent.alternate === current) return true;
      if (parent.test.value === false && parent.consequent === current) return true;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      if (!isNodeOfType(parent.left, "Literal")) return true;
      if (parent.operator === "&&" && !parent.left.value) return true;
      if (parent.operator === "||" && Boolean(parent.left.value)) return true;
    }
    if (
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ForInStatement") ||
      isNodeOfType(parent, "ForOfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "SwitchCase") ||
      isNodeOfType(parent, "CatchClause")
    ) {
      return true;
    }
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "MemberExpression")) &&
      parent.optional
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

export const getSymbolMutationInspector = (scopes: ScopeAnalysis): SymbolMutationInspector => {
  const cached = inspectorCache.get(scopes);
  if (cached) return cached;

  const isGlobalNamespaceMethod = (
    node: EsTreeNode,
    namespaceName: string,
    methodNames: ReadonlySet<string>,
  ): boolean => {
    const callee = stripParenExpression(node);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const receiver = stripParenExpression(callee.object);
    return Boolean(
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === namespaceName &&
      scopes.isGlobalReference(receiver) &&
      methodNames.has(getStaticPropertyName(callee) ?? ""),
    );
  };

  const getObjectExpressionPropertyNames = (node: EsTreeNode): ReadonlySet<string> | null => {
    const expression = stripParenExpression(node);
    if (!isNodeOfType(expression, "ObjectExpression")) return null;
    const propertyNames = new Set<string>();
    for (const property of expression.properties) {
      if (!isNodeOfType(property, "Property")) return null;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null) return null;
      propertyNames.add(propertyName);
    }
    return propertyNames;
  };

  const getMutationPropertyNames = (node: EsTreeNode): ReadonlySet<string> | null | undefined => {
    const target = getOutermostTarget(node);
    const parent = target.parent;
    if (!parent) return undefined;
    if (
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === target) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === target) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete")
    ) {
      if (!isNodeOfType(target, "MemberExpression")) return null;
      const propertyName = getStaticPropertyName(target);
      return propertyName === null ? null : new Set([propertyName]);
    }
    if (!isNodeOfType(parent, "CallExpression") || parent.arguments[0] !== target) return undefined;
    if (isGlobalNamespaceMethod(parent.callee, "Object", OBJECT_PROPERTY_MUTATION_METHOD_NAMES)) {
      const callee = stripParenExpression(parent.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return undefined;
      const methodName = getStaticPropertyName(callee);
      if (methodName === "assign") {
        const assignedProperties = parent.arguments.slice(1).map(getObjectExpressionPropertyNames);
        if (assignedProperties.some((properties) => properties === null)) return null;
        return new Set(assignedProperties.flatMap((properties) => [...(properties ?? [])]));
      }
      const propertyKey = parent.arguments[1];
      return propertyKey &&
        isNodeOfType(propertyKey, "Literal") &&
        typeof propertyKey.value === "string"
        ? new Set([propertyKey.value])
        : null;
    }
    if (isGlobalNamespaceMethod(parent.callee, "Reflect", REFLECT_PROPERTY_MUTATION_METHOD_NAMES)) {
      const propertyKey = parent.arguments[1];
      return propertyKey &&
        isNodeOfType(propertyKey, "Literal") &&
        typeof propertyKey.value === "string"
        ? new Set([propertyKey.value])
        : null;
    }
    return undefined;
  };

  const getLocalCallTarget = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
    const callee = stripParenExpression(call.callee);
    if (isFunctionLike(callee)) return callee;
    if (!isNodeOfType(callee, "Identifier")) return null;
    const symbol = resolveConstIdentifierAlias(callee, scopes);
    if (!symbol) return null;
    if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode)) {
      return symbol.declarationNode;
    }
    if (symbol.kind !== "const" || !symbol.initializer) return null;
    const initializer = stripParenExpression(symbol.initializer);
    return isFunctionLike(initializer) ? initializer : null;
  };

  const calls: LocalCallEvent[] = [];
  const eventsBySymbolId = new Map<number, MutationEvent[]>();
  walkAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "CallExpression")) {
      const owner = getExecutionOwner(node);
      const targetOwner = getLocalCallTarget(node);
      if (targetOwner && !isInsideStaticallyUnreachableBranch(node, owner)) {
        calls.push({ call: node, owner, targetOwner });
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const propertyNames = getMutationPropertyNames(node);
    if (propertyNames === undefined) return;
    const symbol = resolveConstIdentifierAlias(node, scopes);
    if (!symbol) return;
    const owner = getExecutionOwner(node);
    if (isInsideStaticallyUnreachableBranch(node, owner)) return;
    const events = eventsBySymbolId.get(symbol.id) ?? [];
    events.push({ node, owner, propertyNames });
    eventsBySymbolId.set(symbol.id, events);
  });
  const getInvokedOwnersBefore = (checkpoint: EsTreeNode): Set<EsTreeNode> => {
    const checkpointOwner = getExecutionOwner(checkpoint);
    const checkpointStartIndex = getNodeStartIndex(checkpoint);
    const invokedOwners = new Set<EsTreeNode>();
    const visitOwner = (owner: EsTreeNode, cutoffIndex: number): void => {
      for (const call of calls) {
        if (call.owner !== owner || getNodeStartIndex(call.call) >= cutoffIndex) continue;
        if (invokedOwners.has(call.targetOwner)) continue;
        invokedOwners.add(call.targetOwner);
        visitOwner(call.targetOwner, Number.POSITIVE_INFINITY);
      }
    };
    visitOwner(checkpointOwner, checkpointStartIndex);
    if (!isNodeOfType(checkpointOwner, "Program")) {
      visitOwner(scopes.rootScope.node, Number.POSITIVE_INFINITY);
    }
    return invokedOwners;
  };

  const getProgramCutoffIndex = (usageOwner: EsTreeNode): number => {
    if (isNodeOfType(usageOwner, "Program")) return Number.POSITIVE_INFINITY;
    const directProgramCall = calls.find(
      (call) => isNodeOfType(call.owner, "Program") && call.targetOwner === usageOwner,
    );
    return directProgramCall ? getNodeStartIndex(directProgramCall.call) : Number.POSITIVE_INFINITY;
  };

  const canOwnerReach = (
    owner: EsTreeNode,
    targetOwner: EsTreeNode,
    visitedOwners: ReadonlySet<EsTreeNode>,
  ): boolean => {
    if (owner === targetOwner) return true;
    if (visitedOwners.has(owner)) return false;
    const nextVisitedOwners = new Set(visitedOwners);
    nextVisitedOwners.add(owner);
    return calls.some(
      (call) =>
        call.owner === owner && canOwnerReach(call.targetOwner, targetOwner, nextVisitedOwners),
    );
  };

  const isExecutionOrderAmbiguous = (usageNode: EsTreeNode): boolean => {
    const usageOwner = getExecutionOwner(usageNode);
    if (isNodeOfType(usageOwner, "Program")) return false;
    const reachingProgramCalls = calls.filter(
      (call) =>
        isNodeOfType(call.owner, "Program") &&
        canOwnerReach(call.targetOwner, usageOwner, new Set()),
    );
    if (reachingProgramCalls.length === 0) return false;
    return reachingProgramCalls.length !== 1 || reachingProgramCalls[0]?.targetOwner !== usageOwner;
  };

  const isMutationOrderAmbiguous = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ): boolean => {
    const usageOwner = getExecutionOwner(usageNode);
    return (eventsBySymbolId.get(symbol.id) ?? []).some((event) => {
      if (
        event.owner === usageOwner ||
        isNodeOfType(event.owner, "Program") ||
        (relevantPropertyName !== null &&
          event.propertyNames !== null &&
          !event.propertyNames.has(relevantPropertyName))
      ) {
        return false;
      }
      return canOwnerReach(event.owner, usageOwner, new Set());
    });
  };

  const getEventsBefore = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
  ): ReplayedSymbolMutation[] => {
    const symbolEvents = eventsBySymbolId.get(symbol.id) ?? [];
    const mutationEvents: ReplayedSymbolMutation[] = [];
    const visitOwner = (
      owner: EsTreeNode,
      cutoffIndex: number,
      activeOwners: ReadonlySet<EsTreeNode>,
      isConditionalPath: boolean,
    ): void => {
      if (activeOwners.has(owner)) return;
      const nextActiveOwners = new Set(activeOwners);
      nextActiveOwners.add(owner);
      const operations = [
        ...symbolEvents
          .filter((event) => event.owner === owner)
          .map((event) => ({ event, index: getNodeStartIndex(event.node) })),
        ...calls
          .filter((call) => call.owner === owner)
          .map((call) => ({ call, index: getNodeStartIndex(call.call) })),
      ].sort((left, right) => left.index - right.index);
      for (const operation of operations) {
        if (operation.index >= cutoffIndex) break;
        if ("event" in operation) {
          mutationEvents.push({
            isConditional:
              isConditionalPath ||
              isConditionallyExecuted(operation.event.node, operation.event.owner),
            node: operation.event.node,
          });
          continue;
        }
        visitOwner(
          operation.call.targetOwner,
          Number.POSITIVE_INFINITY,
          nextActiveOwners,
          isConditionalPath || isConditionallyExecuted(operation.call.call, operation.call.owner),
        );
      }
    };

    const usageOwner = getExecutionOwner(usageNode);
    if (!isNodeOfType(usageOwner, "Program")) {
      visitOwner(scopes.rootScope.node, getProgramCutoffIndex(usageOwner), new Set(), false);
    }
    visitOwner(usageOwner, getNodeStartIndex(usageNode), new Set(), false);
    return mutationEvents;
  };

  const isMutatedBefore = (
    symbol: SymbolDescriptor,
    usageNode: EsTreeNode,
    relevantPropertyName: string | null,
  ): boolean => {
    const events = eventsBySymbolId.get(symbol.id);
    if (!events) return false;
    const usageStartIndex = getNodeStartIndex(usageNode);
    const usageOwner = getExecutionOwner(usageNode);
    const invokedOwners = getInvokedOwnersBefore(usageNode);
    return events.some((event) => {
      if (
        relevantPropertyName !== null &&
        event.propertyNames !== null &&
        !event.propertyNames.has(relevantPropertyName)
      ) {
        return false;
      }
      if (event.owner === usageOwner) return getNodeStartIndex(event.node) < usageStartIndex;
      if (isNodeOfType(event.owner, "Program") && !isNodeOfType(usageOwner, "Program")) {
        return getNodeStartIndex(event.node) < getProgramCutoffIndex(usageOwner);
      }
      return invokedOwners.has(event.owner);
    });
  };

  const inspector: SymbolMutationInspector = {
    getEventsBefore,
    getOutermostTarget,
    isGlobalNamespaceMethod,
    isExecutionOrderAmbiguous,
    isMutationOrderAmbiguous,
    isMutatedBefore,
  };
  inspectorCache.set(scopes, inspector);
  return inspector;
};
