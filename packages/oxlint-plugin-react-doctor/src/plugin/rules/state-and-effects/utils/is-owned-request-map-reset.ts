import type { ControlFlowAnalysis } from "../../../semantic/control-flow-graph.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { MethodMutationAnalysis } from "../../../utils/has-proven-method-mutation.js";
import { areExpressionsStructurallyEqual } from "../../../utils/are-expressions-structurally-equal.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { createMethodMutationAnalysis } from "../../../utils/has-proven-method-mutation.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveReactRefCurrentOriginSymbol } from "../../../utils/react-ref-origin.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface RequestMapInsertion {
  node: EsTreeNode;
  key: EsTreeNode;
  value: EsTreeNode;
  owner: EsTreeNode;
}

interface RequestLoadingWrite {
  node: EsTreeNode;
  key: EsTreeNode;
}

interface RequestMapComponentFacts {
  iterationsByOwner: Map<EsTreeNode, Map<SymbolDescriptor, EsTreeNode[]>>;
  clearsByCollection: Map<SymbolDescriptor, EsTreeNode[]>;
  requestsBySetter: Map<SymbolDescriptor, Map<SymbolDescriptor, RequestMapInsertion[]>>;
  writesByOwner: Map<EsTreeNode, Map<SymbolDescriptor, RequestLoadingWrite[]>>;
  returns: EsTreeNode[];
}

interface RequestMapProviderFacts {
  mutations: MethodMutationAnalysis;
  prototypes: EsTreeNode[];
}

const componentFactsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, RequestMapComponentFacts>
>();
const controllerReadsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, WeakMap<EsTreeNode, WeakMap<EsTreeNode, boolean>>>
>();
const providerFactsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<ControlFlowAnalysis, RequestMapProviderFacts>
>();

const isNativeGlobalReference = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (context.scopes.isGlobalReference(identifier)) return true;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};

const haveMatchingKeys = (first: EsTreeNode, second: EsTreeNode, context: RuleContext): boolean =>
  areExpressionsStructurallyEqual(first, second, {
    areIdentifiersEqual: (firstIdentifier, secondIdentifier) =>
      context.scopes.symbolFor(firstIdentifier) === context.scopes.symbolFor(secondIdentifier),
  });

const getRequestMapComponentFacts = (
  component: EsTreeNode,
  context: RuleContext,
): RequestMapComponentFacts => {
  let factsByComponent = componentFactsByScopes.get(context.scopes);
  if (!factsByComponent) {
    factsByComponent = new WeakMap();
    componentFactsByScopes.set(context.scopes, factsByComponent);
  }
  const cached = factsByComponent.get(component);
  if (cached) return cached;
  const facts: RequestMapComponentFacts = {
    iterationsByOwner: new Map(),
    clearsByCollection: new Map(),
    requestsBySetter: new Map(),
    writesByOwner: new Map(),
    returns: [],
  };
  const insertionsByCollection = new Map<SymbolDescriptor, RequestMapInsertion[]>();
  walkAst(component, (node) => {
    const owner = findEnclosingFunction(node);
    if (isNodeOfType(node, "ReturnStatement") && owner === component) facts.returns.push(node);
    if (!owner || !isNodeOfType(node, "CallExpression")) return;
    const setter = context.scopes.symbolFor(node.callee);
    const updater = node.arguments[0];
    if (setter && updater && isFunctionLike(updater)) {
      const add = stripParenExpression(updater.body);
      if (
        isNodeOfType(add, "CallExpression") &&
        isNodeOfType(add.callee, "MemberExpression") &&
        getStaticPropertyName(add.callee) === "add" &&
        isNodeOfType(add.callee.object, "NewExpression") &&
        isNodeOfType(add.callee.object.callee, "Identifier") &&
        add.callee.object.callee.name === "Set" &&
        isNativeGlobalReference(add.callee.object.callee, context) &&
        add.arguments[0]
      ) {
        const writesBySetter = facts.writesByOwner.get(owner) ?? new Map();
        const writes = writesBySetter.get(setter) ?? [];
        writes.push({ node, key: add.arguments[0] });
        writesBySetter.set(setter, writes);
        facts.writesByOwner.set(owner, writesBySetter);
      }
    }
    if (!isNodeOfType(node.callee, "MemberExpression")) return;
    const method = getStaticPropertyName(node.callee);
    if (method !== "forEach" && method !== "clear" && method !== "set") return;
    const collection = resolveReactRefCurrentOriginSymbol(node.callee.object, context.scopes);
    if (!collection) return;
    if (method === "forEach") {
      const iterationsByCollection = facts.iterationsByOwner.get(owner) ?? new Map();
      const iterations = iterationsByCollection.get(collection) ?? [];
      iterations.push(node);
      iterationsByCollection.set(collection, iterations);
      facts.iterationsByOwner.set(owner, iterationsByCollection);
    } else if (method === "clear") {
      const clears = facts.clearsByCollection.get(collection) ?? [];
      clears.push(node);
      facts.clearsByCollection.set(collection, clears);
    } else {
      const key = node.arguments[0];
      const value = node.arguments[1];
      if (!key || !value) return;
      const insertions = insertionsByCollection.get(collection) ?? [];
      insertions.push({ node, key, value, owner });
      insertionsByCollection.set(collection, insertions);
    }
  });
  for (const [collection, insertions] of insertionsByCollection) {
    for (const insertion of insertions) {
      const writesBySetter = facts.writesByOwner.get(insertion.owner);
      if (!writesBySetter) continue;
      for (const [setter, writes] of writesBySetter) {
        if (!writes.some((write) => haveMatchingKeys(insertion.key, write.key, context))) continue;
        const requestsByCollection = facts.requestsBySetter.get(setter) ?? new Map();
        const requests = requestsByCollection.get(collection) ?? [];
        requests.push(insertion);
        requestsByCollection.set(collection, requests);
        facts.requestsBySetter.set(setter, requestsByCollection);
      }
    }
  }
  factsByComponent.set(component, facts);
  return facts;
};

const hasClosedControllerReads = (
  symbol: SymbolDescriptor,
  property: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let readsBySymbol = controllerReadsByScopes.get(context.scopes);
  if (!readsBySymbol) {
    readsBySymbol = new WeakMap();
    controllerReadsByScopes.set(context.scopes, readsBySymbol);
  }
  let readsByProperty = readsBySymbol.get(symbol);
  if (!readsByProperty) {
    readsByProperty = new WeakMap();
    readsBySymbol.set(symbol, readsByProperty);
  }
  let readsByOwner = readsByProperty.get(property);
  if (!readsByOwner) {
    readsByOwner = new WeakMap();
    readsByProperty.set(property, readsByOwner);
  }
  const cached = readsByOwner.get(owner);
  if (cached !== undefined) return cached;
  const result = symbol.references.every((reference) => {
    if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== owner)
      return false;
    if (reference.identifier.parent === property) return true;
    const member = reference.identifier.parent;
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      getStaticPropertyName(member) === "signal" &&
      isNodeOfType(member.parent, "Property") &&
      member.parent.value === member &&
      member.parent.kind === "init" &&
      !member.parent.computed &&
      !member.parent.method &&
      isNodeOfType(member.parent.parent, "ObjectExpression") &&
      !isWithinAssignmentTarget(member)
    );
  });
  readsByOwner.set(owner, result);
  return result;
};

const getAbortProviderFacts = (context: RuleContext): RequestMapProviderFacts => {
  let factsByCfg = providerFactsByScopes.get(context.scopes);
  if (!factsByCfg) {
    factsByCfg = new WeakMap();
    providerFactsByScopes.set(context.scopes, factsByCfg);
  }
  const cached = factsByCfg.get(context.cfg);
  if (cached) return cached;
  const facts: RequestMapProviderFacts = {
    mutations: createMethodMutationAnalysis(context),
    prototypes: [],
  };
  const prototypesByIdentity = new Map<string, EsTreeNode>();
  walkAst(context.scopes.rootScope.node, (node) => {
    facts.mutations.record(node);
    if (
      isNodeOfType(node, "MemberExpression") &&
      getStaticPropertyName(node) === "prototype" &&
      isNodeOfType(node.object, "Identifier") &&
      node.object.name === "AbortController" &&
      isNativeGlobalReference(node.object, context)
    ) {
      const identity = resolveExpressionKey(node, context);
      if (identity && !prototypesByIdentity.has(identity)) prototypesByIdentity.set(identity, node);
    }
  });
  facts.prototypes = [...prototypesByIdentity.values()];
  factsByCfg.set(context.cfg, facts);
  return facts;
};

const hasAbortProviderMutation = (
  release: EsTreeNode,
  owner: EsTreeNode,
  component: EsTreeNode,
  componentFacts: RequestMapComponentFacts,
  context: RuleContext,
): boolean => {
  const facts = getAbortProviderFacts(context);
  const registration = owner.parent;
  const hasInlineRegistration = Boolean(
    isNodeOfType(registration, "CallExpression") &&
    registration.arguments[0] === owner &&
    findEnclosingFunction(registration) === component,
  );
  for (const prototype of facts.prototypes) {
    if (facts.mutations.hasProvenMutation(prototype, "abort", release)) return true;
    if (!hasInlineRegistration || !registration) continue;
    if (facts.mutations.hasProvenMutation(prototype, "abort", registration)) return true;
    if (
      componentFacts.returns.some(
        (returnNode) =>
          nodeDominatesNode(registration, returnNode, context) &&
          facts.mutations.hasProvenMutation(prototype, "abort", returnNode),
      )
    )
      return true;
  }
  return false;
};

export const isOwnedRequestMapReset = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression")) return false;
  const emptyState = write.arguments[0];
  const isRecordReset =
    isNodeOfType(emptyState, "ObjectExpression") && emptyState.properties.length === 0;
  if (
    !isRecordReset &&
    (!isNodeOfType(emptyState, "NewExpression") ||
      emptyState.arguments.length !== 0 ||
      !isNodeOfType(emptyState.callee, "Identifier") ||
      emptyState.callee.name !== "Set" ||
      !isNativeGlobalReference(emptyState.callee, context))
  )
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const owner = findEnclosingFunction(write);
  const component = pair ? findEnclosingFunction(pair.declarator) : null;
  if (!pair || !owner || !component) return false;
  if (isRecordReset) {
    let isOwnedReset = false;
    walkAst(owner, (node) => {
      if (isOwnedReset || (node !== owner && isFunctionLike(node))) return false;
      if (
        !isNodeOfType(node, "CallExpression") ||
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "forEach" ||
        !nodeDominatesNode(node, write, context)
      )
        return;
      const receiver = node.callee.object;
      const valuesCall = isNodeOfType(receiver, "CallExpression") ? receiver : null;
      if (
        !valuesCall ||
        !isNodeOfType(valuesCall.callee, "MemberExpression") ||
        getStaticPropertyName(valuesCall.callee) !== "values" ||
        !isNodeOfType(valuesCall.callee.object, "Identifier") ||
        valuesCall.callee.object.name !== "Object" ||
        !context.scopes.isGlobalReference(valuesCall.callee.object) ||
        valuesCall.arguments.length !== 1
      )
        return;
      const collectionExpression = valuesCall.arguments[0];
      if (!collectionExpression) return;
      const collection = resolveReactRefCurrentOriginSymbol(collectionExpression, context.scopes);
      const initializer = collection?.initializer;
      const initialCollection = isNodeOfType(initializer, "CallExpression")
        ? initializer.arguments[0]
        : null;
      if (!collection) return;
      if (
        !isNodeOfType(initialCollection, "ObjectExpression") ||
        initialCollection.properties.length !== 0
      )
        return;
      const callback = node.arguments[0];
      if (!callback || !isFunctionLike(callback) || callback.async || callback.generator) return;
      const callbackBody = stripParenExpression(callback.body);
      const statement =
        isNodeOfType(callbackBody, "BlockStatement") && callbackBody.body.length === 1
          ? callbackBody.body[0]
          : null;
      const release = isNodeOfType(statement, "ExpressionStatement")
        ? statement.expression
        : callbackBody;
      if (
        !isNodeOfType(release, "CallExpression") ||
        !isNodeOfType(release.callee, "MemberExpression") ||
        getStaticPropertyName(release.callee) !== "abort"
      )
        return;
      const handle = release.callee.object;
      const parameter = callback.params[0];
      if (
        !isNodeOfType(parameter, "Identifier") ||
        !isNodeOfType(handle, "Identifier") ||
        context.scopes.symbolFor(parameter) !== context.scopes.symbolFor(handle)
      )
        return;
      let didClear = false;
      let hasTrackedRequest = false;
      walkAst(component, (candidate) => {
        let key: EsTreeNode | undefined;
        let value: EsTreeNode | undefined;
        if (!isNodeOfType(candidate, "AssignmentExpression") || candidate.operator !== "=") return;
        if (resolveReactRefCurrentOriginSymbol(candidate.left, context.scopes) === collection) {
          if (
            isNodeOfType(candidate.right, "ObjectExpression") &&
            candidate.right.properties.length === 0 &&
            nodeDominatesNode(node, candidate, context) &&
            nodeDominatesNode(candidate, write, context)
          )
            didClear = true;
          return;
        }
        if (
          !isNodeOfType(candidate.left, "MemberExpression") ||
          !candidate.left.computed ||
          resolveReactRefCurrentOriginSymbol(candidate.left.object, context.scopes) !== collection
        )
          return;
        key = candidate.left.property;
        value = candidate.right;
        if (!key || !value) return;
        if (!isNodeOfType(key, "Identifier")) return;
        const requestKeySymbol = context.scopes.symbolFor(key);
        if (
          !requestKeySymbol ||
          requestKeySymbol.references.some((reference) => reference.flag !== "read")
        )
          return;
        const record = isNodeOfType(value, "Identifier")
          ? resolveConstIdentifierAlias(value, context.scopes)?.initializer
          : value;
        const controller = record;
        if (
          !isNodeOfType(controller, "NewExpression") ||
          !isNodeOfType(controller.callee, "Identifier") ||
          controller.callee.name !== "AbortController" ||
          !context.scopes.isGlobalReference(controller.callee)
        )
          return;
        const requestOwner = findEnclosingFunction(candidate);
        if (!requestOwner) return;
        walkAst(requestOwner, (stateWrite) => {
          if (stateWrite !== requestOwner && isFunctionLike(stateWrite)) return false;
          if (
            !isNodeOfType(stateWrite, "CallExpression") ||
            context.scopes.symbolFor(stateWrite.callee) !== pair.setterSymbol ||
            !nodeDominatesNode(candidate, stateWrite, context)
          )
            return;
          const updater = stateWrite.arguments[0];
          if (!updater || !isFunctionLike(updater)) return;
          if (updater.async || updater.generator) return;
          const updatedCollection = stripParenExpression(updater.body);
          if (
            !isNodeOfType(updatedCollection, "ObjectExpression") ||
            updatedCollection.properties.length !== 2
          )
            return;
          const [spread, entry] = updatedCollection.properties;
          const previous = updater.params[0];
          if (
            !isNodeOfType(spread, "SpreadElement") ||
            !isNodeOfType(previous, "Identifier") ||
            !isNodeOfType(spread.argument, "Identifier") ||
            context.scopes.symbolFor(spread.argument) !== context.scopes.symbolFor(previous) ||
            !isNodeOfType(entry, "Property") ||
            !entry.computed ||
            !isNodeOfType(entry.value, "Literal") ||
            entry.value.value !== true
          )
            return;
          if (
            areExpressionsStructurallyEqual(key, entry.key, {
              areIdentifiersEqual: (first, second) =>
                context.scopes.symbolFor(first) === context.scopes.symbolFor(second),
            })
          )
            hasTrackedRequest = true;
        });
      });
      isOwnedReset = didClear && hasTrackedRequest;
    });
    return isOwnedReset;
  }
  const facts = getRequestMapComponentFacts(component, context);
  const requestsByCollection = facts.requestsBySetter.get(pair.setterSymbol);
  const iterationsByCollection = facts.iterationsByOwner.get(owner);
  if (!requestsByCollection || !iterationsByCollection) return false;
  for (const [collection, requests] of requestsByCollection) {
    const initializer = collection.initializer;
    const initialMap = isNodeOfType(initializer, "CallExpression")
      ? initializer.arguments[0]
      : null;
    if (
      !isNodeOfType(initialMap, "NewExpression") ||
      initialMap.arguments.length !== 0 ||
      !isNodeOfType(initialMap.callee, "Identifier") ||
      initialMap.callee.name !== "Map" ||
      !isNativeGlobalReference(initialMap.callee, context)
    )
      continue;
    for (const iteration of iterationsByCollection.get(collection) ?? []) {
      if (
        !isNodeOfType(iteration, "CallExpression") ||
        !nodeDominatesNode(iteration, write, context)
      )
        continue;
      const callback = iteration.arguments[0];
      if (!callback || !isFunctionLike(callback) || callback.async || callback.generator) continue;
      const callbackBody = stripParenExpression(callback.body);
      const statement =
        isNodeOfType(callbackBody, "BlockStatement") && callbackBody.body.length === 1
          ? callbackBody.body[0]
          : null;
      const release = isNodeOfType(statement, "ExpressionStatement")
        ? statement.expression
        : callbackBody;
      if (
        !isNodeOfType(release, "CallExpression") ||
        !isNodeOfType(release.callee, "MemberExpression") ||
        getStaticPropertyName(release.callee) !== "abort" ||
        !isNodeOfType(release.callee.object, "MemberExpression")
      )
        continue;
      const handle = release.callee.object;
      const field = getStaticPropertyName(handle);
      const parameter = callback.params[0];
      if (
        !field ||
        !isNodeOfType(parameter, "Identifier") ||
        !isNodeOfType(handle.object, "Identifier") ||
        context.scopes.symbolFor(parameter) !== context.scopes.symbolFor(handle.object)
      )
        continue;
      const didClear = (facts.clearsByCollection.get(collection) ?? []).some(
        (clear) =>
          nodeDominatesNode(iteration, clear, context) && nodeDominatesNode(clear, write, context),
      );
      if (!didClear || hasAbortProviderMutation(release, owner, component, facts, context))
        continue;
      for (const request of requests) {
        const record = isNodeOfType(request.value, "Identifier")
          ? resolveConstIdentifierAlias(request.value, context.scopes)?.initializer
          : request.value;
        const controllerValue = record ? getStaticObjectPropertyValue(record, field) : null;
        let controller = controllerValue;
        if (isNodeOfType(controllerValue, "Identifier")) {
          const symbol = context.scopes.symbolFor(controllerValue);
          const property = controllerValue.parent;
          if (
            !isNodeOfType(request.value, "ObjectExpression") ||
            !isNodeOfType(property, "Property") ||
            property.parent !== request.value ||
            property.value !== controllerValue ||
            symbol?.kind !== "const" ||
            !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
            symbol.declarationNode.id !== symbol.bindingIdentifier ||
            findEnclosingFunction(symbol.declarationNode) !== request.owner ||
            !nodeDominatesNode(symbol.declarationNode, request.node, context) ||
            !hasClosedControllerReads(symbol, property, request.owner, context)
          )
            continue;
          controller = symbol.initializer;
        }
        if (
          !isNodeOfType(controller, "NewExpression") ||
          !isNodeOfType(controller.callee, "Identifier") ||
          controller.callee.name !== "AbortController" ||
          !isNativeGlobalReference(controller.callee, context)
        )
          continue;
        const loadingWrites = facts.writesByOwner.get(request.owner)?.get(pair.setterSymbol) ?? [];
        if (
          loadingWrites.some(
            (loadingWrite) =>
              nodeDominatesNode(request.node, loadingWrite.node, context) &&
              haveMatchingKeys(request.key, loadingWrite.key, context),
          )
        )
          return true;
      }
    }
  }
  return false;
};
