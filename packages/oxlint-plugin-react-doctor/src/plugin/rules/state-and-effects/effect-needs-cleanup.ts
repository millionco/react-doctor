import {
  EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../constants/dom.js";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  EVENT_LISTENER_HANDLER_ARGUMENT_INDEX,
  EFFECT_HOOK_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
  UNARY_LISTENER_ARGUMENT_COUNT,
  UNARY_LISTENER_HANDLER_ARGUMENT_INDEX,
  WHOLE_RECEIVER_RELEASE_ARGUMENT_COUNT,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { canNodeReachLaterNodeWithinFunction } from "../../utils/can-node-reach-later-node-within-function.js";
import {
  collectEffectInvokedFunctions,
  collectSynchronouslyEffectInvokedFunctions,
  getPromiseChainCallForCallback,
} from "../../utils/collect-effect-invoked-functions.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getFinalSequenceExpressionValue } from "../../utils/get-final-sequence-expression-value.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../utils/do-nodes-cover-every-path-from-function-entry.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getSymbolTypeAnnotation } from "../../utils/get-symbol-type-annotation.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { getProvenDomEventTargetPrototypeOwnerNames } from "../../utils/is-proven-browser-api-receiver.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import {
  resolveReactRefCurrentOriginSymbol,
  resolveReactRefSymbol,
} from "../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getSubscribeOrObserveMethodName,
  isCleanupReturningSubscribeLikeCallExpression,
  isSubscribeOrObserveCallExpression,
  OBSERVER_REGISTRATION_METHOD_NAME,
} from "./utils/is-subscribe-like-call-expression.js";
import { resolveEventListenerCapture } from "./utils/resolve-event-listener-capture.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isProvenNonThrowingBuiltInCall } from "../../utils/is-proven-non-throwing-built-in-call.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import {
  isSynchronousIteratorCallback,
  isSynchronousIteratorCallbackCall,
} from "../../utils/is-synchronous-iterator-callback.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

const CLEANUP_EFFECT_HOOK_NAMES = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);
const CALLABLE_ADD_EVENT_LISTENER_MODULE_NAMES: ReadonlySet<string> = new Set([
  "@react-native-community/netinfo",
]);
const NON_CALLABLE_ADD_LISTENER_CONSTRUCTOR_MODULE_NAMES: ReadonlySet<string> = new Set([
  "events",
  "node:events",
  "react-native",
]);
const REPLAYABLE_ITERATOR_COLLECTION_CACHE = new WeakMap<RuleContext, Map<number, string | null>>();
const REPLAY_ENTRY_DROPPING_ARRAY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "pop",
  "shift",
  "splice",
  "fill",
  "copyWithin",
]);
const REPLAY_ENTRY_DROPPING_COLLECTION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "clear",
  "delete",
  "set",
]);

interface SubscribeLikeUsage {
  kind: "subscribe" | "timer" | "socket";
  node: EsTreeNode;
  resourceName: string;
  handleKey: string | null;
  receiverKey: string | null;
  registrationVerbName: string | null;
  eventKey: string | null;
  handlerKey: string | null;
}

interface ForEachProjection {
  collectionKey: string;
  projectionKey: string;
}

interface RefOwnedHandlerStorage {
  handlerKey: string;
  refCurrentKey: string;
  refKey: string;
  assignmentNode: EsTreeNode;
}

interface RetainedDisposerStorage {
  assignmentNode: EsTreeNodeOfType<"AssignmentExpression">;
  refCurrentKey: string;
  retainedFunction:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
}

interface BooleanGuardState {
  bindingIdentifier: EsTreeNode | null;
  guardNode: EsTreeNode;
  key: string;
  value: boolean;
}

interface OwnedFunctionReference {
  generationKey: string | null;
}

interface GlobalReleaseProof {
  anchor: EsTreeNode;
  call: EsTreeNode;
  handleGuard: EsTreeNodeOfType<"IfStatement"> | null;
}

interface RetainedFunctionLeakOptions {
  allowReturnedResourceEscape?: boolean;
  allowReturnedTimerEscape?: boolean;
  includeOneShotTimers?: boolean;
  requireCallableReturnedResource?: boolean;
}

interface ReactRefEffectUsage {
  doesEffectOwnEveryResult: boolean;
}

interface ReactRefCallbackDefinition {
  assignmentNode: EsTreeNodeOfType<"AssignmentExpression">;
  functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
  refSymbol: SymbolDescriptor;
}

interface ReactRefEffectAnalysis {
  callbackDefinitionsByRefSymbolId: Map<number, ReactRefCallbackDefinition[]>;
  usageByRefSymbolId: Map<number, ReactRefEffectUsage>;
}

interface EffectRetainedInvocation {
  call: EsTreeNodeOfType<"CallExpression">;
  isDirect: boolean;
}

interface FileReleaseCallIndex {
  identifierCallsByName: Map<string, EsTreeNode[]>;
  potentialNonTimerCalls: EsTreeNode[];
}

const REACT_REF_EFFECT_ANALYSIS_CACHE = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNode, ReactRefEffectAnalysis>
>();
const EFFECT_RETAINED_INVOCATIONS_CACHE = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNode, Map<EsTreeNode, EffectRetainedInvocation[]>>
>();
const FILE_RELEASE_CALL_INDEX_CACHE = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNode, FileReleaseCallIndex>
>();
const COMPONENT_EFFECT_CALLS_CACHE = new WeakMap<
  RuleContext,
  WeakMap<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>
>();

const RESOURCE_NOUN_BY_KIND = {
  subscribe: "subscription",
  timer: "timer",
  socket: "connection",
} as const;

const isSocketConstruction = (node: EsTreeNode): node is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP.has(node.callee.name);

const resolveExpressionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
  parameterSubstitutions: ReadonlyMap<number, EsTreeNode> = new Map(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (!symbol) {
      return context.scopes.isGlobalReference(unwrappedExpression)
        ? `global:${unwrappedExpression.name}`
        : null;
    }
    if (visitedSymbolIds.has(symbol.id)) return `symbol:${symbol.id}`;
    visitedSymbolIds.add(symbol.id);
    const substitutedExpression = parameterSubstitutions.get(symbol.id);
    if (substitutedExpression) {
      return resolveExpressionKey(
        substitutedExpression,
        context,
        visitedSymbolIds,
        parameterSubstitutions,
      );
    }
    const bindingProperty = symbol.bindingIdentifier.parent;
    const bindingPattern = bindingProperty?.parent;
    const variableDeclarator = bindingPattern?.parent;
    const bindingPropertyName = isNodeOfType(bindingProperty, "Property")
      ? getStaticPropertyKeyName(bindingProperty)
      : null;
    if (
      bindingPropertyName &&
      isNodeOfType(bindingPattern, "ObjectPattern") &&
      isNodeOfType(variableDeclarator, "VariableDeclarator") &&
      variableDeclarator.id === bindingPattern
    ) {
      const objectKey = resolveExpressionKey(
        variableDeclarator.init,
        context,
        visitedSymbolIds,
        parameterSubstitutions,
      );
      return objectKey ? `${objectKey}.${bindingPropertyName}` : `symbol:${symbol.id}`;
    }
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (
      symbol.kind === "const" &&
      initializer &&
      (isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression"))
    ) {
      return (
        resolveExpressionKey(initializer, context, visitedSymbolIds, parameterSubstitutions) ??
        `symbol:${symbol.id}`
      );
    }
    return `symbol:${symbol.id}`;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression") && !unwrappedExpression.computed) {
    if (!isNodeOfType(unwrappedExpression.property, "Identifier")) return null;
    const objectKey = resolveExpressionKey(
      unwrappedExpression.object,
      context,
      visitedSymbolIds,
      parameterSubstitutions,
    );
    return objectKey ? `${objectKey}.${unwrappedExpression.property.name}` : null;
  }
  if (isNodeOfType(unwrappedExpression, "ThisExpression")) return "this";
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    (typeof unwrappedExpression.value === "string" ||
      typeof unwrappedExpression.value === "number" ||
      typeof unwrappedExpression.value === "boolean")
  ) {
    return `literal:${String(unwrappedExpression.value)}`;
  }
  if (isFunctionLike(unwrappedExpression)) {
    const rangeStart = getRangeStart(unwrappedExpression);
    return rangeStart === null ? null : `function:${rangeStart}`;
  }
  return null;
};

const resolveForEachProjection = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): ForEachProjection | null => {
  if (!expression) return null;
  let currentExpression = stripParenExpression(expression);
  const memberNames: string[] = [];
  while (isNodeOfType(currentExpression, "MemberExpression") && !currentExpression.computed) {
    if (!isNodeOfType(currentExpression.property, "Identifier")) return null;
    memberNames.unshift(currentExpression.property.name);
    currentExpression = stripParenExpression(currentExpression.object);
  }
  if (!isNodeOfType(currentExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(currentExpression);
  if (!symbol || symbol.kind !== "parameter") return null;
  let callbackNode: EsTreeNode | null | undefined = symbol.bindingIdentifier.parent;
  while (callbackNode && !isFunctionLike(callbackNode)) callbackNode = callbackNode.parent;
  if (!callbackNode || !isFunctionLike(callbackNode)) return null;
  const forEachCall = findEnclosingForEachCall(callbackNode);
  if (!forEachCall) return null;
  const forEachCallee = stripParenExpression(forEachCall.callee);
  if (!isNodeOfType(forEachCallee, "MemberExpression")) return null;
  const collectionKey = resolveExpressionKey(forEachCallee.object, context);
  if (!collectionKey) return null;
  const firstParameter = callbackNode.params[0];
  const assignmentPattern =
    isNodeOfType(symbol.bindingIdentifier.parent, "AssignmentPattern") &&
    symbol.bindingIdentifier.parent.left === symbol.bindingIdentifier
      ? symbol.bindingIdentifier.parent
      : null;
  const propertyName = isNodeOfType(firstParameter, "ObjectPattern")
    ? getDestructuredBindingPropertyName(symbol.bindingIdentifier)
    : null;
  const defaultValueKey = assignmentPattern
    ? resolveExpressionKey(assignmentPattern.right, context)
    : null;
  if (assignmentPattern && !defaultValueKey) return null;
  const parameterProjection =
    firstParameter === symbol.bindingIdentifier
      ? "value"
      : propertyName && defaultValueKey
        ? `${propertyName}=default:${defaultValueKey}`
        : propertyName;
  if (!parameterProjection) return null;
  return {
    collectionKey,
    projectionKey: [parameterProjection, ...memberNames].join("."),
  };
};

const resolveForEachProjectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  const projection = resolveForEachProjection(expression, context);
  return projection ? `forEach:${projection.collectionKey}:${projection.projectionKey}` : null;
};

const resolveResourceIdentityKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null =>
  resolveForEachProjectionKey(expression, context) ?? resolveExpressionKey(expression, context);

const resolveEventListenerCaptureValueIdentityKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const directIdentityKey = resolveResourceIdentityKey(expression, context);
  if (directIdentityKey) return directIdentityKey;
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const calleeKey = resolveResourceIdentityKey(unwrappedExpression.callee, context);
    const argumentKeys = unwrappedExpression.arguments.flatMap((argument) => {
      if (!isAstNode(argument)) return [];
      const argumentKey = resolveEventListenerCaptureValueIdentityKey(argument, context);
      return argumentKey ? [argumentKey] : [];
    });
    return calleeKey && argumentKeys.length === unwrappedExpression.arguments.length
      ? `call:${calleeKey}:${argumentKeys.join(":")}`
      : null;
  }
  if (
    !isNodeOfType(unwrappedExpression, "BinaryExpression") &&
    !isNodeOfType(unwrappedExpression, "LogicalExpression")
  ) {
    return null;
  }
  const leftIdentityKey = resolveEventListenerCaptureValueIdentityKey(
    unwrappedExpression.left,
    context,
  );
  const rightIdentityKey = resolveEventListenerCaptureValueIdentityKey(
    unwrappedExpression.right,
    context,
  );
  return leftIdentityKey && rightIdentityKey
    ? `${unwrappedExpression.type}:${unwrappedExpression.operator}:${leftIdentityKey}:${rightIdentityKey}`
    : null;
};

const resolveReadOnlyEventListenerOptions = (
  optionsNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (
    isNodeOfType(unwrappedOptions, "CallExpression") &&
    resolveEventListenerCaptureValueIdentityKey(unwrappedOptions, context)
  ) {
    return unwrappedOptions;
  }
  if (!isNodeOfType(unwrappedOptions, "Identifier")) {
    return resolveStableValue(unwrappedOptions, context);
  }
  const optionsSymbol = context.scopes.symbolFor(unwrappedOptions);
  const initializer = optionsSymbol?.initializer
    ? stripParenExpression(optionsSymbol.initializer)
    : null;
  if (!optionsSymbol || !initializer) {
    return resolveStableValue(unwrappedOptions, context);
  }
  if (!isNodeOfType(initializer, "ObjectExpression")) {
    if (isNodeOfType(initializer, "Identifier") || isNodeOfType(initializer, "MemberExpression")) {
      return null;
    }
    return resolveStableValue(unwrappedOptions, context);
  }
  if (optionsSymbol.kind !== "const") return null;
  const hasOnlyEventListenerOptionUses = optionsSymbol.references.every((reference) => {
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const callNode = referenceRoot.parent;
    if (
      !isNodeOfType(callNode, "CallExpression") ||
      callNode.arguments[EVENT_LISTENER_HANDLER_ARGUMENT_INDEX + 1] !== referenceRoot
    ) {
      return false;
    }
    const callee = stripParenExpression(callNode.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const methodName = getStaticPropertyKeyName(callee);
    return methodName === "addEventListener" || methodName === "removeEventListener";
  });
  return hasOnlyEventListenerOptionUses ? initializer : null;
};

const resolveEventListenerCaptureIdentityKey = (
  optionsNode: EsTreeNode | null | undefined,
  context: RuleContext,
  allowOpaqueOptionsIdentity: boolean,
): string | null => {
  const stableOptionsNode = optionsNode
    ? resolveReadOnlyEventListenerOptions(optionsNode, context)
    : null;
  if (optionsNode && !stableOptionsNode) return null;
  const capture = resolveEventListenerCapture(stableOptionsNode, {
    allowIndeterminateEntries: true,
  });
  if (capture !== null) return `capture:${String(capture)}`;
  if (!stableOptionsNode) return null;
  const unwrappedOptions = stripParenExpression(stableOptionsNode);
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) {
    const optionsKey = allowOpaqueOptionsIdentity
      ? resolveEventListenerCaptureValueIdentityKey(unwrappedOptions, context)
      : null;
    return optionsKey ? `options:${optionsKey}` : null;
  }
  let captureKey: string | null = "capture:false";
  for (const property of unwrappedOptions.properties ?? []) {
    if (!isNodeOfType(property, "Property")) {
      captureKey = null;
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property);
    if (propertyName === null || (!property.computed && propertyName === "__proto__")) {
      captureKey = null;
      continue;
    }
    if (propertyName === "capture") {
      const propertyValueKey = resolveEventListenerCaptureValueIdentityKey(property.value, context);
      captureKey = propertyValueKey ? `capture-value:${propertyValueKey}` : null;
    }
  }
  return captureKey;
};

const resolveEventListenerCaptureProjection = (
  optionsNode: EsTreeNode | null | undefined,
  context: RuleContext,
): ForEachProjection | null => {
  if (!optionsNode) return null;
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) {
    return resolveForEachProjection(unwrappedOptions, context);
  }
  let captureProjection: ForEachProjection | null = null;
  for (const property of unwrappedOptions.properties ?? []) {
    if (!isNodeOfType(property, "Property")) {
      captureProjection = null;
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property);
    if (propertyName === null || (!property.computed && propertyName === "__proto__")) {
      captureProjection = null;
      continue;
    }
    if (propertyName === "capture") {
      captureProjection = resolveForEachProjection(property.value, context);
    }
  }
  return captureProjection;
};

const doEventListenerCapturesMatch = (
  registrationOptions: EsTreeNode | null | undefined,
  releaseOptions: EsTreeNode | null | undefined,
  context: RuleContext,
  allowOpaqueOptionsIdentity = false,
): boolean => {
  const registrationCaptureKey = resolveEventListenerCaptureIdentityKey(
    registrationOptions,
    context,
    allowOpaqueOptionsIdentity,
  );
  return (
    registrationCaptureKey !== null &&
    registrationCaptureKey ===
      resolveEventListenerCaptureIdentityKey(releaseOptions, context, allowOpaqueOptionsIdentity)
  );
};

interface RetainedResourceStorage {
  anchor: EsTreeNode;
  key: string;
}

const hasReactRefCurrentReceiver = (expression: EsTreeNode, context: RuleContext): boolean => {
  let currentExpression = stripParenExpression(expression);
  while (isNodeOfType(currentExpression, "MemberExpression")) {
    if (
      resolveReactRefSymbol(currentExpression, context.scopes, {
        resolveNamedAliases: true,
      })
    ) {
      return true;
    }
    currentExpression = stripParenExpression(currentExpression.object);
  }
  return false;
};

const resolveRetainedResourceStorage = (
  expression: EsTreeNode,
  context: RuleContext,
): RetainedResourceStorage | null => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const expressionParent = expressionRoot.parent;
  if (
    isNodeOfType(expressionParent, "AssignmentExpression") &&
    expressionParent.operator === "=" &&
    expressionParent.right === expressionRoot &&
    hasReactRefCurrentReceiver(expressionParent.left, context)
  ) {
    const key = resolveExpressionKey(expressionParent.left, context);
    return key ? { anchor: expressionParent, key } : null;
  }
  if (
    !isNodeOfType(expressionParent, "Property") ||
    expressionParent.value !== expressionRoot ||
    expressionParent.kind !== "init"
  ) {
    return null;
  }
  const propertyName = getStaticPropertyKeyName(expressionParent);
  const objectExpression = expressionParent.parent;
  if (!propertyName || !isNodeOfType(objectExpression, "ObjectExpression")) return null;
  const objectRoot = findTransparentExpressionRoot(objectExpression);
  const objectAssignment = objectRoot.parent;
  if (
    !isNodeOfType(objectAssignment, "AssignmentExpression") ||
    objectAssignment.operator !== "=" ||
    objectAssignment.right !== objectRoot ||
    !hasReactRefCurrentReceiver(objectAssignment.left, context)
  ) {
    return null;
  }
  const objectKey = resolveExpressionKey(objectAssignment.left, context);
  return objectKey
    ? {
        anchor: objectAssignment,
        key: `${objectKey}.${propertyName}`,
      }
    : null;
};

const findAssignedResourceKey = (
  resourceNode: EsTreeNode,
  context: RuleContext,
  includeRetainedStorage = false,
): string | null => {
  const currentNode = findTransparentExpressionRoot(resourceNode);
  const parentNode = currentNode.parent;
  if (isNodeOfType(parentNode, "VariableDeclarator") && parentNode.init === currentNode) {
    const localKey = resolveExpressionKey(parentNode.id, context);
    if (!includeRetainedStorage) return localKey;
    if (!isNodeOfType(parentNode.id, "Identifier")) return localKey;
    const localSymbol = context.scopes.symbolFor(parentNode.id);
    if (!localSymbol || localSymbol.kind !== "const") return localKey;
    const retainedStorages = localSymbol.references.flatMap((reference) => {
      const storage = resolveRetainedResourceStorage(reference.identifier, context);
      return storage ? [storage] : [];
    });
    const retainedStorage = retainedStorages.find((storage) =>
      doMatchingNodesCoverEveryPathAfterUsage(resourceNode, [storage.anchor], context),
    );
    return retainedStorage?.key ?? localKey;
  }
  if (isNodeOfType(parentNode, "AssignmentExpression") && parentNode.right === currentNode) {
    return resolveExpressionKey(parentNode.left, context);
  }
  return includeRetainedStorage
    ? (resolveRetainedResourceStorage(currentNode, context)?.key ?? null)
    : null;
};

const doesResourceKeyMatchUsageHandle = (
  resourceKey: string | null,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  resourceKey !== null &&
  (resourceKey === usage.handleKey || resourceKey === findAssignedResourceKey(usage.node, context));

const getImportedReceiverSource = (expression: EsTreeNode, context: RuleContext): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return getImportedReceiverSource(unwrappedExpression.object, context);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const importDeclaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return typeof importDeclaration?.source.value === "string"
    ? importDeclaration.source.value
    : null;
};

const canListenerRegistrationReturnCallableDisposer = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (usage.kind !== "subscribe" || !isNodeOfType(usage.node, "CallExpression")) return false;
  if (isCleanupReturningSubscribeLikeCallExpression(usage.node)) return true;
  if (
    usage.registrationVerbName !== "addEventListener" &&
    usage.registrationVerbName !== "addListener"
  ) {
    return false;
  }
  if (isProvenLegacyMediaQueryListMethodCall(usage.node, "addListener", context)) return false;
  const callee = stripParenExpression(usage.node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiverSource = getImportedReceiverSource(callee.object, context);
  if (receiverSource !== null) {
    return usage.registrationVerbName === "addEventListener"
      ? CALLABLE_ADD_EVENT_LISTENER_MODULE_NAMES.has(receiverSource)
      : receiverSource !== "react-native";
  }
  const receiver = stripParenExpression(callee.object);
  const stableReceiver = resolveStableValue(receiver, context);
  const constructedReceiverSource =
    stableReceiver && isNodeOfType(stableReceiver, "NewExpression")
      ? getImportedReceiverSource(stableReceiver.callee, context)
      : null;
  if (
    usage.registrationVerbName === "addListener" &&
    constructedReceiverSource !== null &&
    NON_CALLABLE_ADD_LISTENER_CONSTRUCTOR_MODULE_NAMES.has(constructedReceiverSource)
  ) {
    return false;
  }
  const receiverSymbol = isNodeOfType(receiver, "Identifier")
    ? context.scopes.symbolFor(receiver)
    : null;
  const isKnownGlobalDomReceiver =
    isNodeOfType(receiver, "Identifier") &&
    (receiver.name === "window" || receiver.name === "document") &&
    context.scopes.isGlobalReference(receiver);
  const hasProvableReceiverOrigin =
    !isNodeOfType(receiver, "Identifier") ||
    isKnownGlobalDomReceiver ||
    (receiverSymbol !== null &&
      (getSymbolTypeAnnotation(receiverSymbol) !== null ||
        getDirectUnreassignedInitializer(receiverSymbol) !== null));
  if (!hasProvableReceiverOrigin) return false;
  return getProvenDomEventTargetPrototypeOwnerNames(receiver, context.scopes).length === 0;
};

const isKnownNetInfoReceiver = (expression: EsTreeNode, context: RuleContext): boolean => {
  const receiver = stripParenExpression(expression);
  const importedReceiver = resolveImportedApiReference(receiver, context.scopes);
  return (
    (isNodeOfType(receiver, "Identifier") &&
      receiver.name === "NetInfo" &&
      context.scopes.symbolFor(receiver) !== null) ||
    importedReceiver?.source === "@react-native-community/netinfo"
  );
};

const isKnownReactNavigationReceiver = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const receiverSymbol = context.scopes.symbolFor(receiver);
    if (!receiverSymbol || visitedSymbolIds.has(receiverSymbol.id)) return false;
    if (receiver.name === "navigation") return true;
    visitedSymbolIds.add(receiverSymbol.id);
    const receiverInitializer = receiverSymbol.initializer
      ? stripParenExpression(receiverSymbol.initializer)
      : null;
    const navigationHook = isNodeOfType(receiverInitializer, "CallExpression")
      ? resolveImportedApiReference(receiverInitializer.callee, context.scopes)
      : null;
    if (
      navigationHook?.importedName === "useNavigation" &&
      navigationHook.source.startsWith("@react-navigation/")
    ) {
      return true;
    }
    return Boolean(
      receiverInitializer &&
      isKnownReactNavigationReceiver(receiverInitializer, context, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  const receiverCallee = stripParenExpression(receiver.callee);
  return Boolean(
    isNodeOfType(receiverCallee, "MemberExpression") &&
    !receiverCallee.computed &&
    isNodeOfType(receiverCallee.property, "Identifier") &&
    receiverCallee.property.name === "getParent" &&
    isKnownReactNavigationReceiver(receiverCallee.object, context, visitedSymbolIds),
  );
};

const isKnownCallableSubscriptionResult = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (canListenerRegistrationReturnCallableDisposer(usage, context)) return true;
  if (!isNodeOfType(usage.node, "CallExpression")) return false;
  const callee = stripParenExpression(usage.node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  if (callee.property.name === "addEventListener") {
    return usage.node.arguments.length === 1 && isKnownNetInfoReceiver(callee.object, context);
  }
  return (
    callee.property.name === "addListener" &&
    usage.node.arguments.length >= 2 &&
    isKnownReactNavigationReceiver(callee.object, context)
  );
};

const doesStableIdentifierMatchUsageHandle = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier") || usage.handleKey === null) return false;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    resolveExpressionKey(identifier, context) === usage.handleKey &&
    !symbol.references.some((reference) => isWithinAssignmentTarget(reference.identifier)),
  );
};

const doesStableIdentifierCallUsageDisposer = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  return (
    doesStableIdentifierMatchUsageHandle(expression, usage, context) &&
    isKnownCallableSubscriptionResult(usage, context)
  );
};

const doesSocketOwnerReleaseListenerUsage = (
  releaseReceiverKey: string | null,
  releaseVerbName: string,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    usage.kind !== "subscribe" ||
    usage.registrationVerbName !== "addEventListener" ||
    !SOCKET_RELEASE_VERB_NAMES.has(releaseVerbName) ||
    usage.receiverKey === null ||
    releaseReceiverKey !== usage.receiverKey ||
    !isNodeOfType(usage.node, "CallExpression")
  ) {
    return false;
  }
  const registrationCallee = stripParenExpression(usage.node.callee);
  if (!isNodeOfType(registrationCallee, "MemberExpression")) return false;
  const registrationOwner = resolveStableValue(registrationCallee.object, context);
  return registrationOwner !== null && isSocketConstruction(registrationOwner);
};

const resolveStableMediaQueryListenerIdentityKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      )
    ) {
      return null;
    }
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return `symbol:${symbol.id}`;
    const unwrappedInitializer = stripParenExpression(initializer);
    if (!isNodeOfType(unwrappedInitializer, "Identifier")) return `symbol:${symbol.id}`;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return (
      resolveStableMediaQueryListenerIdentityKey(
        unwrappedInitializer,
        context,
        nextVisitedSymbolIds,
      ) ?? `symbol:${symbol.id}`
    );
  }
  if (isFunctionLike(unwrappedExpression)) {
    const rangeStart = getRangeStart(unwrappedExpression);
    return rangeStart === null ? null : `function:${rangeStart}`;
  }
  return null;
};

const isProvenMediaQueryListExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    getProvenDomEventTargetPrototypeOwnerNames(unwrappedExpression, context.scopes).includes(
      "MediaQueryList",
    )
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return isProvenMediaQueryListExpression(initializer, context, nextVisitedSymbolIds);
  }
  if (
    !isNodeOfType(unwrappedExpression, "CallExpression") ||
    !isReactApiCall(unwrappedExpression, "useMemo", context.scopes, {
      resolveNamedAliases: true,
    })
  ) {
    return false;
  }
  const factory = getEffectCallback(unwrappedExpression, context.scopes);
  return Boolean(
    factory &&
    functionReturnsMatchingExpression(
      factory,
      context.scopes,
      (returnedExpression) => {
        const unwrappedReturnedExpression = stripParenExpression(returnedExpression);
        return (
          (isNodeOfType(unwrappedReturnedExpression, "Literal") &&
            unwrappedReturnedExpression.value === null) ||
          (isNodeOfType(unwrappedReturnedExpression, "Identifier") &&
            unwrappedReturnedExpression.name === "undefined" &&
            context.scopes.isGlobalReference(unwrappedReturnedExpression)) ||
          isProvenMediaQueryListExpression(
            unwrappedReturnedExpression,
            context,
            new Set(visitedSymbolIds),
          )
        );
      },
      context.cfg,
      "every",
    ),
  );
};

const isProvenLegacyMediaQueryListMethodCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  methodName: "addListener" | "removeListener",
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callNode.callee);
  return (
    callNode.arguments?.length === 1 &&
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === methodName &&
    isProvenMediaQueryListExpression(callee.object, context)
  );
};

const getCallRegistrationDetails = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): Pick<SubscribeLikeUsage, "receiverKey" | "registrationVerbName" | "eventKey" | "handlerKey"> => {
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return {
      receiverKey: null,
      registrationVerbName: null,
      eventKey: null,
      handlerKey: null,
    };
  }
  if (isProvenLegacyMediaQueryListMethodCall(callNode, "addListener", context)) {
    return {
      receiverKey: resolveStableMediaQueryListenerIdentityKey(callee.object, context),
      registrationVerbName: callee.property.name,
      eventKey: null,
      handlerKey: resolveStableMediaQueryListenerIdentityKey(callNode.arguments?.[0], context),
    };
  }
  return {
    receiverKey: resolveResourceIdentityKey(callee.object, context),
    registrationVerbName: callee.property.name,
    eventKey: resolveResourceIdentityKey(callNode.arguments?.[0], context),
    handlerKey: resolveResourceIdentityKey(callNode.arguments?.[1], context),
  };
};

const getSubscribeUsageCallbackArgument = (usage: SubscribeLikeUsage): EsTreeNode | null => {
  if (usage.kind !== "subscribe" || !isNodeOfType(usage.node, "CallExpression")) return null;
  const callbackArgument =
    usage.node.arguments?.length === UNARY_LISTENER_ARGUMENT_COUNT
      ? usage.node.arguments[UNARY_LISTENER_HANDLER_ARGUMENT_INDEX]
      : usage.node.arguments?.[EVENT_LISTENER_HANDLER_ARGUMENT_INDEX];
  return callbackArgument && isAstNode(callbackArgument) ? callbackArgument : null;
};

const resolveChannelClientKey = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  let currentCall: EsTreeNode = callNode;
  while (isNodeOfType(currentCall, "CallExpression")) {
    const callee = isNodeOfType(currentCall.callee, "ChainExpression")
      ? currentCall.callee.expression
      : currentCall.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.property, "Identifier")
    ) {
      return null;
    }
    if (callee.property.name === "channel") {
      return resolveResourceIdentityKey(callee.object, context);
    }
    currentCall = stripParenExpression(callee.object);
  }
  return null;
};

const findFluentChannelSubscriptionHandleKey = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  let terminalCall = callNode;
  let terminalRoot = findTransparentExpressionRoot(terminalCall);
  while (
    isNodeOfType(terminalRoot.parent, "MemberExpression") &&
    terminalRoot.parent.object === terminalRoot
  ) {
    const memberRoot = findTransparentExpressionRoot(terminalRoot.parent);
    const outerCall = memberRoot.parent;
    if (!isNodeOfType(outerCall, "CallExpression") || outerCall.callee !== memberRoot) break;
    terminalCall = outerCall;
    terminalRoot = findTransparentExpressionRoot(terminalCall);
  }
  if (
    terminalCall === callNode ||
    getSubscribeOrObserveMethodName(terminalCall) !== "subscribe" ||
    resolveChannelClientKey(terminalCall, context) === null
  ) {
    return null;
  }
  return findAssignedResourceKey(terminalCall, context, true);
};

const collectEffectOwnedResourceCallbackFunctions = (
  callback: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> => {
  const ownedFunctions = collectEffectInvokedFunctions(callback, context.scopes);
  const pendingFunctions = [...ownedFunctions];
  while (pendingFunctions.length > 0) {
    const ownerFunction = pendingFunctions.pop();
    if (!ownerFunction || !isFunctionLike(ownerFunction)) continue;
    walkAst(ownerFunction.body, (child: EsTreeNode) => {
      if (child !== ownerFunction.body && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "CallExpression")) return;
      let callbackArgument: EsTreeNode | null = null;
      if (
        isNodeOfType(child.callee, "Identifier") &&
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
      ) {
        const timerCallback = child.arguments?.[0];
        callbackArgument = timerCallback && isAstNode(timerCallback) ? timerCallback : null;
      } else {
        const promiseCallback = child.arguments?.find(
          (argument) => isAstNode(argument) && getPromiseChainCallForCallback(argument) === child,
        );
        if (promiseCallback && isAstNode(promiseCallback)) {
          callbackArgument = promiseCallback;
        }
        const registrationVerbName = getSubscribeOrObserveMethodName(child);
        if (registrationVerbName !== null) {
          const registrationDetails = getCallRegistrationDetails(child, context);
          callbackArgument = getSubscribeUsageCallbackArgument({
            kind: "subscribe",
            node: child,
            resourceName: registrationVerbName,
            handleKey: null,
            ...registrationDetails,
          });
        }
      }
      const callbackFunction = callbackArgument
        ? resolveExactLocalFunction(callbackArgument, context.scopes)
        : null;
      if (!callbackFunction || ownedFunctions.has(callbackFunction)) return;
      ownedFunctions.add(callbackFunction);
      pendingFunctions.push(callbackFunction);
    });
  }
  return ownedFunctions;
};

const findSubscribeLikeUsages = (
  callback: EsTreeNode,
  context: RuleContext,
): SubscribeLikeUsage[] => {
  const usages: SubscribeLikeUsage[] = [];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  let cleanupArgument: EsTreeNode | null = null;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const callbackStatements = callback.body.body ?? [];
    const lastCallbackStatement = callbackStatements[callbackStatements.length - 1];
    if (isNodeOfType(lastCallbackStatement, "ReturnStatement") && lastCallbackStatement.argument) {
      cleanupArgument = lastCallbackStatement.argument;
    }
  }
  const effectInvokedFunctions = collectEffectOwnedResourceCallbackFunctions(callback, context);

  walkAst(callback, (child: EsTreeNode) => {
    if (child !== callback && isFunctionLike(child)) {
      if (child === cleanupArgument) return false;
      if (!effectInvokedFunctions.has(child) && !isSynchronousIteratorCallback(child)) return false;
    }

    if (isSocketConstruction(child)) {
      usages.push({
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
        handleKey: findAssignedResourceKey(child, context, true),
        receiverKey: null,
        registrationVerbName: null,
        eventKey: null,
        handlerKey: null,
      });
      return;
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        node: child,
        resourceName: child.callee.name,
        handleKey: findAssignedResourceKey(child, context, true),
        receiverKey: null,
        registrationVerbName: child.callee.name,
        eventKey: null,
        handlerKey: null,
      });
      return;
    }

    const subscribeOrObserveMethodName = getSubscribeOrObserveMethodName(child);
    if (subscribeOrObserveMethodName !== null) {
      const registrationDetails = getCallRegistrationDetails(child, context);
      usages.push({
        kind: "subscribe",
        node: child,
        resourceName: subscribeOrObserveMethodName,
        handleKey:
          (subscribeOrObserveMethodName === "on"
            ? findFluentChannelSubscriptionHandleKey(child, context)
            : null) ?? findAssignedResourceKey(child, context, true),
        ...registrationDetails,
      });
    }
  });
  return usages.filter((usage) => isNodeReachableWithinFunction(usage.node, context));
};

const doMatchingNodesCoverEveryPathAfterUsage = (
  usageNode: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  let pathAnchor = usageNode;
  let pathOwner = findEnclosingFunction(pathAnchor);
  while (pathOwner && isSynchronousIteratorCallback(pathOwner)) {
    if (
      matchingNodes.length > 0 &&
      matchingNodes.every(
        (matchingNode) => context.cfg.enclosingFunction(matchingNode) === pathOwner,
      )
    ) {
      break;
    }
    const iteratorCall = pathOwner.parent;
    if (!isNodeOfType(iteratorCall, "CallExpression")) break;
    pathAnchor = iteratorCall;
    pathOwner = findEnclosingFunction(pathAnchor);
  }
  return doNodesCoverEveryPathAfterNode(pathAnchor, matchingNodes, context, usageNode);
};

// A resource registered and then released SYNCHRONOUSLY later in the same
// effect body (`const socket = new WebSocket(url); …; socket.close();`,
// `observer.observe(el); measure(); observer.disconnect();`) never outlives
// the effect run, so it needs no cleanup return. Only statement-level
// releases count (a `.close()` inside a nested callback runs later, if
// ever), and only releases positioned AFTER the registration — a
// release-then-register pair (`emitter.off(...); emitter.on(...)`,
// debounce-style `clearTimeout(...); setTimeout(...)`) still leaks the
// trailing registration.
const removeSynchronouslyReleasedUsages = (
  callback: EsTreeNode,
  usages: SubscribeLikeUsage[],
  context: RuleContext,
): SubscribeLikeUsage[] => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) return usages;
  const releaseCalls: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    const callNode = isNodeOfType(child, "ChainExpression") ? child.expression : child;
    if (!isNodeOfType(callNode, "CallExpression")) return;
    releaseCalls.push(child);
  });
  if (releaseCalls.length === 0) return usages;
  return usages.filter((usage) => {
    const usageStart = getRangeStart(usage.node);
    if (usageStart === null) return true;
    const matchingReleaseCalls = releaseCalls.filter((releaseCall) => {
      const releaseStart = getRangeStart(releaseCall);
      return (
        releaseStart !== null &&
        releaseStart > usageStart &&
        doesReleaseCallMatchUsage(releaseCall, usage, context)
      );
    });
    return !doMatchingNodesCoverEveryPathAfterUsage(usage.node, matchingReleaseCalls, context);
  });
};

const findForOfStatementForIteratorExpression = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNodeOfType<"ForOfStatement"> | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const bindingDeclarator = symbol?.bindingIdentifier.parent;
  const bindingDeclaration = bindingDeclarator?.parent;
  const forOfStatement = bindingDeclaration?.parent;
  const isStableIteratorBinding =
    isNodeOfType(bindingDeclaration, "VariableDeclaration") &&
    symbol?.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
  return symbol &&
    isNodeOfType(bindingDeclarator, "VariableDeclarator") &&
    bindingDeclarator.id === symbol.bindingIdentifier &&
    isStableIteratorBinding &&
    bindingDeclaration.declarations.length === 1 &&
    isNodeOfType(forOfStatement, "ForOfStatement") &&
    forOfStatement.left === bindingDeclaration &&
    forOfStatement.await !== true
    ? forOfStatement
    : null;
};

const isAssignmentFormForOfIteratorReference = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = stripParenExpression(expression);
  const referencedSymbolIds = new Set<number>();
  walkAst(unwrappedExpression, (expressionChild: EsTreeNode) => {
    if (!isNodeOfType(expressionChild, "Identifier")) return;
    const symbol = context.scopes.symbolFor(expressionChild);
    if (symbol) referencedSymbolIds.add(symbol.id);
  });
  if (referencedSymbolIds.size === 0) return false;
  const assignsReferencedSymbol = (root: EsTreeNode, requireAssignmentTarget: boolean): boolean => {
    let didAssignReferencedSymbol = false;
    walkAst(root, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "Identifier")) return;
      if (requireAssignmentTarget && !isWithinAssignmentTarget(child)) return;
      const childSymbol = context.scopes.symbolFor(child);
      if (childSymbol && referencedSymbolIds.has(childSymbol.id)) {
        didAssignReferencedSymbol = true;
        return false;
      }
    });
    return didAssignReferencedSymbol;
  };
  let currentNode = unwrappedExpression.parent;
  while (currentNode && !isFunctionLike(currentNode)) {
    if (isNodeOfType(currentNode, "ForOfStatement")) {
      const loopTarget = stripParenExpression(currentNode.left);
      if (
        !isNodeOfType(loopTarget, "VariableDeclaration") &&
        (assignsReferencedSymbol(loopTarget, false) ||
          assignsReferencedSymbol(currentNode.body, true))
      ) {
        return true;
      }
    }
    currentNode = currentNode.parent;
  }
  return false;
};

const isPrivatePlainConstIdentifier = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return (
    !isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration") &&
    !isNodeOfType(symbol.declarationNode.parent?.parent, "ExportDefaultDeclaration")
  );
};

const hasOnlyReplayableCollectionReferences = (
  identifier: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (
    !isNodeOfType(identifier, "Identifier") ||
    !isPrivatePlainConstIdentifier(identifier, context)
  ) {
    return false;
  }
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return false;
  if (visitedSymbolIds.has(symbol.id)) return true;
  visitedSymbolIds.add(symbol.id);
  return symbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    if (isNodeOfType(parent, "ForOfStatement") && parent.right === referenceRoot) return true;
    if (isNodeOfType(parent, "VariableDeclarator") && parent.init === referenceRoot) {
      const declaration = parent.parent;
      return isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(declaration, "VariableDeclaration") &&
        declaration.kind === "const"
        ? hasOnlyReplayableCollectionReferences(parent.id, context, visitedSymbolIds)
        : false;
    }
    return false;
  });
};

const resolveReplayableIteratorCollectionKeyUncached = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "Identifier") ||
    !isPrivatePlainConstIdentifier(unwrappedExpression, context)
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (isNodeOfType(initializer, "ArrayExpression")) {
    const hasOnlyPrimitiveElements = (initializer.elements ?? []).every(
      (element) =>
        element === null ||
        (isNodeOfType(element, "Literal") &&
          (element.value === null ||
            typeof element.value === "boolean" ||
            typeof element.value === "number" ||
            typeof element.value === "string")),
    );
    return hasOnlyPrimitiveElements &&
      hasOnlyReplayableCollectionReferences(symbol.bindingIdentifier, context, new Set())
      ? `symbol:${symbol.id}`
      : null;
  }
  if (!isNodeOfType(initializer, "Identifier")) return null;
  return resolveReplayableIteratorCollectionKeyUncached(initializer, context, visitedSymbolIds);
};

const resolveReplayableIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol) return null;
  let contextCache = REPLAYABLE_ITERATOR_COLLECTION_CACHE.get(context);
  if (!contextCache) {
    contextCache = new Map();
    REPLAYABLE_ITERATOR_COLLECTION_CACHE.set(context, contextCache);
  }
  if (contextCache.has(symbol.id)) return contextCache.get(symbol.id) ?? null;
  const collectionKey = resolveReplayableIteratorCollectionKeyUncached(expression, context);
  contextCache.set(symbol.id, collectionKey);
  return collectionKey;
};

const resolveIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const forOfStatement = findForOfStatementForIteratorExpression(unwrappedExpression, context);
  if (forOfStatement) {
    return resolveReplayableIteratorCollectionKey(forOfStatement.right, context);
  }
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || symbol.kind !== "parameter") return null;
  let callbackNode: EsTreeNode | null | undefined = symbol.bindingIdentifier.parent;
  while (callbackNode && !isFunctionLike(callbackNode)) callbackNode = callbackNode.parent;
  if (!callbackNode || !isFunctionLike(callbackNode)) return null;
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = stripParenExpression(callNode.callee);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    if (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Array" &&
      callee.property.name === "from" &&
      callNode.arguments?.[1] === callbackNode
    ) {
      return resolveExpressionKey(callNode.arguments[0], context);
    }
    if (callNode.arguments?.[0] === callbackNode) {
      return resolveExpressionKey(callee.object, context);
    }
  }
  return null;
};

const resolveCleanupIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  const forOfStatement = findForOfStatementForIteratorExpression(expression, context);
  return forOfStatement
    ? resolveExpressionKey(forOfStatement.right, context)
    : resolveIteratorCollectionKey(expression, context);
};

const setCollectionMutationLimit = (
  mutationLimits: Map<string, number>,
  collectionKey: string | null,
  maximumRelevantStart: number,
): void => {
  if (collectionKey === null) return;
  const existingMutationLimit = mutationLimits.get(collectionKey);
  if (existingMutationLimit === undefined || existingMutationLimit < maximumRelevantStart) {
    mutationLimits.set(collectionKey, maximumRelevantStart);
  }
};

const resolveExhaustiveCollectionReplayMutationLimits = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  maximumRelevantStart: number = Number.POSITIVE_INFINITY,
  visitedSymbolIds: Set<number> = new Set(),
): ReadonlyMap<string, number> => {
  const mutationLimits = new Map<string, number>();
  if (!expression) return mutationLimits;
  const unwrappedExpression = stripParenExpression(expression);
  const expressionKey = resolveExpressionKey(unwrappedExpression, context);
  setCollectionMutationLimit(mutationLimits, expressionKey, maximumRelevantStart);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) {
    return mutationLimits;
  }
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    !isPrivatePlainConstIdentifier(unwrappedExpression, context)
  ) {
    return mutationLimits;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  let copiedCollection: EsTreeNode | null = null;
  let copiedCollectionMaximumRelevantStart = maximumRelevantStart;
  if (isNodeOfType(initializer, "Identifier")) {
    copiedCollection = initializer;
  } else if (isNodeOfType(initializer, "ArrayExpression")) {
    const elements = initializer.elements ?? [];
    const onlyElement = elements[0];
    if (elements.length === 1 && onlyElement && isNodeOfType(onlyElement, "SpreadElement")) {
      copiedCollection = onlyElement.argument;
      copiedCollectionMaximumRelevantStart = Math.min(
        maximumRelevantStart,
        getRangeStart(initializer) ?? Number.POSITIVE_INFINITY,
      );
    }
  } else if (isNodeOfType(initializer, "CallExpression")) {
    const copyCallee = stripParenExpression(initializer.callee);
    if (
      isNodeOfType(copyCallee, "MemberExpression") &&
      !copyCallee.computed &&
      isNodeOfType(copyCallee.property, "Identifier")
    ) {
      const copyMethodName = copyCallee.property.name;
      const isArrayFrom =
        isNodeOfType(copyCallee.object, "Identifier") &&
        copyCallee.object.name === "Array" &&
        context.scopes.isGlobalReference(copyCallee.object) &&
        copyMethodName === "from" &&
        initializer.arguments.length === 1;
      const isReceiverCopy =
        ((copyMethodName === "slice" || copyMethodName === "concat") &&
          initializer.arguments.length === 0) ||
        copyMethodName === "toReversed" ||
        copyMethodName === "toSorted";
      if (isArrayFrom) {
        const sourceArgument = initializer.arguments[0];
        copiedCollection = isAstNode(sourceArgument) ? sourceArgument : null;
      } else if (isReceiverCopy) {
        copiedCollection = copyCallee.object;
      }
      if (copiedCollection) {
        copiedCollectionMaximumRelevantStart = Math.min(
          maximumRelevantStart,
          getRangeStart(initializer) ?? Number.POSITIVE_INFINITY,
        );
      }
    }
  }
  if (!copiedCollection) return mutationLimits;
  for (const [replayKey, mutationLimit] of resolveExhaustiveCollectionReplayMutationLimits(
    copiedCollection,
    context,
    copiedCollectionMaximumRelevantStart,
    nextVisitedSymbolIds,
  )) {
    setCollectionMutationLimit(mutationLimits, replayKey, mutationLimit);
  }
  return mutationLimits;
};

const resolveCleanupIteratorCollectionMutationLimits = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): ReadonlyMap<string, number> => {
  const forOfStatement = findForOfStatementForIteratorExpression(expression, context);
  if (forOfStatement) {
    return resolveExhaustiveCollectionReplayMutationLimits(forOfStatement.right, context);
  }
  const unwrappedExpression = expression ? stripParenExpression(expression) : null;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return new Map();
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || symbol.kind !== "parameter") return new Map();
  let callbackNode: EsTreeNode | null | undefined = symbol.bindingIdentifier.parent;
  while (callbackNode && !isFunctionLike(callbackNode)) callbackNode = callbackNode.parent;
  const callNode = callbackNode?.parent;
  const callee = isNodeOfType(callNode, "CallExpression")
    ? stripParenExpression(callNode.callee)
    : null;
  return isNodeOfType(callee, "MemberExpression")
    ? resolveExhaustiveCollectionReplayMutationLimits(callee.object, context)
    : new Map();
};

const doesCleanupIteratorMatchUsageCollection = (
  expression: EsTreeNode | null | undefined,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const usageCollectionKey = findContainingCollectionKey(usage.node, context);
  return (
    usageCollectionKey !== null &&
    resolveCleanupIteratorCollectionMutationLimits(expression, context).has(usageCollectionKey)
  );
};

const resolveReceiverIteratorCollectionKey = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const forOfStatement = findForOfStatementForIteratorExpression(unwrappedExpression, context);
  const collectionExpression = forOfStatement?.right;
  if (!collectionExpression) return null;
  const collectionIdentifier = stripParenExpression(collectionExpression);
  if (
    !isNodeOfType(collectionIdentifier, "Identifier") ||
    !isPrivatePlainConstIdentifier(collectionIdentifier, context)
  ) {
    return null;
  }
  const collectionSymbol = context.scopes.symbolFor(collectionIdentifier);
  const initializer = collectionSymbol?.initializer
    ? stripParenExpression(collectionSymbol.initializer)
    : null;
  return collectionSymbol &&
    isNodeOfType(initializer, "ArrayExpression") &&
    hasOnlyReplayableCollectionReferences(collectionIdentifier, context, new Set())
    ? `symbol:${collectionSymbol.id}`
    : null;
};

const isStableLoopReceiver = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return false;
  const unwrappedExpression = stripParenExpression(expression);
  return (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "document" &&
    context.scopes.isGlobalReference(unwrappedExpression)
  );
};

const resolveStableLoopHandlerSymbolId = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): number | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    (symbol.kind !== "const" && symbol.kind !== "function" && symbol.kind !== "parameter") ||
    !symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return null;
  }
  return symbol.id;
};

const doesLoopJumpExitForOfIteration = (
  jumpStatement: EsTreeNode,
  forOfStatement: EsTreeNodeOfType<"ForOfStatement">,
): boolean => {
  if (
    !isNodeOfType(jumpStatement, "BreakStatement") &&
    !isNodeOfType(jumpStatement, "ContinueStatement")
  ) {
    return false;
  }
  if (jumpStatement.label) {
    let ancestor = jumpStatement.parent;
    while (ancestor) {
      if (
        isNodeOfType(ancestor, "LabeledStatement") &&
        ancestor.label.name === jumpStatement.label.name
      ) {
        return isAstDescendant(forOfStatement, ancestor.body);
      }
      ancestor = ancestor.parent;
    }
    return false;
  }
  let ancestor = jumpStatement.parent;
  while (ancestor) {
    const isLoop =
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement");
    if (isLoop) return ancestor === forOfStatement;
    if (
      isNodeOfType(jumpStatement, "BreakStatement") &&
      isNodeOfType(ancestor, "SwitchStatement")
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isDirectExhaustiveForOfRelease = (
  releaseNode: EsTreeNode,
  forOfStatement: EsTreeNodeOfType<"ForOfStatement">,
  context: RuleContext,
): boolean => {
  const releaseRoot = findTransparentExpressionRoot(releaseNode);
  const releaseStatement = releaseRoot.parent;
  if (!isNodeOfType(releaseStatement, "ExpressionStatement")) return false;
  const isDirectLoopBodyStatement = isNodeOfType(forOfStatement.body, "BlockStatement")
    ? releaseStatement.parent === forOfStatement.body
    : releaseStatement === forOfStatement.body;
  if (!isDirectLoopBodyStatement) return false;
  const cleanupOwnerFunction = findEnclosingFunction(releaseStatement);
  let hasTerminatingLoopExit = false;
  let hasContinueBeforeRelease = false;
  walkAst(forOfStatement.body, (child: EsTreeNode) => {
    if (hasTerminatingLoopExit || hasContinueBeforeRelease) return false;
    if (child !== forOfStatement.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      hasTerminatingLoopExit = true;
      return false;
    }
    if (
      isNodeOfType(child, "ThrowStatement") &&
      (!cleanupOwnerFunction ||
        !canNodeReachLaterNodeWithinFunction(
          child,
          releaseStatement,
          cleanupOwnerFunction,
          context,
        ))
    ) {
      hasTerminatingLoopExit = true;
      return false;
    }
    if (
      isNodeOfType(child, "BreakStatement") &&
      doesLoopJumpExitForOfIteration(child, forOfStatement)
    ) {
      hasTerminatingLoopExit = true;
      return false;
    }
    if (
      isNodeOfType(child, "ContinueStatement") &&
      doesLoopJumpExitForOfIteration(child, forOfStatement) &&
      (getRangeStart(child) ?? -1) < (getRangeStart(releaseStatement) ?? 0)
    ) {
      hasContinueBeforeRelease = true;
      return false;
    }
  });
  return !hasTerminatingLoopExit && !hasContinueBeforeRelease;
};

const findCollectionMappingCall = (callbackNode: EsTreeNode): EsTreeNode | null => {
  if (
    (!isNodeOfType(callbackNode, "ArrowFunctionExpression") &&
      !isNodeOfType(callbackNode, "FunctionExpression")) ||
    callbackNode.async ||
    callbackNode.generator
  ) {
    return null;
  }
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = stripParenExpression(callNode.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return null;
  }
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from" &&
    callNode.arguments?.[1] === callbackNode
  ) {
    return callNode;
  }
  return callee.property.name === "map" && callNode.arguments?.[0] === callbackNode
    ? callNode
    : null;
};

const findMappedResourceCollectionKey = (
  resourceNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  const callbackNode = findEnclosingFunction(resourceNode);
  if (
    !callbackNode ||
    (!isNodeOfType(callbackNode, "ArrowFunctionExpression") &&
      !isNodeOfType(callbackNode, "FunctionExpression"))
  ) {
    return null;
  }
  const mappingCall = findCollectionMappingCall(callbackNode);
  if (!mappingCall) return null;

  if (isNodeOfType(callbackNode.body, "BlockStatement")) {
    const resourceRoot = findTransparentExpressionRoot(resourceNode);
    const resourceDeclarator = resourceRoot.parent;
    const resourceDeclaration = resourceDeclarator?.parent;
    if (
      !isNodeOfType(resourceDeclarator, "VariableDeclarator") ||
      resourceDeclarator.init !== resourceRoot ||
      !isNodeOfType(resourceDeclarator.id, "Identifier") ||
      !isNodeOfType(resourceDeclaration, "VariableDeclaration") ||
      resourceDeclaration.kind !== "const" ||
      resourceDeclaration.parent !== callbackNode.body
    ) {
      return null;
    }

    const returnStatements: EsTreeNode[] = [];
    walkAst(callbackNode.body, (child: EsTreeNode) => {
      if (child !== callbackNode.body && isFunctionLike(child)) return false;
      if (isNodeOfType(child, "ReturnStatement")) returnStatements.push(child);
    });
    const returnStatement = returnStatements[0];
    const callbackStatements = callbackNode.body.body ?? [];
    const returnedIdentifier =
      isNodeOfType(returnStatement, "ReturnStatement") && returnStatement.argument
        ? stripParenExpression(returnStatement.argument)
        : null;
    const resourceSymbol = context.scopes.symbolFor(resourceDeclarator.id);
    if (
      returnStatements.length !== 1 ||
      callbackStatements[callbackStatements.length - 1] !== returnStatement ||
      !isNodeOfType(returnedIdentifier, "Identifier") ||
      !resourceSymbol ||
      context.scopes.symbolFor(returnedIdentifier)?.id !== resourceSymbol.id ||
      !doMatchingNodesCoverEveryPathAfterUsage(resourceNode, [returnStatement], context)
    ) {
      return null;
    }
  } else if (findTransparentExpressionRoot(resourceNode) !== callbackNode.body) {
    return null;
  }

  const mappingRoot = findTransparentExpressionRoot(mappingCall);
  const collectionDeclarator = mappingRoot.parent;
  return isNodeOfType(collectionDeclarator, "VariableDeclarator") &&
    collectionDeclarator.init === mappingRoot
    ? resolveExpressionKey(collectionDeclarator.id, context)
    : null;
};

const resolveDirectResourcePushCollectionSymbol = (
  resourceNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const resourceRoot = findTransparentExpressionRoot(resourceNode);
  const pushCall = resourceRoot.parent;
  const pushCallee = isNodeOfType(pushCall, "CallExpression")
    ? stripParenExpression(pushCall.callee)
    : null;
  if (
    !isNodeOfType(pushCall, "CallExpression") ||
    !pushCall.arguments.some((argument) => argument === resourceRoot) ||
    !isNodeOfType(pushCallee, "MemberExpression") ||
    pushCallee.computed ||
    !isNodeOfType(pushCallee.object, "Identifier") ||
    !isNodeOfType(pushCallee.property, "Identifier") ||
    pushCallee.property.name !== "push" ||
    !isPrivatePlainConstIdentifier(pushCallee.object, context)
  ) {
    return null;
  }
  const collectionSymbol = context.scopes.symbolFor(pushCallee.object);
  const initializer = collectionSymbol?.initializer
    ? stripParenExpression(collectionSymbol.initializer)
    : null;
  return collectionSymbol &&
    isNodeOfType(initializer, "ArrayExpression") &&
    (initializer.elements?.length ?? 0) === 0
    ? collectionSymbol
    : null;
};

const findContainingCollectionKey = (
  resourceNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  const pushedCollectionSymbol = resolveDirectResourcePushCollectionSymbol(resourceNode, context);
  if (pushedCollectionSymbol) return `symbol:${pushedCollectionSymbol.id}`;
  const mappedCollectionKey = findMappedResourceCollectionKey(resourceNode, context);
  if (mappedCollectionKey !== null) return mappedCollectionKey;
  let currentNode = resourceNode;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isFunctionLike(parentNode)) return null;
    if (isNodeOfType(parentNode, "VariableDeclarator") && parentNode.init === currentNode) {
      return resolveExpressionKey(parentNode.id, context);
    }
    currentNode = parentNode;
    parentNode = currentNode.parent;
  }
  return null;
};

const findPushedResourceCollectionKey = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(usage.node, "CallExpression")) return null;
  const registrationCallee = stripParenExpression(usage.node.callee);
  if (!isNodeOfType(registrationCallee, "MemberExpression") || registrationCallee.computed) {
    return null;
  }
  const resourceIdentifier = stripParenExpression(registrationCallee.object);
  if (!isPrivatePlainConstIdentifier(resourceIdentifier, context)) return null;
  const resourceSymbol = context.scopes.symbolFor(resourceIdentifier);
  if (!resourceSymbol) return null;

  const pushCalls = resourceSymbol.references.flatMap((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const callNode = referenceRoot.parent;
    if (
      !isNodeOfType(callNode, "CallExpression") ||
      !callNode.arguments?.some((argument) => argument === referenceRoot)
    ) {
      return [];
    }
    const pushCallee = stripParenExpression(callNode.callee);
    return isNodeOfType(pushCallee, "MemberExpression") &&
      !pushCallee.computed &&
      isNodeOfType(pushCallee.object, "Identifier") &&
      isNodeOfType(pushCallee.property, "Identifier") &&
      pushCallee.property.name === "push"
      ? [callNode]
      : [];
  });
  if (pushCalls.length !== 1) return null;
  const pushCall = pushCalls[0];
  if (
    findEnclosingFunction(pushCall) !== findEnclosingFunction(usage.node) ||
    !doMatchingNodesCoverEveryPathAfterUsage(usage.node, [pushCall], context)
  ) {
    return null;
  }

  const pushCallee = stripParenExpression(pushCall.callee);
  if (
    !isNodeOfType(pushCallee, "MemberExpression") ||
    !isNodeOfType(pushCallee.object, "Identifier") ||
    !isPrivatePlainConstIdentifier(pushCallee.object, context)
  ) {
    return null;
  }
  const collectionSymbol = context.scopes.symbolFor(pushCallee.object);
  const collectionInitializer = collectionSymbol?.initializer
    ? stripParenExpression(collectionSymbol.initializer)
    : null;
  if (
    !collectionSymbol ||
    !isNodeOfType(collectionInitializer, "ArrayExpression") ||
    (collectionInitializer.elements?.length ?? 0) !== 0 ||
    findEnclosingFunction(collectionSymbol.declarationNode) !== findEnclosingFunction(usage.node)
  ) {
    return null;
  }
  const hasOnlyCollectionRetentionAndIteration = collectionSymbol.references.every((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const forOfStatement = referenceRoot.parent;
    if (
      isNodeOfType(forOfStatement, "ForOfStatement") &&
      forOfStatement.right === referenceRoot &&
      forOfStatement.await !== true
    ) {
      return true;
    }
    const memberNode = referenceRoot.parent;
    const callNode = memberNode?.parent;
    if (
      !isNodeOfType(memberNode, "MemberExpression") ||
      memberNode.object !== referenceRoot ||
      memberNode.computed ||
      !isNodeOfType(memberNode.property, "Identifier") ||
      !isNodeOfType(callNode, "CallExpression") ||
      callNode.callee !== memberNode
    ) {
      return false;
    }
    return memberNode.property.name === "forEach" || memberNode.property.name === "push";
  });
  return hasOnlyCollectionRetentionAndIteration
    ? resolveExpressionKey(pushCallee.object, context)
    : null;
};

const resolveStableValue = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return unwrappedExpression;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const isUnreassignedMutableBinding =
    (symbol?.kind === "let" || symbol?.kind === "var") &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ) &&
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length === 1;
  const recursiveFunctionSymbol =
    symbol?.kind === "function" && isFunctionLike(symbol.declarationNode)
      ? context.scopes
          .ownScopeFor(symbol.declarationNode)
          ?.symbols.find(
            (candidate) =>
              candidate.name === symbol.name &&
              candidate.declarationNode === symbol.declarationNode,
          )
      : null;
  const isUnreassignedFunctionBinding =
    symbol?.kind === "function" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ) &&
    (!recursiveFunctionSymbol ||
      recursiveFunctionSymbol.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      )) &&
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length === 1;
  if (
    !symbol ||
    (symbol.kind !== "const" && !isUnreassignedMutableBinding && !isUnreassignedFunctionBinding) ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return unwrappedExpression;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveStableValue(symbol.initializer, context, visitedSymbolIds);
};

const resolveObjectExpression = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const resolvedExpression = resolveStableValue(expression, context);
  return isNodeOfType(resolvedExpression, "ObjectExpression") ? resolvedExpression : null;
};

const getListenerAbortControllerKey = (
  usage: SubscribeLikeUsage,
  context: RuleContext,
): string | null => {
  if (
    usage.registrationVerbName !== "addEventListener" ||
    !isNodeOfType(usage.node, "CallExpression")
  ) {
    return null;
  }
  const optionsArgument = usage.node.arguments?.[2];
  const optionsObject = resolveObjectExpression(optionsArgument, context);
  if (!optionsObject) return null;
  for (const property of optionsObject.properties ?? []) {
    if (!isNodeOfType(property, "Property") || getStaticPropertyKeyName(property) !== "signal") {
      continue;
    }
    const signalKey = resolveExpressionKey(property.value, context);
    return signalKey?.endsWith(".signal") ? signalKey.slice(0, -".signal".length) : null;
  }
  return null;
};

const findEnclosingForEachCall = (node: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  const callbackNode = isFunctionLike(node) ? node : findEnclosingFunction(node);
  if (
    !callbackNode ||
    !isFunctionLike(callbackNode) ||
    callbackNode.async ||
    callbackNode.generator
  )
    return null;
  const callNode = callbackNode.parent;
  if (!isNodeOfType(callNode, "CallExpression") || callNode.arguments?.[0] !== callbackNode) {
    return null;
  }
  const callee = stripParenExpression(callNode.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "forEach"
    ? callNode
    : null;
};

const findDirectCallForReference = (identifier: EsTreeNode): EsTreeNode | null => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const callNode = expressionRoot.parent;
  return isNodeOfType(callNode, "CallExpression") && callNode.callee === expressionRoot
    ? callNode
    : null;
};

const findSingleDirectInvocation = (
  functionNode: EsTreeNode,
  caller: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier || resolveStableValue(bindingIdentifier, context) !== functionNode) {
    return null;
  }
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return null;
  const invocationCalls = symbol.references.flatMap((reference) => {
    const callNode = findDirectCallForReference(reference.identifier);
    return callNode ? [callNode] : [];
  });
  if (invocationCalls.length !== 1 || symbol.references.length !== 1) return null;
  const invocationCall = invocationCalls[0];
  return findEnclosingFunction(invocationCall) === caller &&
    isNodeReachableWithinFunction(invocationCall, context)
    ? invocationCall
    : null;
};

const isGlobalObserverConstruction = (
  node: EsTreeNode,
  context: RuleContext,
): node is EsTreeNodeOfType<"NewExpression"> => {
  if (!isNodeOfType(node, "NewExpression")) return false;
  const constructor = stripParenExpression(node.callee);
  return (
    isNodeOfType(constructor, "Identifier") &&
    EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(constructor.name) &&
    context.scopes.isGlobalReference(constructor)
  );
};

const isNullishObserverInitializer = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!expression) return true;
  const initializer = stripParenExpression(expression);
  return (
    (isNodeOfType(initializer, "Literal") && initializer.value === null) ||
    (isNodeOfType(initializer, "Identifier") &&
      initializer.name === "undefined" &&
      context.scopes.isGlobalReference(initializer))
  );
};

const findReconnectHelperInvocation = (
  usageFunction: EsTreeNode,
  effectCallback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): EsTreeNode | null => {
  if (
    !isFunctionLike(usageFunction) ||
    usageFunction.async ||
    usageFunction.generator ||
    usage.receiverKey === null ||
    !isNodeOfType(usage.node, "CallExpression")
  ) {
    return null;
  }
  const usageCallee = stripParenExpression(usage.node.callee);
  const usageReceiver = isNodeOfType(usageCallee, "MemberExpression")
    ? stripParenExpression(usageCallee.object)
    : null;
  if (!usageReceiver || !isNodeOfType(usageReceiver, "Identifier")) return null;
  const observerSymbol = context.scopes.symbolFor(usageReceiver);
  const observerDeclaration = observerSymbol?.declarationNode;
  if (
    !observerSymbol ||
    (observerSymbol.kind !== "let" && observerSymbol.kind !== "var") ||
    !isNodeOfType(observerDeclaration, "VariableDeclarator") ||
    observerDeclaration.id !== observerSymbol.bindingIdentifier ||
    findEnclosingFunction(observerDeclaration) !== effectCallback ||
    !isNullishObserverInitializer(observerDeclaration.init, context)
  ) {
    return null;
  }

  const observerAssignments: EsTreeNodeOfType<"AssignmentExpression">[] = [];
  for (const reference of observerSymbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const referenceParent = referenceRoot.parent;
    if (
      isNodeOfType(referenceParent, "AssignmentExpression") &&
      referenceParent.operator === "=" &&
      referenceParent.left === referenceRoot
    ) {
      observerAssignments.push(referenceParent);
      continue;
    }
    const member = referenceParent;
    const methodCall = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== referenceRoot ||
      !isNodeOfType(methodCall, "CallExpression") ||
      methodCall.callee !== member ||
      !["disconnect", "observe", "unobserve"].includes(getStaticPropertyKeyName(member) ?? "")
    ) {
      return null;
    }
  }
  if (observerAssignments.length !== 1) return null;
  const observerAssignment = observerAssignments[0];
  if (!observerAssignment) return null;
  const observerConstruction = stripParenExpression(observerAssignment.right);
  if (
    !isGlobalObserverConstruction(observerConstruction, context) ||
    findEnclosingFunction(observerAssignment) !== usageFunction ||
    !canNodeReachLaterNodeWithinFunction(observerAssignment, usage.node, usageFunction, context)
  ) {
    return null;
  }

  const matchingReleaseAnchors: EsTreeNode[] = [];
  const assignmentStart = getRangeStart(observerAssignment);
  if (assignmentStart === null) return null;
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const childStart = getRangeStart(child);
    if (
      childStart === null ||
      childStart >= assignmentStart ||
      !doesReleaseCallMatchUsage(child, usage, context)
    ) {
      return;
    }
    matchingReleaseAnchors.push(
      findLiveExpressionGuardForRelease(child, usageFunction, usage.receiverKey ?? "", context) ??
        child,
    );
  });
  if (!doNodesCoverEveryPathFromFunctionEntry(usageFunction, matchingReleaseAnchors, context)) {
    return null;
  }

  const functionBindingIdentifier = getFunctionBindingIdentifier(usageFunction);
  const functionSymbol = functionBindingIdentifier
    ? context.scopes.symbolFor(functionBindingIdentifier)
    : null;
  if (!functionSymbol) return null;
  const directInvocations: EsTreeNode[] = [];
  for (const reference of functionSymbol.references) {
    const directCall = findDirectCallForReference(reference.identifier);
    if (directCall && findEnclosingFunction(directCall) === effectCallback) {
      directInvocations.push(directCall);
      continue;
    }
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const construction = referenceRoot.parent;
    if (
      !construction ||
      !isGlobalObserverConstruction(construction, context) ||
      findEnclosingFunction(construction) !== usageFunction ||
      !construction.arguments.some((argument) => argument === referenceRoot)
    ) {
      return null;
    }
  }
  const directInvocation = directInvocations.length === 1 ? directInvocations[0] : null;
  return directInvocation && isNodeReachableWithinFunction(directInvocation, context)
    ? directInvocation
    : null;
};

const resolveCleanupPathAnchor = (
  usageNode: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
  usage?: SubscribeLikeUsage,
): EsTreeNode => {
  const usageFunction = findEnclosingFunction(usageNode);
  if (!usageFunction || usageFunction === effectCallback) return usageNode;
  return (
    findSingleDirectInvocation(usageFunction, effectCallback, context) ??
    (usage ? findReconnectHelperInvocation(usageFunction, effectCallback, usage, context) : null) ??
    usageNode
  );
};

const resolveSingleAssignedCleanupFunction = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  if (
    !symbol ||
    (symbol.kind !== "let" && symbol.kind !== "var") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !isNodeOfType(initializer, "Literal") ||
    initializer.value !== null ||
    symbol.scope.symbols.filter((candidate) => candidate.name === symbol.name).length !== 1
  ) {
    return null;
  }
  const assignmentReferences = symbol.references.filter((reference) =>
    isWithinAssignmentTarget(reference.identifier),
  );
  if (assignmentReferences.length !== 1) return null;
  const assignmentReference = assignmentReferences[0];
  const assignmentTarget = findTransparentExpressionRoot(assignmentReference.identifier);
  const assignmentNode = assignmentTarget.parent;
  if (
    !isNodeOfType(assignmentNode, "AssignmentExpression") ||
    assignmentNode.operator !== "=" ||
    assignmentNode.left !== assignmentTarget ||
    findEnclosingFunction(assignmentNode) !== findEnclosingFunction(usage.node) ||
    !doMatchingNodesCoverEveryPathAfterUsage(usage.node, [assignmentNode], context)
  ) {
    return null;
  }
  const assignedValue = stripParenExpression(assignmentNode.right);
  return isFunctionLike(assignedValue) ? assignedValue : null;
};

const resolveCleanupHelperParameterSubstitutions = (
  helperFunction: EsTreeNode,
  helperCall: EsTreeNode,
  context: RuleContext,
  inheritedSubstitutions: ReadonlyMap<number, EsTreeNode>,
): ReadonlyMap<number, EsTreeNode> | null => {
  if (!isFunctionLike(helperFunction) || !isNodeOfType(helperCall, "CallExpression")) return null;
  const substitutions = new Map(inheritedSubstitutions);
  for (let parameterIndex = 0; parameterIndex < helperFunction.params.length; parameterIndex += 1) {
    const parameter = helperFunction.params[parameterIndex];
    const argument = helperCall.arguments?.[parameterIndex];
    if (!isNodeOfType(parameter, "Identifier")) continue;
    if (!argument || isNodeOfType(argument, "SpreadElement")) continue;
    const parameterSymbol = context.scopes.symbolFor(parameter);
    const hasDirectParameterWrite = parameterSymbol?.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const referenceParent = referenceRoot.parent;
      return (
        (isNodeOfType(referenceParent, "AssignmentExpression") &&
          referenceParent.left === referenceRoot) ||
        (isNodeOfType(referenceParent, "UpdateExpression") &&
          referenceParent.argument === referenceRoot) ||
        (isNodeOfType(referenceParent, "UnaryExpression") &&
          referenceParent.operator === "delete" &&
          referenceParent.argument === referenceRoot)
      );
    });
    if (!parameterSymbol || hasDirectParameterWrite) {
      return null;
    }
    substitutions.set(parameterSymbol.id, argument);
  }
  return substitutions;
};

const isDirectExhaustiveTimerCollectionCleanup = (
  cleanupNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (usage.kind !== "timer") return false;
  const cleanupCall = isNodeOfType(cleanupNode, "ChainExpression")
    ? cleanupNode.expression
    : cleanupNode;
  const cleanupCallee = isNodeOfType(cleanupCall, "CallExpression")
    ? stripParenExpression(cleanupCall.callee)
    : null;
  const cleanupCallback = isNodeOfType(cleanupCall, "CallExpression")
    ? cleanupCall.arguments[0]
    : null;
  const expectedCleanupName =
    usage.registrationVerbName === "setInterval" ? "clearInterval" : "clearTimeout";
  const retainedCollectionKey = findContainingCollectionKey(usage.node, context);
  if (
    !isNodeOfType(cleanupCall, "CallExpression") ||
    !isNodeOfType(cleanupCallee, "MemberExpression") ||
    cleanupCallee.computed ||
    !isNodeOfType(cleanupCallee.property, "Identifier") ||
    cleanupCallee.property.name !== "forEach" ||
    !isNodeOfType(cleanupCallback, "Identifier") ||
    cleanupCallback.name !== expectedCleanupName ||
    !context.scopes.isGlobalReference(cleanupCallback) ||
    retainedCollectionKey === null ||
    retainedCollectionKey !== resolveExpressionKey(cleanupCallee.object, context)
  ) {
    return false;
  }
  const collectionMutationLimits = resolveExhaustiveCollectionReplayMutationLimits(
    cleanupCallee.object,
    context,
  );
  return (
    collectionMutationLimits.has(retainedCollectionKey) &&
    !hasCollectionMutationBeforeRelease(usage.node, cleanupCall, collectionMutationLimits, context)
  );
};

const doesCleanupFunctionReleaseUsage = (
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode> = new Set(),
  parameterSubstitutions: ReadonlyMap<number, EsTreeNode> = new Map(),
  requireExhaustivePaths = false,
): boolean => {
  if (!isFunctionLike(cleanupFunction) || visitedFunctions.has(cleanupFunction)) return false;
  visitedFunctions.add(cleanupFunction);
  let didCleanupFunctionMatch = false;
  const matchingLoopOrHelperAnchors: EsTreeNode[] = [];
  walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
    if (didCleanupFunctionMatch) return false;
    if (
      cleanupChild !== cleanupFunction.body &&
      isFunctionLike(cleanupChild) &&
      !isSynchronousIteratorCallback(cleanupChild)
    ) {
      return false;
    }
    const cleanupCall = isNodeOfType(cleanupChild, "ChainExpression")
      ? cleanupChild.expression
      : cleanupChild;
    if (isDirectExhaustiveTimerCollectionCleanup(cleanupChild, usage, context)) {
      if (requireExhaustivePaths) {
        matchingLoopOrHelperAnchors.push(cleanupChild);
        return;
      }
      didCleanupFunctionMatch = true;
      return false;
    }
    if (doesReleaseCallMatchUsage(cleanupChild, usage, context, parameterSubstitutions)) {
      const cleanupForEachCall = findEnclosingForEachCall(cleanupChild);
      const cleanupCallee = isNodeOfType(cleanupCall, "CallExpression")
        ? stripParenExpression(cleanupCall.callee)
        : null;
      const cleanupIteratorExpression = isNodeOfType(cleanupCallee, "MemberExpression")
        ? cleanupCallee.object
        : cleanupCallee;
      const cleanupReceiverForOfStatement = findForOfStatementForIteratorExpression(
        cleanupIteratorExpression,
        context,
      );
      const cleanupReceiverCollectionKey = resolveCleanupIteratorCollectionKey(
        cleanupIteratorExpression,
        context,
      );
      const cleanupCollectionMutationLimits = resolveCleanupIteratorCollectionMutationLimits(
        cleanupIteratorExpression,
        context,
      );
      const retainedResourceCollectionKey =
        findPushedResourceCollectionKey(usage, context) ??
        findContainingCollectionKey(usage.node, context);
      if (
        cleanupReceiverCollectionKey !== null &&
        findEnclosingFunction(cleanupChild) !== cleanupFunction
      ) {
        const cleanupIteratorFunction = findEnclosingFunction(cleanupChild);
        if (
          cleanupForEachCall &&
          cleanupIteratorFunction &&
          isFunctionLike(cleanupIteratorFunction) &&
          retainedResourceCollectionKey !== null &&
          cleanupCollectionMutationLimits.has(retainedResourceCollectionKey) &&
          doNodesCoverEveryPathFromFunctionEntry(
            cleanupIteratorFunction,
            [cleanupChild],
            context,
          ) &&
          !hasCollectionMutationBeforeRelease(
            usage.node,
            cleanupChild,
            cleanupCollectionMutationLimits,
            context,
          )
        ) {
          matchingLoopOrHelperAnchors.push(cleanupForEachCall);
        }
        return;
      }
      const cleanupEventArgument = isNodeOfType(cleanupCall, "CallExpression")
        ? cleanupCall.arguments?.[0]
        : null;
      const cleanupForOfStatement =
        findForOfStatementForIteratorExpression(cleanupEventArgument, context) ??
        cleanupReceiverForOfStatement;
      if (!cleanupForOfStatement) {
        if (requireExhaustivePaths) {
          const handleGuard = findDirectHandleGuardForRelease(
            cleanupChild,
            cleanupFunction,
            usage,
            context,
          );
          matchingLoopOrHelperAnchors.push(handleGuard ?? cleanupChild);
          return;
        }
        didCleanupFunctionMatch = true;
        return false;
      }
      if (
        !cleanupFunction.async &&
        !cleanupFunction.generator &&
        isDirectExhaustiveForOfRelease(cleanupChild, cleanupForOfStatement, context) &&
        (retainedResourceCollectionKey === null ||
          cleanupCollectionMutationLimits.size === 0 ||
          (cleanupCollectionMutationLimits.has(retainedResourceCollectionKey) &&
            !hasCollectionMutationBeforeRelease(
              usage.node,
              cleanupChild,
              cleanupCollectionMutationLimits,
              context,
            )))
      ) {
        matchingLoopOrHelperAnchors.push(cleanupForOfStatement);
      }
      return;
    }
    if (!isNodeOfType(cleanupCall, "CallExpression")) return;
    const stableHelperValue = resolveStableValue(cleanupCall.callee, context);
    const helperFunction = isNodeOfType(stableHelperValue, "Identifier")
      ? resolveSingleAssignedCleanupFunction(stableHelperValue, usage, context)
      : stableHelperValue
        ? resolveRefOwnedCleanupFunction(stableHelperValue, context)
        : null;
    const helperParameterSubstitutions =
      helperFunction && isFunctionLike(helperFunction)
        ? resolveCleanupHelperParameterSubstitutions(
            helperFunction,
            cleanupCall,
            context,
            parameterSubstitutions,
          )
        : null;
    if (
      helperFunction &&
      isFunctionLike(helperFunction) &&
      helperParameterSubstitutions &&
      !helperFunction.async &&
      !helperFunction.generator &&
      doesCleanupFunctionReleaseUsage(
        helperFunction,
        usage,
        context,
        new Set(visitedFunctions),
        helperParameterSubstitutions,
        requireExhaustivePaths,
      )
    ) {
      matchingLoopOrHelperAnchors.push(cleanupCall);
    }
  });
  const cleanupBodyRoot = findTransparentExpressionRoot(cleanupFunction.body);
  if (
    requireExhaustivePaths &&
    matchingLoopOrHelperAnchors.some(
      (releaseAnchor) => findTransparentExpressionRoot(releaseAnchor) === cleanupBodyRoot,
    )
  ) {
    return true;
  }
  return (
    didCleanupFunctionMatch ||
    doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, matchingLoopOrHelperAnchors, context)
  );
};

const cleanupReturnsExhaustivelyReleaseUsage = (
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  cleanupReturns.length > 0 &&
  cleanupReturns.every((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return Boolean(
      cleanupFunction &&
      isFunctionLike(cleanupFunction) &&
      doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context, new Set(), new Map(), true),
    );
  });

const doesBoundCleanupReleaseUsage = (
  expression: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const bindCallee = stripParenExpression(callExpression.callee);
  if (
    !isNodeOfType(bindCallee, "MemberExpression") ||
    bindCallee.computed ||
    !isNodeOfType(bindCallee.property, "Identifier") ||
    bindCallee.property.name !== "bind"
  ) {
    return false;
  }
  const releaseMember = stripParenExpression(bindCallee.object);
  if (
    !isNodeOfType(releaseMember, "MemberExpression") ||
    releaseMember.computed ||
    !isNodeOfType(releaseMember.property, "Identifier")
  ) {
    return false;
  }
  const releaseReceiverKey = resolveExpressionKey(releaseMember.object, context);
  if (
    releaseReceiverKey === null ||
    releaseReceiverKey !== resolveExpressionKey(callExpression.arguments?.[0], context)
  ) {
    return false;
  }
  const releaseVerbName = releaseMember.property.name;
  if (doesSocketOwnerReleaseListenerUsage(releaseReceiverKey, releaseVerbName, usage, context)) {
    return true;
  }
  if (usage.kind === "socket") {
    return (
      doesResourceKeyMatchUsageHandle(releaseReceiverKey, usage, context) &&
      (SOCKET_RELEASE_VERB_NAMES.has(releaseVerbName) ||
        UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName))
    );
  }
  return (
    usage.kind === "subscribe" &&
    doesResourceKeyMatchUsageHandle(releaseReceiverKey, usage, context) &&
    (releaseVerbName === "unsubscribe" ||
      releaseVerbName === "unsub" ||
      releaseVerbName === "close" ||
      releaseVerbName === "unwatch" ||
      releaseVerbName === "unlisten" ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(releaseVerbName))
  );
};

const callbackReturnsCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (callback.async) return false;
  const doesReturnedValueReleaseUsage = (returnedValue: EsTreeNode): boolean => {
    if (doesBoundCleanupReleaseUsage(returnedValue, usage, context)) return true;
    const cleanupFunction = resolveStableValue(returnedValue, context);
    if (cleanupFunction && doesBoundCleanupReleaseUsage(cleanupFunction, usage, context)) {
      return true;
    }
    return Boolean(
      cleanupFunction &&
      isFunctionLike(cleanupFunction) &&
      doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context),
    );
  };
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return doesReturnedValueReleaseUsage(stripParenExpression(callback.body));
  }
  const matchingCleanupReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      doesReturnedValueReleaseUsage(stripParenExpression(child.argument))
    ) {
      matchingCleanupReturns.push(child);
    }
  });
  return doNodesCoverEveryPathFromFunctionEntry(callback, matchingCleanupReturns, context);
};

const doesTestRequireLiveExpressionKey = (
  test: EsTreeNode,
  expressionKey: string,
  context: RuleContext,
): boolean => {
  if (resolveExpressionKey(test, context) === expressionKey) return true;
  const unwrappedTest = stripParenExpression(test);
  if (
    !isNodeOfType(unwrappedTest, "BinaryExpression") ||
    (unwrappedTest.operator !== "!=" && unwrappedTest.operator !== "!==")
  ) {
    return false;
  }
  const isNullishOperand = (operand: EsTreeNode): boolean => {
    const unwrappedOperand = stripParenExpression(operand);
    return (
      (isNodeOfType(unwrappedOperand, "Literal") && unwrappedOperand.value === null) ||
      (isNodeOfType(unwrappedOperand, "Identifier") &&
        unwrappedOperand.name === "undefined" &&
        context.scopes.isGlobalReference(unwrappedOperand))
    );
  };
  return (
    (resolveExpressionKey(unwrappedTest.left, context) === expressionKey &&
      isNullishOperand(unwrappedTest.right)) ||
    (resolveExpressionKey(unwrappedTest.right, context) === expressionKey &&
      isNullishOperand(unwrappedTest.left))
  );
};

const findLiveExpressionGuardForRelease = (
  releaseCall: EsTreeNode,
  owner: EsTreeNode,
  expressionKey: string,
  context: RuleContext,
): EsTreeNodeOfType<"IfStatement"> | null => {
  let ancestor = releaseCall.parent;
  while (ancestor && ancestor !== owner) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (
        ancestor.alternate !== null ||
        !doesTestRequireLiveExpressionKey(ancestor.test, expressionKey, context) ||
        !doMatchingNodesCoverEveryPathAfterUsage(ancestor.consequent, [releaseCall], context)
      ) {
        return null;
      }
      return ancestor;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

const findDirectHandleGuardForRelease = (
  releaseCall: EsTreeNode,
  owner: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): EsTreeNodeOfType<"IfStatement"> | null =>
  usage.handleKey === null
    ? null
    : findLiveExpressionGuardForRelease(releaseCall, owner, usage.handleKey, context);

const hasExecutionBoundaryNotSharedWithUsage = (
  node: EsTreeNode,
  usageNode: EsTreeNode,
  owner: EsTreeNode,
): boolean => {
  const usageAncestors = new Set<EsTreeNode>();
  let usageAncestor: EsTreeNode | null = usageNode;
  while (usageAncestor && usageAncestor !== owner) {
    usageAncestors.add(usageAncestor);
    usageAncestor = usageAncestor.parent ?? null;
  }
  let descendant = node;
  let ancestor = descendant.parent ?? null;
  while (ancestor && ancestor !== owner) {
    const guardedSubtree =
      (isNodeOfType(ancestor, "IfStatement") &&
        (ancestor.consequent === descendant || ancestor.alternate === descendant)) ||
      (isNodeOfType(ancestor, "ConditionalExpression") &&
        (ancestor.consequent === descendant || ancestor.alternate === descendant)) ||
      (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === descendant) ||
      (isNodeOfType(ancestor, "AssignmentPattern") && ancestor.right === descendant) ||
      ((isNodeOfType(ancestor, "ForStatement") ||
        isNodeOfType(ancestor, "ForInStatement") ||
        isNodeOfType(ancestor, "ForOfStatement") ||
        isNodeOfType(ancestor, "WhileStatement") ||
        isNodeOfType(ancestor, "DoWhileStatement")) &&
        ancestor.body === descendant)
        ? descendant
        : isNodeOfType(ancestor, "SwitchCase")
          ? ancestor
          : null;
    if (guardedSubtree && !usageAncestors.has(guardedSubtree)) return true;
    descendant = ancestor;
    ancestor = descendant.parent ?? null;
  }
  return false;
};

const hasRerunReleaseBeforeUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
  allowUnreleasedPathsWithoutUsage = false,
): boolean => {
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  const functionCfg = context.cfg.cfgFor(callback);
  const usageBlock = functionCfg?.blockOf(usage.node);
  const usageStart = getRangeStart(usage.node);
  if (!functionCfg || !usageBlock || usageStart === null) return false;
  const matchingReleaseAnchors: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const releaseStart = getRangeStart(child);
    const handleGuard = findDirectHandleGuardForRelease(child, callback, usage, context);
    const releaseBlock = functionCfg.blockOf(child);
    if (
      releaseStart === null ||
      releaseStart >= usageStart ||
      (releaseBlock !== usageBlock && !handleGuard && !allowUnreleasedPathsWithoutUsage) ||
      (!handleGuard && hasExecutionBoundaryNotSharedWithUsage(child, usage.node, callback))
    ) {
      return;
    }
    if (doesReleaseCallMatchUsage(child, usage, context)) {
      matchingReleaseAnchors.push(handleGuard ?? child);
      return;
    }
    const helperFunction = resolveRefOwnedCleanupFunction(child.callee, context);
    const helperParameterSubstitutions =
      helperFunction && isFunctionLike(helperFunction)
        ? resolveCleanupHelperParameterSubstitutions(helperFunction, child, context, new Map())
        : null;
    if (
      helperFunction &&
      isFunctionLike(helperFunction) &&
      helperParameterSubstitutions &&
      doesCleanupFunctionReleaseUsage(
        helperFunction,
        usage,
        context,
        new Set(),
        helperParameterSubstitutions,
      )
    ) {
      matchingReleaseAnchors.push(handleGuard ?? child);
    }
  });
  return allowUnreleasedPathsWithoutUsage
    ? doMatchingNodesCoverEveryPathBeforeUsage(
        usage.node,
        matchingReleaseAnchors,
        callback,
        context,
      )
    : doNodesCoverEveryPathFromFunctionEntry(callback, matchingReleaseAnchors, context);
};

const hasStableUnmountCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(callback);
  if (
    !componentFunction ||
    (!isNodeOfType(componentFunction, "ArrowFunctionExpression") &&
      !isNodeOfType(componentFunction, "FunctionExpression") &&
      !isNodeOfType(componentFunction, "FunctionDeclaration"))
  ) {
    return false;
  }
  let didFindUnmountCleanup = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (didFindUnmountCleanup) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction
    ) {
      return;
    }
    if (!isReactHookCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)) return;
    const cleanupCallback = getEffectCallback(child);
    if (
      cleanupCallback &&
      cleanupCallback !== callback &&
      callbackReturnsCleanupForUsage(cleanupCallback, usage, context)
    ) {
      didFindUnmountCleanup = true;
      return false;
    }
  });
  return didFindUnmountCleanup;
};

const hasSplitLifecycleCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  usage.handleKey !== null &&
  hasStableUnmountCleanupForUsage(callback, usage, context) &&
  hasRerunReleaseBeforeUsage(callback, usage, context, usage.registrationVerbName === "setTimeout");

const collectBlockingBooleanStates = (
  expression: EsTreeNode,
  blockedExpressionValue: boolean,
  guardNode: EsTreeNode,
  context: RuleContext,
): BooleanGuardState[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return collectBlockingBooleanStates(
      unwrappedExpression.argument,
      !blockedExpressionValue,
      guardNode,
      context,
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    const canEitherOperandBlock =
      (unwrappedExpression.operator === "||" && blockedExpressionValue) ||
      (unwrappedExpression.operator === "&&" && !blockedExpressionValue);
    if (!canEitherOperandBlock) return [];
    return [
      ...collectBlockingBooleanStates(
        unwrappedExpression.left,
        blockedExpressionValue,
        guardNode,
        context,
      ),
      ...collectBlockingBooleanStates(
        unwrappedExpression.right,
        blockedExpressionValue,
        guardNode,
        context,
      ),
    ];
  }
  if (
    isNodeOfType(unwrappedExpression, "BinaryExpression") &&
    ["===", "==", "!==", "!="].includes(unwrappedExpression.operator)
  ) {
    const leftValue = readStaticBoolean(unwrappedExpression.left);
    const rightValue = readStaticBoolean(unwrappedExpression.right);
    const booleanValue = leftValue ?? rightValue;
    const comparedExpression =
      leftValue === null ? unwrappedExpression.left : unwrappedExpression.right;
    const comparedKey = resolveExpressionKey(comparedExpression, context);
    if (booleanValue === null || comparedKey === null) return [];
    const isEquality =
      unwrappedExpression.operator === "===" || unwrappedExpression.operator === "==";
    return [
      {
        bindingIdentifier: isNodeOfType(comparedExpression, "Identifier")
          ? (context.scopes.symbolFor(comparedExpression)?.bindingIdentifier ?? null)
          : null,
        guardNode,
        key: comparedKey,
        value: isEquality === blockedExpressionValue ? booleanValue : !booleanValue,
      },
    ];
  }
  const expressionKey = resolveExpressionKey(unwrappedExpression, context);
  return expressionKey === null
    ? []
    : [
        {
          bindingIdentifier: isNodeOfType(unwrappedExpression, "Identifier")
            ? (context.scopes.symbolFor(unwrappedExpression)?.bindingIdentifier ?? null)
            : null,
          guardNode,
          key: expressionKey,
          value: blockedExpressionValue,
        },
      ];
};

const collectDeferredUsageGuardStates = (
  callback: EsTreeNode,
  usageNode: EsTreeNode,
  context: RuleContext,
): BooleanGuardState[] => {
  if (!isFunctionLike(callback) || callback.async) return [];
  const guardStates: BooleanGuardState[] = [];
  walkAst(callback.body, (child: EsTreeNode) => {
    if (child !== callback.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "IfStatement") &&
      !child.alternate &&
      !canNodeReachLaterNodeWithinFunction(child.consequent, usageNode, callback, context) &&
      doMatchingNodesCoverEveryPathBeforeUsage(usageNode, [child], callback, context)
    ) {
      guardStates.push(...collectBlockingBooleanStates(child.test, true, child, context));
    }
  });
  let descendant = usageNode;
  let ancestor = descendant.parent;
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.consequent === descendant) {
      guardStates.push(...collectBlockingBooleanStates(ancestor.test, false, ancestor, context));
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return guardStates;
};

const cleanupReturnInvalidatesGuard = (
  cleanupReturn: EsTreeNode,
  guardState: BooleanGuardState,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
  const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
  if (
    !cleanupFunction ||
    !isFunctionLike(cleanupFunction) ||
    cleanupFunction.async ||
    cleanupFunction.generator
  ) {
    return false;
  }
  let didInvalidateGuard = false;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (didInvalidateGuard) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      resolveExpressionKey(child.left, context) === guardState.key &&
      readStaticBoolean(child.right) === guardState.value &&
      context.cfg.isUnconditionalFromEntry(child)
    ) {
      didInvalidateGuard = true;
      return false;
    }
  });
  return didInvalidateGuard;
};

const deferredUsageWritesGuardBeforeUsage = (
  callback: EsTreeNode,
  usageNode: EsTreeNode,
  guardState: BooleanGuardState,
  context: RuleContext,
): boolean => {
  const usageStart = getRangeStart(usageNode);
  if (!isFunctionLike(callback) || usageStart === null) return true;
  let didWriteGuard = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (didWriteGuard) return false;
    if (child !== callback.body && isFunctionLike(child)) return false;
    const childStart = getRangeStart(child);
    if (childStart === null || childStart >= usageStart) return;
    const writtenExpression = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression")
        ? child.argument
        : null;
    if (writtenExpression && resolveExpressionKey(writtenExpression, context) === guardState.key) {
      didWriteGuard = true;
      return false;
    }
  });
  return didWriteGuard;
};

const canInterruptionReachUsageThroughCatch = (
  interruptionNode: EsTreeNode,
  usageNode: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let descendant = interruptionNode;
  let ancestor = descendant.parent;
  while (ancestor && ancestor !== owner) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === descendant &&
      ancestor.handler &&
      canNodeReachLaterNodeWithinFunction(ancestor.handler.body, usageNode, owner, context)
    ) {
      return true;
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

const isEffectLocalLifecycleGuard = (
  callback: EsTreeNode,
  guardState: BooleanGuardState,
  cleanupFunctions: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  if (!guardState.bindingIdentifier) return false;
  const guardSymbol = context.scopes.symbolFor(guardState.bindingIdentifier);
  if (
    !guardSymbol ||
    (guardSymbol.kind !== "let" && guardSymbol.kind !== "var") ||
    !isNodeOfType(guardSymbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(guardSymbol.declarationNode) !== callback
  ) {
    return false;
  }
  return guardSymbol.references.every((reference) => {
    if (!isWithinAssignmentTarget(reference.identifier)) return true;
    const assignmentTarget = findTransparentExpressionRoot(reference.identifier);
    const assignment = assignmentTarget.parent;
    return (
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === assignmentTarget &&
      readStaticBoolean(assignment.right) === guardState.value &&
      cleanupFunctions.includes(findEnclosingFunction(assignment) ?? assignment)
    );
  });
};

const hasPotentialInterruptionAfterGuard = (
  callback: EsTreeNode,
  guardState: BooleanGuardState,
  usageNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback)) return true;
  const guardStart = getRangeStart(guardState.guardNode);
  const usageStart = getRangeStart(usageNode);
  if (guardStart === null || usageStart === null) return true;
  let hasPotentialInterruption = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (hasPotentialInterruption) return false;
    if (child !== callback.body && isFunctionLike(child)) return false;
    const childStart = getRangeStart(child);
    if (childStart === null || childStart <= guardStart || childStart >= usageStart) return;
    const isPotentialInterruption =
      isNodeOfType(child, "AwaitExpression") ||
      isNodeOfType(child, "YieldExpression") ||
      (isNodeOfType(child, "CallExpression") &&
        !isProvenNonThrowingBuiltInCall(child, context.scopes));
    if (isPotentialInterruption) {
      if (
        canNodeReachLaterNodeWithinFunction(child, usageNode, callback, context) ||
        canInterruptionReachUsageThroughCatch(child, usageNode, callback, context)
      ) {
        hasPotentialInterruption = true;
        return false;
      }
    }
  });
  return hasPotentialInterruption;
};

const getNumericReactRefCurrentKey = (
  expression: EsTreeNode,
  context: RuleContext,
): string | null => {
  const refSymbol = resolveReactRefSymbol(stripParenExpression(expression), context.scopes);
  const initializer = refSymbol?.initializer ? stripParenExpression(refSymbol.initializer) : null;
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const initialValue = initializer.arguments?.[0]
    ? stripParenExpression(initializer.arguments[0])
    : null;
  if (!isNodeOfType(initialValue, "Literal") || typeof initialValue.value !== "number") {
    return null;
  }
  return resolveExpressionKey(expression, context);
};

const getBlockingGenerationKey = (expression: EsTreeNode, context: RuleContext): string | null => {
  const test = stripParenExpression(expression);
  if (isNodeOfType(test, "LogicalExpression") && test.operator === "||") {
    return (
      getBlockingGenerationKey(test.left, context) ?? getBlockingGenerationKey(test.right, context)
    );
  }
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    (test.operator !== "!==" && test.operator !== "!=")
  ) {
    return null;
  }
  const leftKey = getNumericReactRefCurrentKey(test.left, context);
  const rightKey = getNumericReactRefCurrentKey(test.right, context);
  const snapshotExpression = leftKey
    ? stripParenExpression(test.right)
    : stripParenExpression(test.left);
  const key = leftKey ?? rightKey;
  return key && isNodeOfType(snapshotExpression, "Identifier") ? key : null;
};

const findGenerationGuardKeyForDeferredUsage = (
  usageFunction: EsTreeNode,
  usageNode: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isFunctionLike(usageFunction)) return null;
  let generationKey: string | null = null;
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (generationKey) return false;
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "IfStatement") || child.alternate) {
      return;
    }
    const key = getBlockingGenerationKey(child.test, context);
    if (
      !key ||
      canNodeReachLaterNodeWithinFunction(child.consequent, usageNode, usageFunction, context) ||
      !doMatchingNodesCoverEveryPathBeforeUsage(usageNode, [child], usageFunction, context)
    ) {
      return;
    }
    generationKey = key;
  });
  return generationKey;
};

const isGenerationAdvance = (
  node: EsTreeNode,
  generationKey: string,
  context: RuleContext,
): boolean => {
  if (
    isNodeOfType(node, "UpdateExpression") &&
    resolveExpressionKey(node.argument, context) === generationKey
  ) {
    return true;
  }
  if (
    !isNodeOfType(node, "AssignmentExpression") ||
    resolveExpressionKey(node.left, context) !== generationKey ||
    (node.operator !== "+=" && node.operator !== "-=")
  ) {
    return false;
  }
  const amount = stripParenExpression(node.right);
  return isNodeOfType(amount, "Literal") && typeof amount.value === "number" && amount.value !== 0;
};

const functionAdvancesGeneration = (
  owner: EsTreeNode,
  generationKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(owner)) return false;
  let didAdvanceGeneration = false;
  walkAst(owner.body, (child: EsTreeNode) => {
    if (didAdvanceGeneration) return false;
    if (child !== owner.body && isFunctionLike(child)) return false;
    if (isGenerationAdvance(child, generationKey, context)) {
      didAdvanceGeneration = true;
      return false;
    }
  });
  return didAdvanceGeneration;
};

const cleanupReturnsReleaseUsage = (
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  cleanupReturns.length > 0 &&
  cleanupReturns.every((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return false;
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return Boolean(
      cleanupFunction &&
      isFunctionLike(cleanupFunction) &&
      doesCleanupFunctionReleaseUsage(cleanupFunction, usage, context),
    );
  });

const hasLiveHandleOverwriteProtection = (
  usageFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const handleKey = usage.handleKey;
  if (!isFunctionLike(usageFunction) || handleKey === null) return false;
  const usageStart = getRangeStart(usage.node);
  if (usageStart === null) return false;
  let didFindEarlyReturnGuard = false;
  const releaseBeforeReplacementAnchors: EsTreeNode[] = [];
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (didFindEarlyReturnGuard) return false;
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "IfStatement") &&
      !child.alternate &&
      doesTestRequireLiveExpressionKey(child.test, handleKey, context) &&
      !canNodeReachLaterNodeWithinFunction(child.consequent, usage.node, usageFunction, context) &&
      doMatchingNodesCoverEveryPathBeforeUsage(usage.node, [child], usageFunction, context)
    ) {
      didFindEarlyReturnGuard = true;
      return false;
    }
    const childStart = getRangeStart(child);
    if (
      childStart === null ||
      childStart >= usageStart ||
      !doesNodeOrCalledHelperReleaseUsage(child, usage, context)
    ) {
      return;
    }
    const handleGuard = findDirectHandleGuardForRelease(child, usageFunction, usage, context);
    releaseBeforeReplacementAnchors.push(handleGuard ?? child);
  });
  return (
    didFindEarlyReturnGuard ||
    doMatchingNodesCoverEveryPathBeforeUsage(
      usage.node,
      releaseBeforeReplacementAnchors,
      usageFunction,
      context,
    )
  );
};

const getUsageCallbackKey = (usage: SubscribeLikeUsage, context: RuleContext): string | null => {
  if (usage.kind === "subscribe") {
    return (
      usage.handlerKey ?? resolveExpressionKey(getSubscribeUsageCallbackArgument(usage), context)
    );
  }
  if (usage.kind !== "timer" || !isNodeOfType(usage.node, "CallExpression")) return null;
  return resolveExpressionKey(usage.node.arguments?.[0], context);
};

const getFunctionIdentityKeys = (
  functionNode: EsTreeNode,
  context: RuleContext,
): ReadonlySet<string> => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  return new Set(
    [
      resolveExpressionKey(functionNode, context),
      resolveExpressionKey(bindingIdentifier, context),
    ].filter((identityKey): identityKey is string => identityKey !== null),
  );
};

const doesCleanupOwnUsageAfterRegistration = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean =>
  cleanupReturnsExhaustivelyReleaseUsage(cleanupReturns, usage, context) &&
  doMatchingNodesCoverEveryPathAfterUsage(
    resolveCleanupPathAnchor(usage.node, callback, context),
    cleanupReturns,
    context,
  );

const doesNodeOrCalledHelperReleaseUsage = (
  node: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (doesReleaseCallMatchUsage(node, usage, context)) return true;
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const helperFunction = resolveStableValue(callNode.callee, context);
  return Boolean(
    helperFunction &&
    isFunctionLike(helperFunction) &&
    !helperFunction.async &&
    !helperFunction.generator &&
    doesCleanupFunctionReleaseUsage(helperFunction, usage, context, new Set(), new Map(), true),
  );
};

const resolveNestedTimerStorageSymbol = (
  assignmentTarget: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const unwrappedTarget = stripParenExpression(assignmentTarget);
  if (isNodeOfType(unwrappedTarget, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedTarget);
    return symbol &&
      (symbol.kind === "let" || symbol.kind === "var") &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      findEnclosingFunction(symbol.declarationNode) === callback
      ? symbol
      : null;
  }
  const refSymbol = resolveReactRefSymbol(unwrappedTarget, context.scopes, {
    resolveNamedAliases: true,
  });
  if (refSymbol) return refSymbol;
  let storageObject: EsTreeNode = unwrappedTarget;
  while (isNodeOfType(storageObject, "MemberExpression")) {
    storageObject = stripParenExpression(storageObject.object);
  }
  if (!isNodeOfType(storageObject, "Identifier")) return null;
  const storageSymbol = context.scopes.symbolFor(storageObject);
  const initializer = storageSymbol?.initializer
    ? stripParenExpression(storageSymbol.initializer)
    : null;
  return storageSymbol &&
    storageSymbol.kind === "const" &&
    isNodeOfType(storageSymbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(initializer, "ObjectExpression") &&
    findEnclosingFunction(storageSymbol.declarationNode) === callback
    ? storageSymbol
    : null;
};

const getOutermostMemberReference = (identifier: EsTreeNode): EsTreeNode => {
  let expression: EsTreeNode = identifier;
  while (
    isNodeOfType(expression.parent, "MemberExpression") &&
    expression.parent.object === expression
  ) {
    expression = expression.parent;
  }
  return findTransparentExpressionRoot(expression);
};

const hasOnlySafeHandleStorageAssignments = (
  usage: SubscribeLikeUsage,
  handleStorageSymbol: SymbolDescriptor,
  usageAssignment: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): boolean =>
  handleStorageSymbol.references.every((reference) => {
    const assignmentTarget = getOutermostMemberReference(reference.identifier);
    if (resolveExpressionKey(assignmentTarget, context) !== usage.handleKey) {
      return isNodeOfType(usageAssignment.left, "Identifier");
    }
    if (!isWithinAssignmentTarget(reference.identifier)) return true;
    const assignment = assignmentTarget.parent;
    if (assignment === usageAssignment) return true;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== assignmentTarget
    ) {
      return false;
    }
    const assignedValue = stripParenExpression(assignment.right);
    const isNullishReset =
      (isNodeOfType(assignedValue, "Literal") && assignedValue.value === null) ||
      (isNodeOfType(assignedValue, "Identifier") &&
        assignedValue.name === "undefined" &&
        context.scopes.isGlobalReference(assignedValue));
    const assignmentOwner = findEnclosingFunction(assignment);
    if (!isNullishReset || !assignmentOwner || !isFunctionLike(assignmentOwner)) return false;
    const matchingReleaseCalls: EsTreeNode[] = [];
    walkAst(assignmentOwner.body, (child: EsTreeNode) => {
      if (child !== assignmentOwner.body && isFunctionLike(child)) return false;
      if (doesNodeOrCalledHelperReleaseUsage(child, usage, context)) {
        matchingReleaseCalls.push(child);
      }
    });
    return doMatchingNodesCoverEveryPathBeforeUsage(
      assignment,
      matchingReleaseCalls,
      assignmentOwner,
      context,
    );
  });

const isEffectOwnedDirectTimerCollection = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const collectionSymbol = resolveDirectResourcePushCollectionSymbol(usage.node, context);
  return Boolean(
    collectionSymbol && findEnclosingFunction(collectionSymbol.declarationNode) === callback,
  );
};

const isSelfReschedulingOneShotTimer = (
  usage: SubscribeLikeUsage,
  usageFunction: EsTreeNode,
  allUsages: ReadonlyArray<SubscribeLikeUsage>,
  context: RuleContext,
): boolean => {
  if (usage.registrationVerbName !== "setTimeout") return false;
  const functionIdentityKeys = getFunctionIdentityKeys(usageFunction, context);
  if (!functionIdentityKeys.has(getUsageCallbackKey(usage, context) ?? "")) return false;
  const selfSchedulingUsages = allUsages.filter(
    (candidateUsage) =>
      candidateUsage.kind === "timer" &&
      findEnclosingFunction(candidateUsage.node) === usageFunction &&
      functionIdentityKeys.has(getUsageCallbackKey(candidateUsage, context) ?? ""),
  );
  return selfSchedulingUsages.length === 1 && selfSchedulingUsages[0] === usage;
};

const hasEffectOwnedNestedTimerCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  allUsages: ReadonlyArray<SubscribeLikeUsage>,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const usageFunction = findEnclosingFunction(usage.node);
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  const isAssignedHandle =
    usage.handleKey !== null &&
    isNodeOfType(usageAssignment, "AssignmentExpression") &&
    usageAssignment.operator === "=" &&
    usageAssignment.right === usageExpression;
  const handleStorageSymbol = isAssignedHandle
    ? resolveNestedTimerStorageSymbol(usageAssignment.left, callback, context)
    : null;
  const isOwnedCollection = isEffectOwnedDirectTimerCollection(callback, usage, context);
  if (
    usage.kind !== "timer" ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction === callback ||
    usageFunction.async ||
    usageFunction.generator ||
    (!handleStorageSymbol && !isOwnedCollection) ||
    !cleanupReturnsExhaustivelyReleaseUsage(cleanupReturns, usage, context)
  ) {
    return false;
  }
  if (
    handleStorageSymbol &&
    isNodeOfType(usageAssignment, "AssignmentExpression") &&
    !hasOnlySafeHandleStorageAssignments(usage, handleStorageSymbol, usageAssignment, context)
  ) {
    return false;
  }
  const isSelfRescheduling = isSelfReschedulingOneShotTimer(
    usage,
    usageFunction,
    allUsages,
    context,
  );
  if (
    handleStorageSymbol &&
    !isSelfRescheduling &&
    !hasLiveHandleOverwriteProtection(usageFunction, usage, context)
  ) {
    return false;
  }
  let usageAncestor: EsTreeNode | null | undefined = usage.node.parent;
  while (usageAncestor && usageAncestor !== usageFunction) {
    if (
      handleStorageSymbol &&
      (isNodeOfType(usageAncestor, "ForStatement") ||
        isNodeOfType(usageAncestor, "ForInStatement") ||
        isNodeOfType(usageAncestor, "ForOfStatement") ||
        isNodeOfType(usageAncestor, "WhileStatement") ||
        isNodeOfType(usageAncestor, "DoWhileStatement"))
    ) {
      return false;
    }
    usageAncestor = usageAncestor.parent;
  }
  const functionBindingIdentifier = getFunctionBindingIdentifier(usageFunction);
  const functionSymbol = functionBindingIdentifier
    ? context.scopes.symbolFor(functionBindingIdentifier)
    : null;
  if (!functionSymbol || functionSymbol.references.length === 0) return false;
  const selfSchedulingReferences = functionSymbol.references.filter(
    (reference) =>
      isSelfRescheduling &&
      isAstDescendant(reference.identifier, usage.node) &&
      getUsageCallbackKey(usage, context) === resolveExpressionKey(reference.identifier, context),
  );
  if (
    isSelfRescheduling &&
    (selfSchedulingReferences.length !== 1 || functionSymbol.references.length !== 2)
  ) {
    return false;
  }
  const synchronouslyInvokedFunctions = collectSynchronouslyEffectInvokedFunctions(
    callback,
    context.scopes,
  );
  return functionSymbol.references.every((reference) => {
    const referenceKey = resolveExpressionKey(reference.identifier, context);
    if (selfSchedulingReferences.some((candidate) => candidate === reference)) return true;
    const callbackOwnerUsage = allUsages.find(
      (candidateUsage) =>
        candidateUsage !== usage &&
        referenceKey !== null &&
        getUsageCallbackKey(candidateUsage, context) === referenceKey,
    );
    const callbackOwnerArgument = callbackOwnerUsage
      ? getSubscribeUsageCallbackArgument(callbackOwnerUsage)
      : null;
    if (
      callbackOwnerUsage &&
      !(
        callbackOwnerArgument &&
        isFunctionLike(callbackOwnerArgument) &&
        callbackOwnerArgument.async
      ) &&
      doesCleanupOwnUsageAfterRegistration(callback, callbackOwnerUsage, cleanupReturns, context)
    ) {
      return true;
    }
    const invocationCall = findDirectCallForReference(reference.identifier);
    if (!invocationCall) return false;
    const invocationOwner = findEnclosingFunction(invocationCall);
    if (!invocationOwner || !isFunctionLike(invocationOwner) || invocationOwner === usageFunction) {
      return false;
    }
    if (invocationOwner.async || invocationOwner.generator) return false;
    if (invocationOwner === callback) {
      return doMatchingNodesCoverEveryPathAfterUsage(
        resolveCleanupPathAnchor(invocationCall, callback, context),
        cleanupReturns,
        context,
      );
    }
    const invocationOwnerKeys = getFunctionIdentityKeys(invocationOwner, context);
    const ownerUsage = allUsages.find((candidateUsage) => {
      if (candidateUsage === usage) return false;
      const callbackArgument = getSubscribeUsageCallbackArgument(candidateUsage);
      const resolvedCallback = callbackArgument
        ? resolveStableValue(callbackArgument, context)
        : null;
      return (
        invocationOwnerKeys.has(getUsageCallbackKey(candidateUsage, context) ?? "") ||
        resolvedCallback === invocationOwner
      );
    });
    if (ownerUsage) {
      return doesCleanupOwnUsageAfterRegistration(callback, ownerUsage, cleanupReturns, context);
    }
    return (
      synchronouslyInvokedFunctions.has(invocationOwner) &&
      doMatchingNodesCoverEveryPathAfterUsage(
        resolveCleanupPathAnchor(invocationCall, callback, context),
        cleanupReturns,
        context,
      )
    );
  });
};

const getOwnedFunctionReference = (
  reference: EsTreeNode,
  usageFunction: EsTreeNode,
  usageNode: EsTreeNode,
  callback: EsTreeNode,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): OwnedFunctionReference | null => {
  const directCall = findDirectCallForReference(reference);
  if (directCall) {
    const referenceOwner = findEnclosingFunction(directCall);
    if (
      referenceOwner &&
      referenceOwner !== usageFunction &&
      collectSynchronouslyEffectInvokedFunctions(callback).has(referenceOwner)
    ) {
      return { generationKey: null };
    }
    const generationKey = referenceOwner
      ? findGenerationGuardKeyForDeferredUsage(referenceOwner, directCall, context)
      : null;
    return generationKey ? { generationKey } : null;
  }
  const referenceRoot = findTransparentExpressionRoot(reference);
  const schedulerCall = referenceRoot.parent;
  if (
    !isNodeOfType(schedulerCall, "CallExpression") ||
    !schedulerCall.arguments.some((argument) => argument === referenceRoot) ||
    !isNodeOfType(schedulerCall.callee, "Identifier") ||
    schedulerCall.callee.name !== "setTimeout" ||
    !context.scopes.isGlobalReference(schedulerCall.callee)
  ) {
    return null;
  }
  const schedulerUsage: SubscribeLikeUsage = {
    kind: "timer",
    node: schedulerCall,
    resourceName: schedulerCall.callee.name,
    handleKey: findAssignedResourceKey(schedulerCall, context),
    receiverKey: null,
    registrationVerbName: schedulerCall.callee.name,
    eventKey: null,
    handlerKey: null,
  };
  const generationKey = findGenerationGuardKeyForDeferredUsage(usageFunction, usageNode, context);
  return schedulerUsage.handleKey !== null &&
    cleanupReturnsReleaseUsage(cleanupReturns, schedulerUsage, context) &&
    generationKey
    ? { generationKey }
    : null;
};

const hasGuardedRefOwnedNestedCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const usageFunction = findEnclosingFunction(usage.node);
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  if (
    (usage.kind !== "subscribe" && usage.kind !== "timer") ||
    usage.handleKey === null ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction === callback ||
    usageFunction.async ||
    usageFunction.generator ||
    !isNodeOfType(usageAssignment, "AssignmentExpression") ||
    usageAssignment.operator !== "=" ||
    usageAssignment.right !== usageExpression ||
    !resolveReactRefSymbol(stripParenExpression(usageAssignment.left), context.scopes) ||
    !collectSynchronouslyEffectInvokedFunctions(callback).has(usageFunction) ||
    !cleanupReturnsReleaseUsage(cleanupReturns, usage, context) ||
    !doNodesCoverEveryPathFromFunctionEntry(callback, cleanupReturns, context)
  ) {
    return false;
  }
  const cleanupFunctions = cleanupReturns.flatMap((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return [];
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return cleanupFunction && isFunctionLike(cleanupFunction) ? [cleanupFunction] : [];
  });
  const bindingIdentifier = getFunctionBindingIdentifier(usageFunction);
  const functionSymbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  if (!functionSymbol || functionSymbol.references.length === 0) return false;
  const ownedReferences = functionSymbol.references.map((reference) =>
    getOwnedFunctionReference(
      reference.identifier,
      usageFunction,
      usage.node,
      callback,
      cleanupReturns,
      context,
    ),
  );
  if (ownedReferences.some((reference) => reference === null)) return false;
  const generationKeys = new Set(
    ownedReferences.flatMap((reference) =>
      reference?.generationKey ? [reference.generationKey] : [],
    ),
  );
  if (generationKeys.size !== 1) return false;
  const generationKey = generationKeys.values().next().value;
  if (typeof generationKey !== "string") return false;
  const invokedFunctions = collectSynchronouslyEffectInvokedFunctions(callback);
  return [...invokedFunctions, ...cleanupFunctions].some((owner) =>
    functionAdvancesGeneration(owner, generationKey, context),
  );
};

const hasGuardedDeferredCleanup = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  cleanupReturns: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  if (hasGuardedRefOwnedNestedCleanup(callback, usage, cleanupReturns, context)) {
    return true;
  }
  const usageFunction = findEnclosingFunction(usage.node);
  const promiseChainCall = usageFunction ? getPromiseChainCallForCallback(usageFunction) : null;
  if (
    usage.kind !== "timer" ||
    usage.handleKey === null ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction === callback ||
    usageFunction.async ||
    usageFunction.generator ||
    !isNodeOfType(usage.node, "CallExpression") ||
    !isNodeOfType(usage.node.callee, "Identifier") ||
    !context.scopes.isGlobalReference(usage.node.callee) ||
    !promiseChainCall ||
    !collectEffectInvokedFunctions(callback, context.scopes).has(usageFunction) ||
    !doMatchingNodesCoverEveryPathAfterUsage(promiseChainCall, cleanupReturns, context)
  ) {
    return false;
  }
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  if (
    !isNodeOfType(usageAssignment, "AssignmentExpression") ||
    usageAssignment.operator !== "=" ||
    usageAssignment.right !== usageExpression ||
    !isNodeOfType(usageAssignment.left, "Identifier")
  ) {
    return false;
  }
  const handleSymbol = context.scopes.symbolFor(usageAssignment.left);
  if (
    !handleSymbol ||
    (handleSymbol.kind !== "let" && handleSymbol.kind !== "var") ||
    !isNodeOfType(handleSymbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(handleSymbol.declarationNode) !== callback
  ) {
    return false;
  }
  const cleanupFunctions = cleanupReturns.flatMap((cleanupReturn) => {
    if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return [];
    const cleanupFunction = resolveStableValue(cleanupReturn.argument, context);
    return cleanupFunction && isFunctionLike(cleanupFunction) ? [cleanupFunction] : [];
  });
  if (cleanupFunctions.length !== cleanupReturns.length) return false;
  const globalReleaseProofsByCleanup = new Map<EsTreeNode, GlobalReleaseProof[]>();
  for (const cleanupFunction of cleanupFunctions) {
    if (!isFunctionLike(cleanupFunction)) return false;
    const globalReleaseProofs: GlobalReleaseProof[] = [];
    walkAst(cleanupFunction.body, (child: EsTreeNode) => {
      if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        isNodeOfType(child.callee, "Identifier") &&
        context.scopes.isGlobalReference(child.callee) &&
        doesReleaseCallMatchUsage(child, usage, context)
      ) {
        const handleGuard = findDirectHandleGuardForRelease(child, cleanupFunction, usage, context);
        globalReleaseProofs.push({
          anchor: handleGuard ?? child,
          call: child,
          handleGuard,
        });
      }
    });
    if (
      !doNodesCoverEveryPathFromFunctionEntry(
        cleanupFunction,
        globalReleaseProofs.map((releaseProof) => releaseProof.anchor),
        context,
      )
    ) {
      return false;
    }
    globalReleaseProofsByCleanup.set(cleanupFunction, globalReleaseProofs);
  }
  const handleAssignments = handleSymbol.references.filter((reference) =>
    isWithinAssignmentTarget(reference.identifier),
  );
  const hasUsageAssignment = handleAssignments.some(
    (handleAssignment) =>
      findTransparentExpressionRoot(handleAssignment.identifier).parent === usageAssignment,
  );
  const hasUnsafeHandleAssignment = handleAssignments.some((handleAssignment) => {
    const assignmentTarget = findTransparentExpressionRoot(handleAssignment.identifier);
    const assignment = assignmentTarget.parent;
    if (assignment === usageAssignment) return false;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== assignmentTarget
    ) {
      return true;
    }
    const assignedValue = stripParenExpression(assignment.right);
    const isNullishReset =
      (isNodeOfType(assignedValue, "Literal") && assignedValue.value === null) ||
      (isNodeOfType(assignedValue, "Identifier") &&
        assignedValue.name === "undefined" &&
        context.scopes.isGlobalReference(assignedValue));
    if (!isNullishReset) return true;
    const cleanupFunction = findEnclosingFunction(assignment);
    const globalReleaseProofs = cleanupFunction
      ? globalReleaseProofsByCleanup.get(cleanupFunction)
      : undefined;
    return !(
      cleanupFunction &&
      globalReleaseProofs &&
      doMatchingNodesCoverEveryPathBeforeUsage(
        assignment,
        globalReleaseProofs.map((releaseProof) =>
          releaseProof.handleGuard &&
          isAstDescendant(assignment, releaseProof.handleGuard.consequent)
            ? releaseProof.call
            : releaseProof.anchor,
        ),
        cleanupFunction,
        context,
      )
    );
  });
  if (!hasUsageAssignment || hasUnsafeHandleAssignment) {
    return false;
  }
  let usageAncestor: EsTreeNode | null | undefined = usage.node.parent;
  while (usageAncestor && usageAncestor !== usageFunction) {
    if (
      isNodeOfType(usageAncestor, "ForStatement") ||
      isNodeOfType(usageAncestor, "ForInStatement") ||
      isNodeOfType(usageAncestor, "ForOfStatement") ||
      isNodeOfType(usageAncestor, "WhileStatement") ||
      isNodeOfType(usageAncestor, "DoWhileStatement")
    ) {
      return false;
    }
    usageAncestor = usageAncestor.parent;
  }
  let hasPotentialInterruption = false;
  for (const argument of usage.node.arguments ?? []) {
    walkAst(argument, (argumentChild: EsTreeNode) => {
      if (hasPotentialInterruption) return false;
      if (isFunctionLike(argumentChild)) return false;
      const isPotentialInterruption =
        isNodeOfType(argumentChild, "AwaitExpression") ||
        isNodeOfType(argumentChild, "YieldExpression") ||
        (isNodeOfType(argumentChild, "CallExpression") &&
          !isProvenNonThrowingBuiltInCall(argumentChild, context.scopes));
      if (isPotentialInterruption) {
        hasPotentialInterruption = true;
        return false;
      }
    });
  }
  if (hasPotentialInterruption) return false;
  return collectDeferredUsageGuardStates(usageFunction, usage.node, context).some(
    (guardState) =>
      isEffectLocalLifecycleGuard(callback, guardState, cleanupFunctions, context) &&
      !hasPotentialInterruptionAfterGuard(usageFunction, guardState, usage.node, context) &&
      !deferredUsageWritesGuardBeforeUsage(usageFunction, usage.node, guardState, context) &&
      cleanupReturns.every((cleanupReturn) =>
        cleanupReturnInvalidatesGuard(cleanupReturn, guardState, context),
      ),
  );
};

const cleanupRegistryReleasesUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback) || !isNodeOfType(callback.body, "BlockStatement")) return false;
  const cleanupRegistrySymbols = new Set<SymbolDescriptor>();
  walkAst(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      getCalleeName(child) !== "push" ||
      !isNodeOfType(callee.object, "Identifier")
    ) {
      return;
    }
    const cleanupValue = child.arguments[0];
    if (!cleanupValue || !isAstNode(cleanupValue)) return;
    const unwrappedCleanupValue = stripParenExpression(cleanupValue);
    const cleanupFunction = isFunctionLike(unwrappedCleanupValue)
      ? unwrappedCleanupValue
      : resolveStableValue(cleanupValue, context);
    if (!cleanupFunction || !isFunctionLike(cleanupFunction)) {
      return;
    }
    let doesReleaseUsage = false;
    walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
      if (
        doesReleaseUsage ||
        (cleanupChild !== cleanupFunction.body && isFunctionLike(cleanupChild))
      ) {
        return doesReleaseUsage ? false : undefined;
      }
      if (!isNodeOfType(cleanupChild, "CallExpression")) return;
      const releaseCallee = stripParenExpression(cleanupChild.callee);
      if (!isNodeOfType(releaseCallee, "MemberExpression")) return;
      const registrationCall = isNodeOfType(usage.node, "CallExpression") ? usage.node : null;
      if (
        getCalleeName(cleanupChild) === "removeEventListener" &&
        registrationCall &&
        resolveResourceIdentityKey(releaseCallee.object, context) === usage.receiverKey &&
        resolveResourceIdentityKey(cleanupChild.arguments[0], context) === usage.eventKey &&
        resolveResourceIdentityKey(cleanupChild.arguments[1], context) === usage.handlerKey &&
        doEventListenerCapturesMatch(
          registrationCall.arguments[2],
          cleanupChild.arguments[2],
          context,
          true,
        )
      ) {
        doesReleaseUsage = true;
        return false;
      }
    });
    if (!doesReleaseUsage) return;
    const registrationExpression = findTransparentExpressionRoot(usage.node);
    const registrationStatement = registrationExpression.parent;
    const appendExpression = findTransparentExpressionRoot(child);
    const appendStatement = appendExpression.parent;
    if (
      !registrationStatement ||
      !isNodeOfType(registrationStatement, "ExpressionStatement") ||
      registrationStatement.expression !== registrationExpression ||
      !appendStatement ||
      !isNodeOfType(appendStatement, "ExpressionStatement") ||
      appendStatement.expression !== appendExpression ||
      !registrationStatement.parent ||
      !isNodeOfType(registrationStatement.parent, "BlockStatement") ||
      registrationStatement.parent !== appendStatement.parent
    ) {
      return;
    }
    const registrationStatementIndex = registrationStatement.parent.body.findIndex(
      (statement) => statement.range[0] === registrationStatement.range[0],
    );
    const appendStatementIndex = registrationStatement.parent.body.findIndex(
      (statement) => statement.range[0] === appendStatement.range[0],
    );
    if (appendStatementIndex !== registrationStatementIndex + 1) return;
    const registrySymbol = context.scopes.symbolFor(callee.object);
    const registryInitializer = registrySymbol?.initializer
      ? stripParenExpression(registrySymbol.initializer)
      : null;
    if (
      registrySymbol?.kind !== "const" ||
      !registryInitializer ||
      !isNodeOfType(registryInitializer, "ArrayExpression") ||
      registryInitializer.elements.length !== 0
    ) {
      return;
    }
    const hasOnlyAppendAndReplayReferences = registrySymbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const member = referenceRoot.parent;
      if (!member || !isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
        return false;
      }
      const call = findTransparentExpressionRoot(member).parent;
      return Boolean(
        call &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === member &&
        ["forEach", "push"].includes(getStaticPropertyKeyName(member) ?? ""),
      );
    });
    if (hasOnlyAppendAndReplayReferences) cleanupRegistrySymbols.add(registrySymbol);
  });
  if (cleanupRegistrySymbols.size === 0) return false;
  let hasExhaustiveReplay = false;
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (hasExhaustiveReplay || !isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returnedCleanupValue = stripParenExpression(child.argument);
    const cleanupFunction = isFunctionLike(returnedCleanupValue)
      ? returnedCleanupValue
      : resolveStableValue(child.argument, context);
    if (!cleanupFunction || !isFunctionLike(cleanupFunction)) return;
    walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
      if (hasExhaustiveReplay || !isNodeOfType(cleanupChild, "CallExpression")) return false;
      const callee = stripParenExpression(cleanupChild.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        getCalleeName(cleanupChild) !== "forEach" ||
        !isNodeOfType(callee.object, "Identifier")
      ) {
        return;
      }
      const replayRegistrySymbol = context.scopes.symbolFor(callee.object);
      if (!replayRegistrySymbol || !cleanupRegistrySymbols.has(replayRegistrySymbol)) return;
      const replayValue = cleanupChild.arguments[0];
      if (!replayValue || !isAstNode(replayValue)) return;
      const replayFunction = stripParenExpression(replayValue);
      if (!isFunctionLike(replayFunction)) return;
      const replayParameter = replayFunction.params[0];
      if (!replayParameter || !isNodeOfType(replayParameter, "Identifier")) return;
      const replaySymbol = context.scopes.symbolFor(replayParameter);
      walkAst(replayFunction.body, (replayChild: EsTreeNode) => {
        if (
          isNodeOfType(replayChild, "CallExpression") &&
          isNodeOfType(stripParenExpression(replayChild.callee), "Identifier") &&
          context.scopes.symbolFor(stripParenExpression(replayChild.callee))?.id ===
            replaySymbol?.id
        ) {
          hasExhaustiveReplay = true;
          return false;
        }
      });
      return hasExhaustiveReplay ? false : undefined;
    });
  });
  return hasExhaustiveReplay;
};

const symmetricForEachListenerCleanupReleasesUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    usage.registrationVerbName !== "addEventListener" ||
    !isNodeOfType(usage.node, "CallExpression")
  ) {
    return false;
  }
  const registrationCallee = stripParenExpression(usage.node.callee);
  if (!isNodeOfType(registrationCallee, "MemberExpression")) return false;
  const projectionExpressions = [
    registrationCallee.object,
    usage.node.arguments[0],
    usage.node.arguments[1],
    usage.node.arguments[2],
  ];
  const requiredCollectionKeys = new Set(
    projectionExpressions.flatMap((expression) => {
      const projection = resolveForEachProjection(expression, context);
      return projection ? [projection.collectionKey] : [];
    }),
  );
  if (requiredCollectionKeys.size === 0) return false;
  const registrationReceiverKey = resolveResourceIdentityKey(registrationCallee.object, context);
  const registrationEventKey = resolveResourceIdentityKey(usage.node.arguments[0], context);
  const registrationHandlerKey = resolveResourceIdentityKey(usage.node.arguments[1], context);
  const registrationCaptureKey = resolveEventListenerCaptureIdentityKey(
    usage.node.arguments[2],
    context,
    true,
  );
  let hasMatchingCleanup = false;
  walkAst(callback, (child: EsTreeNode) => {
    if (hasMatchingCleanup || !isNodeOfType(child, "CallExpression")) {
      return hasMatchingCleanup ? false : undefined;
    }
    if (getCalleeName(child) !== "removeEventListener") return;
    const releaseCallee = stripParenExpression(child.callee);
    if (!isNodeOfType(releaseCallee, "MemberExpression")) return;
    if (
      resolveResourceIdentityKey(releaseCallee.object, context) !== registrationReceiverKey ||
      resolveResourceIdentityKey(child.arguments[0], context) !== registrationEventKey ||
      resolveResourceIdentityKey(child.arguments[1], context) !== registrationHandlerKey ||
      resolveEventListenerCaptureIdentityKey(child.arguments[2], context, true) !==
        registrationCaptureKey
    ) {
      return;
    }
    const cleanupFunction = findDirectExhaustiveForEachCleanupFunction(
      child,
      requiredCollectionKeys,
      context,
    );
    if (!cleanupFunction) return;
    if (
      hasCollectionMutationBeforeRelease(
        usage.node,
        child,
        new Map(
          [...requiredCollectionKeys].map((collectionKey) => [
            collectionKey,
            Number.POSITIVE_INFINITY,
          ]),
        ),
        context,
      )
    ) {
      return;
    }
    hasMatchingCleanup = true;
    return false;
  });
  return hasMatchingCleanup;
};

const oneShotTimerHasUnmountGuard = (usage: SubscribeLikeUsage, context: RuleContext): boolean => {
  if (usage.registrationVerbName !== "setTimeout" || !isNodeOfType(usage.node, "CallExpression")) {
    return false;
  }
  const timerCallbackArgument = usage.node.arguments[0];
  if (!timerCallbackArgument || !isAstNode(timerCallbackArgument)) return false;
  const unwrappedTimerCallback = stripParenExpression(timerCallbackArgument);
  const timerCallback = isFunctionLike(unwrappedTimerCallback)
    ? unwrappedTimerCallback
    : resolveStableValue(timerCallbackArgument, context);
  if (
    !timerCallback ||
    !isFunctionLike(timerCallback) ||
    !isNodeOfType(timerCallback.body, "BlockStatement")
  ) {
    return false;
  }
  const leadingStatement = timerCallback.body.body[0];
  if (!leadingStatement || !isNodeOfType(leadingStatement, "IfStatement")) return false;
  if (!isEarlyExitStatement(leadingStatement.consequent)) return false;
  const test = stripParenExpression(leadingStatement.test);
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return false;
  const guardRefSymbol = resolveReactRefSymbol(
    stripParenExpression(test.argument),
    context.scopes,
    {
      resolveNamedAliases: true,
    },
  );
  if (!guardRefSymbol) return false;
  let effectFunction: EsTreeNode | null = findEnclosingFunction(usage.node);
  let owningEffectCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  while (effectFunction) {
    const effectCall = effectFunction.parent;
    if (
      effectCall &&
      isNodeOfType(effectCall, "CallExpression") &&
      isReactHookCall(effectCall, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)
    ) {
      owningEffectCall = effectCall;
      break;
    }
    effectFunction = findEnclosingFunction(effectFunction);
  }
  const componentFunction = owningEffectCall
    ? findRenderPhaseComponentOrHook(owningEffectCall, context.scopes)
    : null;
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  let hasUnmountInvalidation = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (hasUnmountInvalidation) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isReactHookCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (!effectCallback || !isFunctionLike(effectCallback)) return;
    const directCleanupValue = stripParenExpression(effectCallback.body);
    if (isFunctionLike(directCleanupValue)) {
      walkAst(directCleanupValue.body, (cleanupChild: EsTreeNode) => {
        if (
          isNodeOfType(cleanupChild, "AssignmentExpression") &&
          cleanupChild.operator === "=" &&
          resolveReactRefSymbol(stripParenExpression(cleanupChild.left), context.scopes, {
            resolveNamedAliases: true,
          })?.id === guardRefSymbol?.id &&
          readStaticBoolean(stripParenExpression(cleanupChild.right)) === false &&
          context.cfg.isUnconditionalFromEntry(cleanupChild)
        ) {
          hasUnmountInvalidation = true;
          return false;
        }
      });
    }
    walkInsideStatementBlocks(effectCallback.body, (effectChild: EsTreeNode) => {
      if (
        hasUnmountInvalidation ||
        !isNodeOfType(effectChild, "ReturnStatement") ||
        !effectChild.argument
      )
        return;
      const cleanupFunction = resolveStableValue(effectChild.argument, context);
      if (!cleanupFunction || !isFunctionLike(cleanupFunction)) return;
      walkAst(cleanupFunction.body, (cleanupChild: EsTreeNode) => {
        if (
          isNodeOfType(cleanupChild, "AssignmentExpression") &&
          cleanupChild.operator === "=" &&
          resolveReactRefSymbol(stripParenExpression(cleanupChild.left), context.scopes, {
            resolveNamedAliases: true,
          })?.id === guardRefSymbol?.id &&
          readStaticBoolean(stripParenExpression(cleanupChild.right)) === false &&
          context.cfg.isUnconditionalFromEntry(cleanupChild)
        ) {
          hasUnmountInvalidation = true;
          return false;
        }
      });
    });
  });
  return hasUnmountInvalidation;
};

const effectHasCleanupForUsage = (
  callback: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
  allUsages: ReadonlyArray<SubscribeLikeUsage> = [usage],
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  if (callback.async) return false;
  if (
    cleanupRegistryReleasesUsage(callback, usage, context) ||
    symmetricForEachListenerCleanupReleasesUsage(callback, usage, context) ||
    oneShotTimerHasUnmountGuard(usage, context)
  ) {
    return true;
  }
  if (
    usage.kind === "subscribe" &&
    findEnclosingFunction(usage.node) === callback &&
    doesResourceResultEscape(usage.node, true, true, context) &&
    isKnownCallableSubscriptionResult(usage, context)
  ) {
    return true;
  }
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return callback.body === usage.node && isKnownCallableSubscriptionResult(usage, context);
  }
  const usageExpression = findTransparentExpressionRoot(usage.node);
  const usageAssignment = usageExpression.parent;
  const assignedHandleSymbol =
    isNodeOfType(usageAssignment, "AssignmentExpression") &&
    usageAssignment.operator === "=" &&
    usageAssignment.right === usageExpression &&
    isNodeOfType(usageAssignment.left, "Identifier")
      ? context.scopes.symbolFor(usageAssignment.left)
      : null;
  const requiresDirectReleasePathCoverage =
    usage.kind === "timer" &&
    findEnclosingFunction(usage.node) !== callback &&
    Boolean(
      assignedHandleSymbol &&
      (assignedHandleSymbol.kind === "let" || assignedHandleSymbol.kind === "var") &&
      isNodeOfType(assignedHandleSymbol.declarationNode, "VariableDeclarator") &&
      findEnclosingFunction(assignedHandleSymbol.declarationNode) === callback,
    );
  const matchingCleanupReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ReturnStatement")) return;
    const returnStart = getRangeStart(child);
    const usageStart = getRangeStart(usage.node);
    if (returnStart !== null && usageStart !== null && returnStart < usageStart) return;
    const returnedValue = child.argument ? stripParenExpression(child.argument) : null;
    if (!returnedValue) return;
    if (doesBoundCleanupReleaseUsage(returnedValue, usage, context)) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (
      usage.kind === "subscribe" &&
      (returnedValue === usage.node ||
        (getRangeStart(returnedValue) !== null &&
          getRangeStart(returnedValue) === getRangeStart(usage.node))) &&
      isKnownCallableSubscriptionResult(usage, context)
    ) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (
      usage.kind === "subscribe" &&
      doesStableIdentifierCallUsageDisposer(returnedValue, usage, context)
    ) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (isNodeOfType(returnedValue, "Identifier")) {
      if (returnedValue.name === "undefined" && context.scopes.isGlobalReference(returnedValue)) {
        return;
      }
      const returnedSymbol = context.scopes.symbolFor(returnedValue);
      if (!returnedSymbol?.initializer) return;
    }
    const cleanupFunction = resolveStableValue(returnedValue, context);
    if (cleanupFunction && doesBoundCleanupReleaseUsage(cleanupFunction, usage, context)) {
      matchingCleanupReturns.push(child);
      return;
    }
    if (!cleanupFunction || !isFunctionLike(cleanupFunction)) return;
    if (
      doesCleanupFunctionReleaseUsage(
        cleanupFunction,
        usage,
        context,
        new Set(),
        new Map(),
        requiresDirectReleasePathCoverage,
      )
    ) {
      matchingCleanupReturns.push(child);
    }
  });
  if (hasGuardedDeferredCleanup(callback, usage, matchingCleanupReturns, context)) {
    return true;
  }
  if (
    hasEffectOwnedNestedTimerCleanup(callback, usage, allUsages, matchingCleanupReturns, context)
  ) {
    return true;
  }
  return doMatchingNodesCoverEveryPathAfterUsage(
    resolveCleanupPathAnchor(usage.node, callback, context, usage),
    matchingCleanupReturns,
    context,
  );
};

const findFirstUsageWithoutCleanup = (
  callback: EsTreeNode,
  usages: ReadonlyArray<SubscribeLikeUsage>,
  context: RuleContext,
): SubscribeLikeUsage | null => {
  for (const usage of usages) {
    if (
      !effectHasCleanupForUsage(callback, usage, context, usages) &&
      !hasSplitLifecycleCleanup(callback, usage, context)
    ) {
      return usage;
    }
  }
  return null;
};

// ---- Retained-function analysis (useCallback / component-scope handlers) ----
//
// A resource created inside a function that survives past the current
// call — a `useCallback` callback or a handler declared in component
// scope — leaks exactly like one created in an effect, but no effect
// cleanup return can ever release it. The firing policy here is much
// stricter than the effect policy to stay precise:
//   - `setInterval`, sockets, subscriptions, and observers need a release
//     that targets the same retained handle or registration identity.
//   - a resource returned directly escapes to the caller and is not owned
//     by the retained handler.
// Nested functions are separate scopes: a leak inside an inner callback
// or a nested `useEffect` belongs to that function's own analysis, not
// to the retained handler that happens to enclose it.
// `setTimeout` is deliberately exempt on this path: a one-shot timer
// in a handler (debounce, toast dismiss) is idiomatic, self-clearing
// fire-and-forget.

// `addEventListener(name, handler, { once: true })` self-releases.
// An externally owned `{ signal }` delegates release to its owner, while a
// locally constructed AbortController still needs a reachable abort call.
// `once` must be literally `true`: `{ once: false }` — or a value that
// may be false — keeps the listener registered. The key may be spelled
// as an identifier or a string literal (`{ "once": true }`).
const isLocalAbortControllerExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "NewExpression") &&
    isNodeOfType(unwrappedExpression.callee, "Identifier") &&
    unwrappedExpression.callee.name === "AbortController"
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return isLocalAbortControllerExpression(unwrappedExpression.object, context, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.initializer) {
    return isLocalAbortControllerExpression(symbol.initializer, context, visitedSymbolIds);
  }
  const bindingProperty = symbol.bindingIdentifier.parent;
  const bindingPattern = bindingProperty?.parent;
  const variableDeclarator = bindingPattern?.parent;
  return Boolean(
    isNodeOfType(bindingProperty, "Property") &&
    isNodeOfType(bindingPattern, "ObjectPattern") &&
    isNodeOfType(variableDeclarator, "VariableDeclarator") &&
    variableDeclarator.init &&
    isLocalAbortControllerExpression(variableDeclarator.init, context, visitedSymbolIds),
  );
};

const isSelfReleasingListenerOptionProperty = (
  property: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(property, "Property")) return false;
  const keyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal")
      ? property.key.value
      : null;
  if (keyName === "signal") {
    return !isLocalAbortControllerExpression(property.value, context);
  }
  if (keyName !== "once") return false;
  return isNodeOfType(property.value, "Literal") && property.value.value === true;
};

const hasSelfReleasingListenerOptions = (node: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(node, "CallExpression") &&
  (node.arguments ?? []).some(
    (argument) =>
      isNodeOfType(argument, "ObjectExpression") &&
      (argument.properties ?? []).some((property) =>
        isSelfReleasingListenerOptionProperty(property, context),
      ),
  );

// A release call only counts against a leak when its verb can plausibly
// release that resource. `on` pairs with `.on(name, null)` (d3-style
// removal), which `isReleaseLikeCall` already recognizes.
const PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ["addEventListener", new Set(["removeEventListener", "abort"])],
  ["addListener", new Set(["removeListener", "off", "abort"])],
  ["on", new Set(["off", "removeListener", "on"])],
  ["subscribe", new Set(["unsubscribe", "unsub"])],
  ["sub", new Set(["unsub", "unsubscribe"])],
  ["watch", new Set(["unwatch", "close"])],
  ["listen", new Set(["unlisten", "close"])],
  [OBSERVER_REGISTRATION_METHOD_NAME, new Set(["disconnect", "unobserve"])],
]);

// Whole-lifecycle verbs that release any resource kind.
const UNIVERSAL_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set([
  "cleanup",
  "dispose",
  "destroy",
  "teardown",
]);

const SOCKET_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set(["close"]);
const SUPABASE_CHANNEL_RELEASE_VERB_NAMES: ReadonlySet<string> = new Set([
  "removeChannel",
  "removeAllChannels",
]);

const getReleaseVerbName = (node: EsTreeNode): string | null => {
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return null;
  const callee = isNodeOfType(callNode.callee, "ChainExpression")
    ? callNode.callee.expression
    : callNode.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return TIMER_CLEANUP_CALLEE_NAMES.has(callee.name) ||
      GLOBAL_RELEASE_METHOD_NAMES.has(callee.name) ||
      UNIVERSAL_RELEASE_VERB_NAMES.has(callee.name)
      ? callee.name
      : null;
  }
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    const methodName = callee.property.name;
    return GLOBAL_RELEASE_METHOD_NAMES.has(methodName) ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(methodName) ||
      SUPABASE_CHANNEL_RELEASE_VERB_NAMES.has(methodName) ||
      methodName === "on"
      ? methodName
      : null;
  }
  return null;
};

const isRetainedAbortControllerRefRelease = (
  releaseReceiver: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const releaseFunction = findEnclosingFunction(releaseReceiver);
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    !releaseFunction ||
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    !isReturnedEffectCleanupFunction(releaseFunction, context) ||
    !resolveReactRefCurrentOriginSymbol(releaseReceiver, context.scopes)
  ) {
    return false;
  }
  const controllerKey = getListenerAbortControllerKey(usage, context);
  const refCurrentKey = resolveExpressionKey(releaseReceiver, context);
  if (controllerKey === null || refCurrentKey === null) return false;

  const usageFunctionBody = usageFunction.body;
  const previousAbortCalls: EsTreeNode[] = [];
  const ownershipAssignments: EsTreeNode[] = [];
  walkAst(usageFunctionBody, (child: EsTreeNode) => {
    if (child !== usageFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      resolveExpressionKey(child.left, context) === refCurrentKey &&
      resolveExpressionKey(child.right, context) === controllerKey
    ) {
      ownershipAssignments.push(child);
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const childCallee = isNodeOfType(child.callee, "ChainExpression")
      ? child.callee.expression
      : stripParenExpression(child.callee);
    if (
      isNodeOfType(childCallee, "MemberExpression") &&
      !childCallee.computed &&
      isNodeOfType(childCallee.property, "Identifier") &&
      childCallee.property.name === "abort" &&
      resolveExpressionKey(childCallee.object, context) === refCurrentKey
    ) {
      previousAbortCalls.push(child);
    }
  });
  const safeOwnershipAssignments = ownershipAssignments.filter((assignment) =>
    doMatchingNodesCoverEveryPathBeforeUsage(
      assignment,
      previousAbortCalls,
      usageFunction,
      context,
    ),
  );
  return doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    safeOwnershipAssignments,
    usageFunction,
    context,
  );
};

const isJsxRefAttribute = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "JSXAttribute") &&
  isNodeOfType(node.name, "JSXIdentifier") &&
  node.name.name === "ref";

const isFunctionForwardedToReactRef = (functionNode: EsTreeNode, context: RuleContext): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const expressionContainer = referenceRoot.parent;
    return Boolean(
      isNodeOfType(expressionContainer, "JSXExpressionContainer") &&
      expressionContainer.expression === referenceRoot &&
      isJsxRefAttribute(expressionContainer.parent),
    );
  });
};

const isFunctionReturnedFromReactHook = (
  functionNode: EsTreeNode,
  context: RuleContext,
  requireRefPropertyName: boolean,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const property = referenceRoot.parent;
    const propertyName = isNodeOfType(property, "Property")
      ? getStaticPropertyKeyName(property)
      : null;
    if (
      !isNodeOfType(property, "Property") ||
      property.value !== referenceRoot ||
      !isNodeOfType(property.parent, "ObjectExpression") ||
      (requireRefPropertyName && propertyName !== "ref" && !propertyName?.endsWith("Ref"))
    ) {
      return false;
    }
    const returnedObject = findTransparentExpressionRoot(property.parent);
    const returnStatement = returnedObject.parent;
    if (
      !isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returnedObject
    ) {
      return false;
    }
    const ownerFunction = findEnclosingFunction(returnStatement);
    return Boolean(
      ownerFunction && isReactHookName(getFunctionBindingIdentifier(ownerFunction)?.name ?? ""),
    );
  });
};

const isFunctionUsedAsReactRef = (functionNode: EsTreeNode, context: RuleContext): boolean =>
  isFunctionForwardedToReactRef(functionNode, context) ||
  isFunctionReturnedFromReactHook(functionNode, context, true);

const findCallbackRefReplacementReleaseGuard = (
  releaseCall: EsTreeNode,
  ownerFunction: EsTreeNode,
  releaseReceiverKey: string,
  registrationReceiverKey: string,
  context: RuleContext,
): EsTreeNodeOfType<"IfStatement"> | null => {
  let descendant = releaseCall;
  let ancestor = descendant.parent;
  while (ancestor && ancestor !== ownerFunction) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === descendant &&
      ancestor.alternate === null
    ) {
      const test = stripParenExpression(ancestor.test);
      if (!isNodeOfType(test, "LogicalExpression") || test.operator !== "&&") return null;
      const operands = [stripParenExpression(test.left), stripParenExpression(test.right)];
      const hasLiveReceiverTest = operands.some((operand) =>
        doesTestRequireLiveExpressionKey(operand, releaseReceiverKey, context),
      );
      const hasDifferentReceiverTest = operands.some((operand) => {
        if (
          !isNodeOfType(operand, "BinaryExpression") ||
          (operand.operator !== "!==" && operand.operator !== "!=")
        ) {
          return false;
        }
        const leftKey = resolveExpressionKey(operand.left, context);
        const rightKey = resolveExpressionKey(operand.right, context);
        return (
          (leftKey === releaseReceiverKey && rightKey === registrationReceiverKey) ||
          (rightKey === releaseReceiverKey && leftKey === registrationReceiverKey)
        );
      });
      return hasLiveReceiverTest && hasDifferentReceiverTest ? ancestor : null;
    }
    descendant = ancestor;
    ancestor = descendant.parent;
  }
  return null;
};

const isReactRefListenerReplacementRelease = (
  releaseCall: EsTreeNodeOfType<"CallExpression">,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(usage.node, "CallExpression")) return false;
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    !usageFunction ||
    !isFunctionLike(usageFunction) ||
    usageFunction !== findEnclosingFunction(releaseCall) ||
    !isFunctionUsedAsReactRef(usageFunction, context)
  ) {
    return false;
  }
  const registrationCallee = stripParenExpression(usage.node.callee);
  const releaseCallee = stripParenExpression(releaseCall.callee);
  const releaseRefSymbol = isNodeOfType(releaseCallee, "MemberExpression")
    ? resolveReactRefCurrentOriginSymbol(releaseCallee.object, context.scopes)
    : null;
  if (
    !isNodeOfType(registrationCallee, "MemberExpression") ||
    registrationCallee.computed ||
    !isNodeOfType(registrationCallee.property, "Identifier") ||
    registrationCallee.property.name !== "addEventListener" ||
    !isNodeOfType(releaseCallee, "MemberExpression") ||
    releaseCallee.computed ||
    !isNodeOfType(releaseCallee.property, "Identifier") ||
    releaseCallee.property.name !== "removeEventListener" ||
    !releaseRefSymbol
  ) {
    return false;
  }
  const registrationReceiver = stripParenExpression(registrationCallee.object);
  const registrationReceiverKey = resolveExpressionKey(registrationReceiver, context);
  const nodeParameterKey = resolveExpressionKey(usageFunction.params?.[0], context);
  const releaseReceiverKey = resolveExpressionKey(releaseCallee.object, context);
  if (
    registrationReceiverKey === null ||
    registrationReceiverKey !== nodeParameterKey ||
    releaseReceiverKey === null ||
    usage.eventKey === null ||
    usage.eventKey !== resolveExpressionKey(releaseCall.arguments?.[0], context) ||
    usage.handlerKey === null ||
    usage.handlerKey !== resolveExpressionKey(releaseCall.arguments?.[1], context)
  ) {
    return false;
  }
  if (
    !doEventListenerCapturesMatch(usage.node.arguments?.[2], releaseCall.arguments?.[2], context)
  ) {
    return false;
  }
  const releaseStart = getRangeStart(releaseCall);
  const matchingOwnershipAssignments: EsTreeNode[] = [];
  const usageFunctionBody = usageFunction.body;
  walkAst(usageFunctionBody, (child: EsTreeNode) => {
    if (child !== usageFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      resolveReactRefSymbol(stripParenExpression(child.left), context.scopes)?.id ===
        releaseRefSymbol.id &&
      resolveExpressionKey(child.right, context) === registrationReceiverKey &&
      releaseStart !== null &&
      (getRangeStart(child) ?? -1) > releaseStart
    ) {
      matchingOwnershipAssignments.push(child);
    }
  });
  const releaseAnchor =
    findLiveExpressionGuardForRelease(releaseCall, usageFunction, releaseReceiverKey, context) ??
    findCallbackRefReplacementReleaseGuard(
      releaseCall,
      usageFunction,
      releaseReceiverKey,
      registrationReceiverKey,
      context,
    ) ??
    releaseCall;
  const safeOwnershipAssignments = matchingOwnershipAssignments.filter((assignment) =>
    doMatchingNodesCoverEveryPathBeforeUsage(assignment, [releaseAnchor], usageFunction, context),
  );
  return (
    doNodesCoverEveryPathFromFunctionEntry(usageFunction, [releaseAnchor], context) &&
    doMatchingNodesCoverEveryPathBeforeUsage(
      usage.node,
      safeOwnershipAssignments,
      usageFunction,
      context,
    )
  );
};

const findDirectExhaustiveForEachCleanupFunction = (
  releaseNode: EsTreeNode,
  requiredCollectionKeys: ReadonlySet<string>,
  context: RuleContext,
): EsTreeNode | null => {
  let currentNode = findTransparentExpressionRoot(releaseNode);
  const visitedFunctions = new Set<EsTreeNode>();
  const replayedCollectionKeys = new Set<string>();
  while (true) {
    const ownerFunction = findEnclosingFunction(currentNode);
    if (!ownerFunction || !isFunctionLike(ownerFunction) || visitedFunctions.has(ownerFunction)) {
      return null;
    }
    visitedFunctions.add(ownerFunction);
    const isDirectConciseBody = ownerFunction.body === currentNode;
    const statementNode = currentNode.parent;
    const isDirectBlockStatement =
      isNodeOfType(ownerFunction.body, "BlockStatement") &&
      isNodeOfType(statementNode, "ExpressionStatement") &&
      statementNode.parent === ownerFunction.body;
    if (
      (!isDirectConciseBody && !isDirectBlockStatement) ||
      !doNodesCoverEveryPathFromFunctionEntry(
        ownerFunction,
        [isDirectBlockStatement ? statementNode : currentNode],
        context,
      )
    ) {
      return null;
    }
    const forEachCall = findEnclosingForEachCall(ownerFunction);
    if (!forEachCall) {
      return replayedCollectionKeys.size === requiredCollectionKeys.size &&
        isReturnedEffectCleanupFunction(ownerFunction, context)
        ? ownerFunction
        : null;
    }
    const forEachCallee = stripParenExpression(forEachCall.callee);
    if (!isNodeOfType(forEachCallee, "MemberExpression")) return null;
    const collectionKey = resolveExpressionKey(forEachCallee.object, context);
    if (!collectionKey || !requiredCollectionKeys.has(collectionKey)) return null;
    replayedCollectionKeys.add(collectionKey);
    currentNode = findTransparentExpressionRoot(forEachCall);
  }
};

const collectEnclosingOwnerFunctions = (usageNode: EsTreeNode): Set<EsTreeNode> => {
  const ownerFunctions = new Set<EsTreeNode>();
  let currentNode = usageNode;
  while (true) {
    const ownerFunction = findEnclosingFunction(currentNode);
    if (!ownerFunction || !isFunctionLike(ownerFunction) || ownerFunctions.has(ownerFunction))
      break;
    ownerFunctions.add(ownerFunction);
    currentNode = ownerFunction;
  }
  return ownerFunctions;
};

const hasCollectionMutationBeforeRelease = (
  usageNode: EsTreeNode,
  releaseNode: EsTreeNode,
  collectionMutationLimits: ReadonlyMap<string, number>,
  context: RuleContext,
): boolean => {
  const usageStart = getRangeStart(usageNode);
  const releaseStart = getRangeStart(releaseNode);
  if (usageStart === null || releaseStart === null) return true;
  const setupOwnerFunctions = collectEnclosingOwnerFunctions(usageNode);
  const cleanupOwnerFunctions = collectEnclosingOwnerFunctions(releaseNode);
  const isCollectionKeyRelevantAt = (collectionKey: string | null, sourceStart: number): boolean =>
    collectionKey !== null &&
    sourceStart <= (collectionMutationLimits.get(collectionKey) ?? Number.NEGATIVE_INFINITY);
  const doesNodeMutateCollection = (
    node: EsTreeNode,
    executionStart: number,
    visitedFunctions: ReadonlySet<EsTreeNode>,
    doesReturnEscape: boolean,
  ): boolean => {
    if (
      doesReturnEscape &&
      isNodeOfType(node, "ReturnStatement") &&
      isCollectionKeyRelevantAt(resolveExpressionKey(node.argument, context), executionStart)
    ) {
      return true;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      const assignmentKey = resolveExpressionKey(node.left, context);
      const assignmentTarget = stripParenExpression(node.left);
      const assignedValueKey = resolveExpressionKey(node.right, context);
      return (
        (isCollectionKeyRelevantAt(assignedValueKey, executionStart) &&
          !isCollectionKeyRelevantAt(assignmentKey, executionStart)) ||
        Boolean(
          assignmentKey &&
          [...collectionMutationLimits].some(
            ([collectionKey, mutationLimit]) =>
              executionStart <= mutationLimit &&
              (assignmentKey === collectionKey || assignmentKey === `${collectionKey}.length`),
          ),
        ) ||
        (isNodeOfType(assignmentTarget, "MemberExpression") &&
          assignmentTarget.computed &&
          isCollectionKeyRelevantAt(
            resolveExpressionKey(assignmentTarget.object, context),
            executionStart,
          ))
      );
    }
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
      const deletedMember = stripParenExpression(node.argument);
      return (
        isNodeOfType(deletedMember, "MemberExpression") &&
        isCollectionKeyRelevantAt(
          resolveExpressionKey(deletedMember.object, context),
          executionStart,
        )
      );
    }
    if (isNodeOfType(node, "UpdateExpression")) {
      const updatedKey = resolveExpressionKey(node.argument, context);
      return Boolean(
        updatedKey &&
        [...collectionMutationLimits].some(
          ([collectionKey, mutationLimit]) =>
            executionStart <= mutationLimit && updatedKey === `${collectionKey}.length`,
        ),
      );
    }
    if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) {
      return false;
    }
    const doesReceiveCollection = node.arguments.some((argument) => {
      if (!isAstNode(argument)) return false;
      const argumentKey = resolveExpressionKey(argument, context);
      return (
        isCollectionKeyRelevantAt(argumentKey, executionStart) &&
        resolveIteratorCollectionKey(argument, context) === null
      );
    });
    const callee = stripParenExpression(node.callee);
    const isArrayFromCopy =
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Array" &&
      context.scopes.isGlobalReference(callee.object) &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "from";
    if (doesReceiveCollection && !isArrayFromCopy) return true;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      (REPLAY_ENTRY_DROPPING_ARRAY_METHOD_NAMES.has(callee.property.name) ||
        REPLAY_ENTRY_DROPPING_COLLECTION_METHOD_NAMES.has(callee.property.name)) &&
      isCollectionKeyRelevantAt(resolveExpressionKey(callee.object, context), executionStart)
    ) {
      return true;
    }
    if (!isNodeOfType(node, "CallExpression")) return false;
    const executedFunctions = [
      resolveExactLocalFunction(node.callee, context.scopes),
      ...node.arguments.flatMap((argument) =>
        isAstNode(argument) && isSynchronousIteratorCallbackCall(node, argument)
          ? [resolveExactLocalFunction(argument, context.scopes)]
          : [],
      ),
    ];
    return executedFunctions.some((executedFunction) => {
      if (
        !executedFunction ||
        !isFunctionLike(executedFunction) ||
        executedFunction.generator ||
        visitedFunctions.has(executedFunction)
      ) {
        return false;
      }
      const nextVisitedFunctions = new Set(visitedFunctions);
      nextVisitedFunctions.add(executedFunction);
      let didExecutedFunctionMutateCollection = false;
      walkAst(executedFunction.body, (executedNode: EsTreeNode) => {
        if (didExecutedFunctionMutateCollection) return false;
        if (executedNode !== executedFunction.body && isFunctionLike(executedNode)) return false;
        if (doesNodeMutateCollection(executedNode, executionStart, nextVisitedFunctions, false)) {
          didExecutedFunctionMutateCollection = true;
          return false;
        }
      });
      return didExecutedFunctionMutateCollection;
    });
  };
  let programNode = usageNode;
  while (programNode.parent) programNode = programNode.parent;
  let didFindMutation = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didFindMutation) return false;
    const childStart = getRangeStart(child);
    if (childStart === null) return;
    const ownerFunction = context.cfg.enclosingFunction(child);
    if (!ownerFunction) return;
    const isAfterRegistration = setupOwnerFunctions.has(ownerFunction) && childStart > usageStart;
    const isBeforeRelease = cleanupOwnerFunctions.has(ownerFunction) && childStart < releaseStart;
    if (!isAfterRegistration && !isBeforeRelease) return;
    if (!doesNodeMutateCollection(child, childStart, new Set(), true)) return;
    didFindMutation = true;
    return false;
  });
  return didFindMutation;
};

const usesUnaryListenerSignature = (
  registrationCall: EsTreeNodeOfType<"CallExpression">,
  releaseCall: EsTreeNodeOfType<"CallExpression">,
): boolean =>
  getCalleeName(registrationCall) === "addListener" &&
  registrationCall.arguments?.length === UNARY_LISTENER_ARGUMENT_COUNT &&
  releaseCall.arguments?.length === UNARY_LISTENER_ARGUMENT_COUNT;

const hasSafeForEachProjectionCleanup = (
  registrationCall: EsTreeNodeOfType<"CallExpression">,
  releaseCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const registrationCallee = stripParenExpression(registrationCall.callee);
  const releaseCallee = stripParenExpression(releaseCall.callee);
  if (
    !isNodeOfType(registrationCallee, "MemberExpression") ||
    !isNodeOfType(releaseCallee, "MemberExpression")
  ) {
    return true;
  }
  const registrationVerbName = getCalleeName(registrationCall);
  const releaseVerbName = getCalleeName(releaseCall);
  const releaseHandler =
    releaseCall.arguments?.[
      usesUnaryListenerSignature(registrationCall, releaseCall)
        ? UNARY_LISTENER_HANDLER_ARGUMENT_INDEX
        : EVENT_LISTENER_HANDLER_ARGUMENT_INDEX
    ];
  const releaseFunction = findEnclosingFunction(releaseCall);
  const registrationEventKey = resolveResourceIdentityKey(registrationCall.arguments?.[0], context);
  const releaseEventKey = resolveResourceIdentityKey(releaseCall.arguments?.[0], context);
  const doesHandlerlessOffReleaseEveryRegistration =
    releaseVerbName === "off" &&
    !releaseHandler &&
    (releaseCall.arguments?.length === WHOLE_RECEIVER_RELEASE_ARGUMENT_COUNT ||
      (registrationEventKey !== null && registrationEventKey === releaseEventKey));
  const doesReleaseCoverEveryCleanupPath = Boolean(
    releaseFunction &&
    isFunctionLike(releaseFunction) &&
    isReturnedEffectCleanupFunction(releaseFunction, context) &&
    doNodesCoverEveryPathFromFunctionEntry(releaseFunction, [releaseCall], context),
  );
  if (
    doesReleaseCoverEveryCleanupPath &&
    ((releaseVerbName !== null && UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName)) ||
      doesHandlerlessOffReleaseEveryRegistration)
  ) {
    return true;
  }
  const projectionExpressions = [
    registrationCallee.object,
    registrationCall.arguments?.[0],
    registrationCall.arguments?.[1],
    releaseCallee.object,
    releaseCall.arguments?.[0],
    releaseCall.arguments?.[1],
  ];
  const projections = projectionExpressions.flatMap((expression) => {
    const projection = resolveForEachProjection(expression, context);
    return projection ? [projection] : [];
  });
  if (registrationVerbName === "addEventListener" && releaseVerbName === "removeEventListener") {
    for (const optionsNode of [registrationCall.arguments?.[2], releaseCall.arguments?.[2]]) {
      const captureProjection = resolveEventListenerCaptureProjection(optionsNode, context);
      if (captureProjection) projections.push(captureProjection);
    }
  }
  if (projections.length === 0) return true;
  const collectionKeys = new Set(projections.map((projection) => projection.collectionKey));
  const cleanupFunction = findDirectExhaustiveForEachCleanupFunction(
    releaseCall,
    collectionKeys,
    context,
  );
  if (!cleanupFunction) return false;
  return !hasCollectionMutationBeforeRelease(
    registrationCall,
    releaseCall,
    new Map([...collectionKeys].map((collectionKey) => [collectionKey, Number.POSITIVE_INFINITY])),
    context,
  );
};

const doesReleaseCallMatchUsage = (
  node: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
  parameterSubstitutions: ReadonlyMap<number, EsTreeNode> = new Map(),
): boolean => {
  const callNode = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const callee = isNodeOfType(callNode.callee, "ChainExpression")
    ? callNode.callee.expression
    : callNode.callee;

  if (usage.kind === "timer") {
    const expectedCleanupName =
      usage.registrationVerbName === "setInterval" ? "clearInterval" : "clearTimeout";
    if (
      !isNodeOfType(callee, "Identifier") ||
      !TIMER_CLEANUP_CALLEE_NAMES.has(callee.name) ||
      callee.name !== expectedCleanupName
    ) {
      return false;
    }
    if (
      doesResourceKeyMatchUsageHandle(
        resolveExpressionKey(callNode.arguments?.[0], context, new Set(), parameterSubstitutions),
        usage,
        context,
      )
    ) {
      return true;
    }
    const collectionKey = findContainingCollectionKey(usage.node, context);
    return (
      collectionKey !== null &&
      collectionKey === resolveIteratorCollectionKey(callNode.arguments?.[0], context)
    );
  }

  if (
    isNodeOfType(callee, "Identifier") &&
    usage.kind === "subscribe" &&
    ((doesStableIdentifierMatchUsageHandle(callee, usage, context) &&
      (usage.registrationVerbName !== "addEventListener" &&
      usage.registrationVerbName !== "addListener"
        ? true
        : isKnownCallableSubscriptionResult(usage, context))) ||
      (usage.registrationVerbName === "addListener" &&
        doesCleanupIteratorMatchUsageCollection(callee, usage, context)))
  ) {
    return true;
  }

  const releaseVerbName = getReleaseVerbName(callNode);
  if (!releaseVerbName) return false;

  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier")
  ) {
    return false;
  }
  const releaseReceiverKey = resolveResourceIdentityKey(callee.object, context);
  const releaseEventKey = resolveResourceIdentityKey(callNode.arguments?.[0], context);
  const pairedReleaseVerbNames = usage.registrationVerbName
    ? PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(usage.registrationVerbName)
    : null;
  const pushedResourceCollectionKey = findPushedResourceCollectionKey(usage, context);
  const releaseReceiverForOfStatement = findForOfStatementForIteratorExpression(
    callee.object,
    context,
  );
  const releaseReceiverCollectionKey = releaseReceiverForOfStatement
    ? resolveExpressionKey(releaseReceiverForOfStatement.right, context)
    : resolveIteratorCollectionKey(callee.object, context);
  if (
    pairedReleaseVerbNames &&
    matchesPairedReleaseVerb(releaseVerbName, pairedReleaseVerbNames) &&
    pushedResourceCollectionKey !== null &&
    pushedResourceCollectionKey === releaseReceiverCollectionKey &&
    (releaseVerbName !== "unobserve" ||
      (usage.eventKey !== null && releaseEventKey === usage.eventKey))
  ) {
    return true;
  }

  if (isReactRefListenerReplacementRelease(callNode, usage, context)) return true;

  if (doesSocketOwnerReleaseListenerUsage(releaseReceiverKey, releaseVerbName, usage, context)) {
    return true;
  }

  if (usage.kind === "socket") {
    return (
      doesResourceKeyMatchUsageHandle(releaseReceiverKey, usage, context) &&
      (SOCKET_RELEASE_VERB_NAMES.has(releaseVerbName) ||
        UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName))
    );
  }

  if (
    usage.kind === "subscribe" &&
    isNodeOfType(usage.node, "CallExpression") &&
    (releaseVerbName === "removeChannel" || releaseVerbName === "removeAllChannels") &&
    releaseReceiverKey === resolveChannelClientKey(usage.node, context) &&
    (releaseVerbName === "removeAllChannels" ||
      doesResourceKeyMatchUsageHandle(
        resolveExpressionKey(callNode.arguments?.[0], context, new Set(), parameterSubstitutions),
        usage,
        context,
      ))
  ) {
    return true;
  }

  if (
    (doesResourceKeyMatchUsageHandle(releaseReceiverKey, usage, context) ||
      (usage.kind === "subscribe" &&
        doesCleanupIteratorMatchUsageCollection(callee.object, usage, context))) &&
    (releaseVerbName === "unsubscribe" ||
      releaseVerbName === "unsub" ||
      releaseVerbName === "close" ||
      releaseVerbName === "unwatch" ||
      releaseVerbName === "unlisten" ||
      BOUND_RESOURCE_RELEASE_METHOD_NAMES.has(releaseVerbName))
  ) {
    return true;
  }
  if (
    releaseVerbName === "abort" &&
    releaseReceiverKey === getListenerAbortControllerKey(usage, context)
  ) {
    return true;
  }
  if (
    releaseVerbName === "abort" &&
    isRetainedAbortControllerRefRelease(callee.object, usage, context)
  ) {
    return true;
  }
  if (
    usage.registrationVerbName === "addListener" &&
    releaseVerbName === "removeListener" &&
    isNodeOfType(usage.node, "CallExpression") &&
    usage.node.arguments?.length === UNARY_LISTENER_ARGUMENT_COUNT
  ) {
    if (callNode.arguments?.length !== UNARY_LISTENER_ARGUMENT_COUNT) return false;
    const registrationHandler = resolveStableValue(usage.node.arguments[0], context);
    if (
      !isProvenLegacyMediaQueryListMethodCall(usage.node, "addListener", context) &&
      !isFunctionLike(registrationHandler)
    ) {
      return false;
    }
  }
  if (
    usage.registrationVerbName === "addEventListener" &&
    releaseVerbName === "removeEventListener" &&
    isNodeOfType(usage.node, "CallExpression")
  ) {
    const registrationCallee = stripParenExpression(usage.node.callee);
    if (!isNodeOfType(registrationCallee, "MemberExpression")) return false;
    if (
      !doEventListenerCapturesMatch(
        usage.node.arguments?.[2],
        callNode.arguments?.[2],
        context,
        true,
      )
    )
      return false;
  }
  if (
    isNodeOfType(usage.node, "CallExpression") &&
    !hasSafeForEachProjectionCleanup(usage.node, callNode, context)
  )
    return false;
  const registrationCallee = isNodeOfType(usage.node, "CallExpression")
    ? stripParenExpression(usage.node.callee)
    : null;
  const registrationReceiverCollectionKey = isNodeOfType(registrationCallee, "MemberExpression")
    ? resolveReceiverIteratorCollectionKey(registrationCallee.object, context)
    : null;
  const releaseReceiverCollectionKeyForPair = resolveReceiverIteratorCollectionKey(
    callee.object,
    context,
  );
  const hasMatchingIteratorReceivers =
    registrationReceiverCollectionKey !== null &&
    registrationReceiverCollectionKey === releaseReceiverCollectionKeyForPair;
  if (
    !hasMatchingIteratorReceivers &&
    (usage.receiverKey === null || releaseReceiverKey !== usage.receiverKey)
  ) {
    return false;
  }
  if (
    usage.registrationVerbName === "subscribe" &&
    (releaseVerbName === "unsubscribe" || releaseVerbName === "unsub") &&
    usage.handleKey !== null &&
    resolveExpressionKey(callNode.arguments?.[0], context) === usage.handleKey
  ) {
    return true;
  }
  const pairedVerbNames = usage.registrationVerbName
    ? PAIRED_RELEASE_VERB_NAMES_BY_REGISTRATION_VERB.get(usage.registrationVerbName)
    : null;
  if (!pairedVerbNames || !matchesPairedReleaseVerb(releaseVerbName, pairedVerbNames)) return false;

  const usageEventArgument = isNodeOfType(usage.node, "CallExpression")
    ? usage.node.arguments?.[0]
    : null;
  const releaseEventArgument = callNode.arguments?.[0];
  const hasAssignmentFormLoopIterator =
    isAssignmentFormForOfIteratorReference(usageEventArgument, context) ||
    isAssignmentFormForOfIteratorReference(releaseEventArgument, context);
  if (hasAssignmentFormLoopIterator) return false;
  if (usage.eventKey !== null && releaseEventKey !== null && usage.eventKey !== releaseEventKey) {
    if (!isNodeOfType(usage.node, "CallExpression")) return false;
    const registrationEventProjectionKey = resolveForEachProjectionKey(
      usage.node.arguments?.[0],
      context,
    );
    const releaseEventProjectionKey = resolveForEachProjectionKey(callNode.arguments?.[0], context);
    if (
      (registrationEventProjectionKey !== null || releaseEventProjectionKey !== null) &&
      registrationEventProjectionKey !== releaseEventProjectionKey
    ) {
      return false;
    }
    const usageForOfStatement = findForOfStatementForIteratorExpression(
      usageEventArgument,
      context,
    );
    const releaseForOfStatement = findForOfStatementForIteratorExpression(
      releaseEventArgument,
      context,
    );
    if ((usageForOfStatement === null) !== (releaseForOfStatement === null)) return false;
    const usageIteratorCollectionKey = resolveIteratorCollectionKey(
      usage.node.arguments?.[0],
      context,
    );
    const releaseIteratorCollectionKey = resolveIteratorCollectionKey(
      callNode.arguments?.[0],
      context,
    );
    if (
      usageIteratorCollectionKey === null ||
      usageIteratorCollectionKey !== releaseIteratorCollectionKey
    ) {
      return false;
    }
    if (usageForOfStatement && releaseForOfStatement) {
      const registrationHandlerSymbolId = resolveStableLoopHandlerSymbolId(
        usage.node.arguments?.[1],
        context,
      );
      const releaseHandlerSymbolId = resolveStableLoopHandlerSymbolId(
        callNode.arguments?.[1],
        context,
      );
      if (
        usage.registrationVerbName !== "addEventListener" ||
        releaseVerbName !== "removeEventListener"
      ) {
        return false;
      }
      const registrationCallee = stripParenExpression(usage.node.callee);
      if (!isNodeOfType(registrationCallee, "MemberExpression")) return false;
      if (
        !isStableLoopReceiver(registrationCallee.object, context) ||
        !isStableLoopReceiver(callee.object, context) ||
        registrationHandlerSymbolId === null ||
        registrationHandlerSymbolId !== releaseHandlerSymbolId
      ) {
        return false;
      }
      if (
        !doEventListenerCapturesMatch(usage.node.arguments?.[2], callNode.arguments?.[2], context)
      ) {
        return false;
      }
      if (!isDirectExhaustiveForOfRelease(callNode, releaseForOfStatement, context)) return false;
    }
  }
  if (releaseVerbName === "on") {
    const handlerArgument = callNode.arguments?.[1];
    return isNodeOfType(handlerArgument, "Literal") && handlerArgument.value === null;
  }
  if (
    releaseVerbName === "removeEventListener" ||
    releaseVerbName === "removeListener" ||
    releaseVerbName === "off"
  ) {
    const usesUnaryListenerSignatureForCalls =
      isNodeOfType(usage.node, "CallExpression") &&
      usesUnaryListenerSignature(usage.node, callNode);
    const releaseHandler = usesUnaryListenerSignatureForCalls
      ? callNode.arguments?.[UNARY_LISTENER_HANDLER_ARGUMENT_INDEX]
      : callNode.arguments?.[EVENT_LISTENER_HANDLER_ARGUMENT_INDEX];
    if (!releaseHandler) return releaseVerbName === "off";
    const expectedHandlerKey = usesUnaryListenerSignatureForCalls
      ? (usage.handlerKey ?? usage.eventKey)
      : usage.handlerKey;
    const registrationHandler = isNodeOfType(usage.node, "CallExpression")
      ? usage.node.arguments?.[
          usesUnaryListenerSignatureForCalls
            ? UNARY_LISTENER_HANDLER_ARGUMENT_INDEX
            : EVENT_LISTENER_HANDLER_ARGUMENT_INDEX
        ]
      : null;
    return (
      (expectedHandlerKey !== null &&
        resolveResourceIdentityKey(releaseHandler, context) === expectedHandlerKey) ||
      (registrationHandler !== null &&
        resolveStableValue(releaseHandler, context) ===
          resolveStableValue(registrationHandler, context))
    );
  }
  if (releaseVerbName === "unobserve" && usage.eventKey !== null) {
    return releaseEventKey === usage.eventKey;
  }
  return true;
};

const matchesPairedReleaseVerb = (
  releaseVerbName: string,
  pairedVerbNames: ReadonlySet<string>,
): boolean =>
  pairedVerbNames.has(releaseVerbName) || UNIVERSAL_RELEASE_VERB_NAMES.has(releaseVerbName);

const isReturnedEffectCleanupFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const effectCallback = findEnclosingFunction(functionNode);
  if (!effectCallback || !isFunctionLike(effectCallback)) return false;
  const effectCall = effectCallback.parent;
  if (
    !isNodeOfType(effectCall, "CallExpression") ||
    !isReactHookCall(effectCall, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)
  ) {
    return false;
  }
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return resolveStableValue(effectCallback.body, context) === functionNode;
  }
  let isReturned = false;
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      resolveStableValue(child.argument, context) === functionNode
    ) {
      isReturned = true;
    }
  });
  return isReturned;
};

const isPotentiallyReachableFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    isInlineRetainedHandlerFunction(functionNode, context) ||
    isReturnedEffectCleanupFunction(functionNode, context)
  ) {
    return true;
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  return symbol.references.some(
    (reference) => findEnclosingFunction(reference.identifier) !== functionNode,
  );
};

const findRetainedDisposerStorages = (
  disposerFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): RetainedDisposerStorage[] => {
  if (!isFunctionLike(disposerFunction) || disposerFunction.async || disposerFunction.generator) {
    return [];
  }
  const usageFunction = findEnclosingFunction(usage.node);
  if (!usageFunction || !isFunctionLike(usageFunction)) return [];
  const assignments = new Map<number, RetainedDisposerStorage>();
  const collectAssignment = (expression: EsTreeNode): void => {
    const expressionRoot = findTransparentExpressionRoot(expression);
    const assignment = expressionRoot.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.right !== expressionRoot
    ) {
      return;
    }
    const refSymbol = resolveReactRefSymbol(stripParenExpression(assignment.left), context.scopes);
    const refCurrentKey = resolveExpressionKey(assignment.left, context);
    const retainedFunction = findEnclosingFunction(assignment);
    const assignmentStart = getRangeStart(assignment);
    if (
      !refSymbol ||
      !refCurrentKey ||
      !retainedFunction ||
      retainedFunction !== usageFunction ||
      assignmentStart === null
    ) {
      return;
    }
    assignments.set(assignmentStart, {
      assignmentNode: assignment,
      refCurrentKey,
      retainedFunction,
    });
  };
  collectAssignment(disposerFunction);
  const bindingIdentifier = getFunctionBindingIdentifier(disposerFunction);
  const symbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  for (const reference of symbol?.references ?? []) {
    collectAssignment(reference.identifier);
  }
  walkAst(usageFunction.body, (child: EsTreeNode) => {
    if (child !== usageFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      resolveStableValue(child.right, context) === disposerFunction
    ) {
      collectAssignment(child.right);
    }
  });
  return [...assignments.values()];
};

const isRetainedDisposerStorageEstablished = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean =>
  doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    [storage.assignmentNode],
    storage.retainedFunction,
    context,
  ) || doMatchingNodesCoverEveryPathAfterUsage(usage.node, [storage.assignmentNode], context);

const hasUnsafeRetainedDisposerOverwrite = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  let hasUnsafeOverwrite = false;
  walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
    if (hasUnsafeOverwrite) return false;
    if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "AssignmentExpression") ||
      child === storage.assignmentNode ||
      resolveExpressionKey(child.left, context) !== storage.refCurrentKey ||
      !canNodeReachLaterNodeWithinFunction(usage.node, child, storage.retainedFunction, context)
    ) {
      return;
    }
    const storedValue = resolveStableValue(child.right, context);
    if (
      !storedValue ||
      !isFunctionLike(storedValue) ||
      !doesCleanupFunctionReleaseUsage(storedValue, usage, context)
    ) {
      hasUnsafeOverwrite = true;
      return false;
    }
  });
  return hasUnsafeOverwrite;
};

const hasEffectCleanupInvocation = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(storage.retainedFunction);
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  const cleanupFunctionInvokesRef = (cleanupFunction: EsTreeNode): boolean => {
    if (!isFunctionLike(cleanupFunction)) return false;
    let didFindCleanupCall = false;
    walkAst(cleanupFunction.body, (child: EsTreeNode) => {
      if (didFindCleanupCall) return false;
      if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        resolveExpressionKey(child.callee, context) === storage.refCurrentKey
      ) {
        const callRoot = findTransparentExpressionRoot(child);
        const callStatement = callRoot.parent;
        const isDirectBlockStatement =
          isNodeOfType(cleanupFunction.body, "BlockStatement") &&
          isNodeOfType(callStatement, "ExpressionStatement") &&
          callStatement.parent === cleanupFunction.body;
        const isConciseBody = cleanupFunction.body === callRoot;
        if (
          (isDirectBlockStatement || isConciseBody) &&
          !hasUnprovenReturnBeforeRefOwnedRelease(
            cleanupFunction,
            child,
            storage.refCurrentKey,
            context,
          )
        ) {
          didFindCleanupCall = true;
          return false;
        }
      }
    });
    return didFindCleanupCall;
  };
  const effectReturnsCleanup = (effectCallback: EsTreeNode): boolean => {
    if (!isFunctionLike(effectCallback)) return false;
    if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
      const cleanupFunction = resolveRefOwnedCleanupFunction(effectCallback.body, context);
      return Boolean(cleanupFunction && cleanupFunctionInvokesRef(cleanupFunction));
    }
    const matchingReturns: EsTreeNode[] = [];
    walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
      const cleanupFunction = resolveRefOwnedCleanupFunction(child.argument, context);
      if (!cleanupFunction || !cleanupFunctionInvokesRef(cleanupFunction)) return;
      matchingReturns.push(child);
    });
    return doNodesCoverEveryPathFromFunctionEntry(effectCallback, matchingReturns, context);
  };
  let didFindInvocation = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (didFindInvocation) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactApiCall(child, "useEffect", context.scopes)
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (effectCallback && effectReturnsCleanup(effectCallback)) {
      didFindInvocation = true;
      return false;
    }
  });
  return didFindInvocation;
};

const hasCallbackRefReplacementInvocation = (
  storage: RetainedDisposerStorage,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const isReturnedCallbackRefShape = (): boolean => {
    if (!isFunctionLike(storage.retainedFunction)) return false;
    const functionRoot = findTransparentExpressionRoot(storage.retainedFunction);
    const callbackCall = functionRoot.parent;
    if (
      !isNodeOfType(callbackCall, "CallExpression") ||
      !isReactApiCall(callbackCall, "useCallback", context.scopes)
    ) {
      return false;
    }
    const nodeParameter = storage.retainedFunction.params?.[0];
    const nodeParameterKey = resolveExpressionKey(nodeParameter, context);
    if (!nodeParameterKey || usage.receiverKey !== nodeParameterKey) return false;
    if (!isFunctionReturnedFromReactHook(storage.retainedFunction, context, false)) return false;
    const usageStart = getRangeStart(usage.node);
    if (usageStart === null) return false;
    let hasNullExit = false;
    walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
      if (hasNullExit) return false;
      if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
      if (
        !isNodeOfType(child, "IfStatement") ||
        (getRangeStart(child) ?? usageStart) >= usageStart
      ) {
        return;
      }
      const test = stripParenExpression(child.test);
      if (
        !isNodeOfType(test, "UnaryExpression") ||
        test.operator !== "!" ||
        resolveExpressionKey(test.argument, context) !== nodeParameterKey
      ) {
        return;
      }
      const consequent = child.consequent;
      hasNullExit =
        isNodeOfType(consequent, "ReturnStatement") ||
        (isNodeOfType(consequent, "BlockStatement") &&
          consequent.body.some((statement) => isNodeOfType(statement, "ReturnStatement")));
      if (hasNullExit) return false;
    });
    return hasNullExit;
  };
  if (
    !isFunctionForwardedToReactRef(storage.retainedFunction, context) &&
    !isReturnedCallbackRefShape()
  ) {
    return false;
  }
  const cleanupCalls: EsTreeNode[] = [];
  walkAst(storage.retainedFunction.body, (child: EsTreeNode) => {
    if (child !== storage.retainedFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      resolveExpressionKey(child.callee, context) === storage.refCurrentKey
    ) {
      cleanupCalls.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathBeforeUsage(
    usage.node,
    cleanupCalls,
    storage.retainedFunction,
    context,
  );
};

const isRetainedDisposerRefRelease = (
  releaseNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const disposerFunction = findEnclosingFunction(releaseNode);
  if (!disposerFunction) return false;
  return findRetainedDisposerStorages(disposerFunction, usage, context).some(
    (storage) =>
      isRetainedDisposerStorageEstablished(storage, usage, context) &&
      !hasUnsafeRetainedDisposerOverwrite(storage, usage, context) &&
      (hasEffectCleanupInvocation(storage, usage, context) ||
        hasCallbackRefReplacementInvocation(storage, usage, context)),
  );
};

const isSelfReleasingListenerRelease = (
  releaseNode: EsTreeNode,
  releaseFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    usage.kind !== "subscribe" ||
    usage.registrationVerbName !== "addEventListener" ||
    usage.receiverKey === null ||
    usage.eventKey === null ||
    !isNodeOfType(usage.node, "CallExpression") ||
    !isFunctionLike(releaseFunction) ||
    releaseFunction.async ||
    releaseFunction.generator ||
    !isNodeOfType(releaseFunction.body, "BlockStatement") ||
    !doNodesCoverEveryPathFromFunctionEntry(releaseFunction, [releaseNode], context)
  ) {
    return false;
  }
  const releaseCall = isNodeOfType(releaseNode, "ChainExpression")
    ? releaseNode.expression
    : releaseNode;
  if (!isNodeOfType(releaseCall, "CallExpression")) return false;
  if (
    !doEventListenerCapturesMatch(usage.node.arguments?.[2], releaseCall.arguments?.[2], context)
  ) {
    return false;
  }
  const ownerFunction = findEnclosingFunction(releaseFunction);
  if (!ownerFunction || !isFunctionLike(ownerFunction)) return false;
  const triggerRegistrations: EsTreeNode[] = [];
  walkAst(ownerFunction.body, (child: EsTreeNode) => {
    if (child !== ownerFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const registrationDetails = getCallRegistrationDetails(child, context);
    if (
      registrationDetails.registrationVerbName === "addEventListener" &&
      registrationDetails.receiverKey === usage.receiverKey &&
      resolveStableValue(child.arguments?.[1], context) === releaseFunction
    ) {
      triggerRegistrations.push(child);
    }
  });
  if (triggerRegistrations.some((triggerRegistration) => triggerRegistration === usage.node)) {
    return true;
  }
  return (
    doMatchingNodesCoverEveryPathAfterUsage(usage.node, triggerRegistrations, context) ||
    doMatchingNodesCoverEveryPathBeforeUsage(
      usage.node,
      triggerRegistrations,
      ownerFunction,
      context,
    )
  );
};

const isReleaseReachableForUsage = (
  releaseNode: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (!isNodeReachableWithinFunction(releaseNode, context)) return false;
  const releaseFunction = findEnclosingFunction(releaseNode);
  if (!releaseFunction) return true;
  if (releaseFunction === findEnclosingFunction(usage.node)) return true;
  if (isRetainedDisposerRefRelease(releaseNode, usage, context)) return true;
  const usageFunction = findEnclosingFunction(usage.node);
  if (
    usageFunction &&
    isFunctionLike(usageFunction) &&
    getAssignedReactRefSymbol(usageFunction, context) &&
    isCleanupFunctionReferencedByReturn(usageFunction, releaseFunction, context)
  ) {
    return isReactRefCallbackCleanupOwnedByEffect(usageFunction, releaseFunction, usage, context);
  }
  if (isSelfReleasingListenerRelease(releaseNode, releaseFunction, usage, context)) return true;
  return isPotentiallyReachableFunction(releaseFunction, context);
};

const fileContainsReleaseForUsage = (usage: SubscribeLikeUsage, context: RuleContext): boolean => {
  const anyNode = usage.node;
  let programNode: EsTreeNode = anyNode;
  while (programNode.parent) programNode = programNode.parent;
  let indexesByProgram = FILE_RELEASE_CALL_INDEX_CACHE.get(context);
  if (!indexesByProgram) {
    indexesByProgram = new WeakMap();
    FILE_RELEASE_CALL_INDEX_CACHE.set(context, indexesByProgram);
  }
  let releaseCallIndex = indexesByProgram.get(programNode);
  if (!releaseCallIndex) {
    const identifierCallsByName = new Map<string, EsTreeNode[]>();
    const potentialNonTimerCalls: EsTreeNode[] = [];
    walkAst(programNode, (child: EsTreeNode) => {
      const callNode = isNodeOfType(child, "ChainExpression") ? child.expression : child;
      if (!isNodeOfType(callNode, "CallExpression")) return;
      const callee = isNodeOfType(callNode.callee, "ChainExpression")
        ? callNode.callee.expression
        : callNode.callee;
      if (isNodeOfType(callee, "Identifier")) {
        const namedCalls = identifierCallsByName.get(callee.name) ?? [];
        namedCalls.push(child);
        identifierCallsByName.set(callee.name, namedCalls);
        potentialNonTimerCalls.push(child);
      } else if (getReleaseVerbName(child)) {
        potentialNonTimerCalls.push(child);
      }
    });
    releaseCallIndex = { identifierCallsByName, potentialNonTimerCalls };
    indexesByProgram.set(programNode, releaseCallIndex);
  }
  let candidates: ReadonlyArray<EsTreeNode>;
  if (usage.kind === "timer") {
    const expectedCleanupName =
      usage.registrationVerbName === "setInterval" ? "clearInterval" : "clearTimeout";
    candidates = releaseCallIndex.identifierCallsByName.get(expectedCleanupName) ?? [];
  } else {
    candidates = releaseCallIndex.potentialNonTimerCalls;
  }
  let didFindRelease = false;
  const inspectCandidate = (child: EsTreeNode): void | false => {
    if (didFindRelease) return false;
    if (
      doesReleaseCallMatchUsage(child, usage, context) &&
      isReleaseReachableForUsage(child, usage, context)
    ) {
      didFindRelease = true;
      return false;
    }
  };
  for (const candidate of candidates) {
    if (inspectCandidate(candidate) === false) break;
  }
  return didFindRelease;
};

const resolveRefOwnedCleanupFunction = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const resolvedExpression = resolveStableValue(expression, context);
  if (isFunctionLike(resolvedExpression)) return resolvedExpression;
  if (
    !isNodeOfType(resolvedExpression, "CallExpression") ||
    !isReactApiCall(resolvedExpression, "useCallback", context.scopes)
  ) {
    return null;
  }
  return getEffectCallback(resolvedExpression);
};

const findRefOwnedHandlerStorage = (
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): RefOwnedHandlerStorage | null => {
  if (
    !isFunctionLike(retainedFunction) ||
    usage.kind !== "subscribe" ||
    usage.registrationVerbName !== "addEventListener" ||
    usage.handlerKey === null ||
    !usage.receiverKey?.startsWith("global:") ||
    !usage.eventKey?.startsWith("literal:")
  ) {
    return null;
  }
  const usageStart = getRangeStart(usage.node);
  const functionCfg = context.cfg.cfgFor(retainedFunction);
  const usageBlock = functionCfg?.blockOf(usage.node);
  if (usageStart === null || !functionCfg || !usageBlock) return null;
  const matchingStorage: RefOwnedHandlerStorage[] = [];
  walkAst(retainedFunction.body, (child: EsTreeNode) => {
    if (child !== retainedFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    const assignmentStart = getRangeStart(child);
    const refCurrentExpression = stripParenExpression(child.left);
    if (
      assignmentStart === null ||
      assignmentStart >= usageStart ||
      functionCfg.blockOf(child) !== usageBlock ||
      !isNodeOfType(refCurrentExpression, "MemberExpression") ||
      !resolveReactRefSymbol(refCurrentExpression, context.scopes)
    ) {
      return;
    }
    const refCurrentKey = resolveExpressionKey(refCurrentExpression, context);
    const refKey = resolveExpressionKey(refCurrentExpression.object, context);
    const storedSession = stripParenExpression(child.right);
    if (!refCurrentKey || !refKey || !isNodeOfType(storedSession, "ObjectExpression")) return;
    const storedSessionProperties = storedSession.properties ?? [];
    if (storedSessionProperties.some((property) => !isNodeOfType(property, "Property"))) return;
    for (const property of storedSessionProperties) {
      if (!isNodeOfType(property, "Property")) continue;
      const propertyName = getStaticPropertyKeyName(property);
      if (propertyName && resolveExpressionKey(property.value, context) === usage.handlerKey) {
        const handlerKey = `${refCurrentKey}.${propertyName}`;
        matchingStorage.push({
          handlerKey,
          refCurrentKey,
          refKey,
          assignmentNode: child,
        });
      }
    }
  });
  return matchingStorage.length === 1 ? matchingStorage[0] : null;
};

const doMatchingNodesCoverEveryPathBeforeUsage = (
  usageNode: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  const usageBlock = functionCfg?.blockOf(usageNode);
  const usageStart = getRangeStart(usageNode);
  if (!functionCfg || !usageBlock || usageStart === null) return false;
  const matchingBlocks = new Set(
    matchingNodes.flatMap((matchingNode) => {
      if (context.cfg.enclosingFunction(matchingNode) !== owner) return [];
      const matchingStart = getRangeStart(matchingNode);
      if (matchingStart === null || matchingStart >= usageStart) return [];
      const matchingBlock = functionCfg.blockOf(matchingNode);
      return matchingBlock ? [matchingBlock] : [];
    }),
  );
  if (matchingBlocks.size === 0) return false;
  if (matchingBlocks.has(usageBlock)) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingBlocks.has(currentBlock)) continue;
    if (currentBlock === usageBlock) return false;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};

const retainedFunctionReleasesPreviousRefOwnedUsage = (
  retainedFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  storageNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(retainedFunction)) return false;
  const retainedFunctionBody = retainedFunction.body;
  const cleanupCalls: EsTreeNode[] = [];
  walkAst(retainedFunctionBody, (child: EsTreeNode) => {
    if (child !== retainedFunctionBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      resolveRefOwnedCleanupFunction(child.callee, context) === cleanupFunction
    ) {
      cleanupCalls.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathBeforeUsage(
    storageNode,
    cleanupCalls,
    retainedFunction,
    context,
  );
};

const isDirectRefOwnedRelease = (
  releaseNode: EsTreeNode,
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  storedHandlerKey: string,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(cleanupFunction)) return false;
  const releaseCall = isNodeOfType(releaseNode, "ChainExpression")
    ? releaseNode.expression
    : releaseNode;
  if (
    !isNodeOfType(releaseCall, "CallExpression") ||
    !isNodeOfType(releaseCall.callee, "MemberExpression") ||
    releaseCall.callee.computed ||
    !isNodeOfType(releaseCall.callee.property, "Identifier") ||
    releaseCall.callee.property.name !== "removeEventListener" ||
    !isNodeOfType(usage.node, "CallExpression") ||
    usage.node.arguments?.[2] !== undefined ||
    releaseCall.arguments?.[2] !== undefined
  ) {
    return false;
  }
  const releaseRoot = findTransparentExpressionRoot(releaseNode);
  const releaseStatement = releaseRoot.parent;
  const releaseBlock = releaseStatement?.parent;
  const releaseGuard = releaseBlock?.parent;
  const isDirectCleanupStatement = releaseBlock === cleanupFunction.body;
  const isRefPresenceGuardedStatement = Boolean(
    isNodeOfType(releaseBlock, "BlockStatement") &&
    isNodeOfType(releaseGuard, "IfStatement") &&
    releaseGuard.consequent === releaseBlock &&
    releaseGuard.alternate === null &&
    resolveExpressionKey(releaseGuard.test, context) === refCurrentKey,
  );
  if (
    !isNodeOfType(releaseStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupFunction.body, "BlockStatement") ||
    (!isDirectCleanupStatement && !isRefPresenceGuardedStatement)
  ) {
    return false;
  }
  return (
    usage.receiverKey !== null &&
    usage.receiverKey === resolveExpressionKey(releaseCall.callee.object, context) &&
    usage.eventKey !== null &&
    usage.eventKey === resolveExpressionKey(releaseCall.arguments?.[0], context) &&
    resolveExpressionKey(releaseCall.arguments?.[1], context) === storedHandlerKey
  );
};

const isRefPresenceGuardedEarlyReturn = (
  returnStatement: EsTreeNode,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  const returnBranch = returnStatement.parent;
  const guardStatement = isNodeOfType(returnBranch, "BlockStatement")
    ? returnBranch.parent
    : returnBranch;
  const guardedConsequent = isNodeOfType(returnBranch, "BlockStatement")
    ? returnBranch
    : returnStatement;
  if (
    !isNodeOfType(guardStatement, "IfStatement") ||
    guardStatement.consequent !== guardedConsequent ||
    guardStatement.alternate !== null
  ) {
    return false;
  }
  const guardTest = stripParenExpression(guardStatement.test);
  return (
    isNodeOfType(guardTest, "UnaryExpression") &&
    guardTest.operator === "!" &&
    resolveExpressionKey(guardTest.argument, context) === refCurrentKey
  );
};

const hasUnprovenReturnBeforeRefOwnedRelease = (
  cleanupFunction: EsTreeNode,
  releaseNode: EsTreeNode,
  refCurrentKey: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(cleanupFunction)) return true;
  const releaseStart = getRangeStart(releaseNode);
  if (releaseStart === null) return true;
  let hasUnprovenEarlyReturn = false;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (hasUnprovenEarlyReturn) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    const returnStart = getRangeStart(child);
    if (
      (returnStart === null || returnStart < releaseStart) &&
      !isRefPresenceGuardedEarlyReturn(child, refCurrentKey, context)
    ) {
      hasUnprovenEarlyReturn = true;
      return false;
    }
  });
  return hasUnprovenEarlyReturn;
};

const cleanupFunctionReleasesRefOwnedUsage = (
  cleanupFunction: EsTreeNode,
  componentFunction: EsTreeNode,
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(cleanupFunction) ||
    !isFunctionLike(componentFunction) ||
    cleanupFunction.async ||
    cleanupFunction.generator
  ) {
    return false;
  }
  const storage = findRefOwnedHandlerStorage(retainedFunction, usage, context);
  if (!storage) return false;
  if (
    !retainedFunctionReleasesPreviousRefOwnedUsage(
      retainedFunction,
      cleanupFunction,
      storage.assignmentNode,
      context,
    )
  ) {
    return false;
  }
  let releaseNode: EsTreeNode | null = null;
  walkAst(cleanupFunction.body, (child: EsTreeNode) => {
    if (releaseNode) return false;
    if (child !== cleanupFunction.body && isFunctionLike(child)) return false;
    if (
      isDirectRefOwnedRelease(
        child,
        cleanupFunction,
        usage,
        storage.handlerKey,
        storage.refCurrentKey,
        context,
      )
    ) {
      releaseNode = child;
      return false;
    }
  });
  if (!releaseNode) return false;
  if (
    hasUnprovenReturnBeforeRefOwnedRelease(
      cleanupFunction,
      releaseNode,
      storage.refCurrentKey,
      context,
    )
  ) {
    return false;
  }
  let hasUnsafeRefWrite = false;
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (hasUnsafeRefWrite) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "delete") {
      const deleteTarget = stripParenExpression(child.argument);
      if (
        resolveExpressionKey(deleteTarget, context) === storage.handlerKey ||
        (isNodeOfType(deleteTarget, "MemberExpression") &&
          resolveExpressionKey(deleteTarget.object, context) === storage.refCurrentKey)
      ) {
        hasUnsafeRefWrite = true;
        return false;
      }
      return;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const doesCallReceiveOwnedRef = (child.arguments ?? []).some((argumentNode) => {
        const argumentKey = resolveExpressionKey(argumentNode, context);
        return (
          argumentKey !== null &&
          (argumentKey === storage.refKey || argumentKey === storage.refCurrentKey)
        );
      });
      if (doesCallReceiveOwnedRef) {
        hasUnsafeRefWrite = true;
        return false;
      }
      return;
    }
    if (!isNodeOfType(child, "AssignmentExpression")) return;
    const assignmentTarget = stripParenExpression(child.left);
    if (
      isNodeOfType(assignmentTarget, "MemberExpression") &&
      assignmentTarget.computed &&
      resolveExpressionKey(assignmentTarget.object, context) === storage.refCurrentKey
    ) {
      hasUnsafeRefWrite = true;
      return false;
    }
    const assignedKey = resolveExpressionKey(child.left, context);
    if (assignedKey === storage.handlerKey) {
      hasUnsafeRefWrite = true;
      return false;
    }
    if (assignedKey !== storage.refCurrentKey) return;
    const assignedValue = stripParenExpression(child.right);
    if (
      isNodeOfType(assignedValue, "Literal") &&
      assignedValue.value === null &&
      findEnclosingFunction(child) === cleanupFunction
    ) {
      return;
    }
    const assignedSession = isNodeOfType(assignedValue, "ObjectExpression") ? assignedValue : null;
    const assignedSessionProperties = assignedSession?.properties ?? [];
    const storesMatchingHandler =
      assignedSessionProperties.every((property) => isNodeOfType(property, "Property")) &&
      assignedSessionProperties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          `${storage.refCurrentKey}.${getStaticPropertyKeyName(property) ?? ""}` ===
            storage.handlerKey &&
          resolveExpressionKey(property.value, context) === usage.handlerKey,
      );
    if (findEnclosingFunction(child) !== retainedFunction || !storesMatchingHandler) {
      hasUnsafeRefWrite = true;
      return false;
    }
  });
  return !hasUnsafeRefWrite;
};

const effectReturnsRefOwnedCleanup = (
  effectCallback: EsTreeNode,
  componentFunction: EsTreeNode,
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const matchesReturnedCleanup = (returnedValue: EsTreeNode): boolean => {
    const cleanupFunction = resolveRefOwnedCleanupFunction(returnedValue, context);
    return Boolean(
      cleanupFunction &&
      cleanupFunctionReleasesRefOwnedUsage(
        cleanupFunction,
        componentFunction,
        retainedFunction,
        usage,
        context,
      ),
    );
  };
  if (!isFunctionLike(effectCallback)) return false;
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return matchesReturnedCleanup(stripParenExpression(effectCallback.body));
  }
  const matchingReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      matchesReturnedCleanup(stripParenExpression(child.argument))
    ) {
      matchingReturns.push(child);
    }
  });
  return doNodesCoverEveryPathFromFunctionEntry(effectCallback, matchingReturns, context);
};

const hasGuaranteedRefOwnedUnmountCleanup = (
  retainedFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  const componentFunction = findEnclosingFunction(retainedFunction);
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  let effectCallsByComponent = COMPONENT_EFFECT_CALLS_CACHE.get(context);
  if (!effectCallsByComponent) {
    effectCallsByComponent = new WeakMap();
    COMPONENT_EFFECT_CALLS_CACHE.set(context, effectCallsByComponent);
  }
  let effectCalls = effectCallsByComponent.get(componentFunction);
  if (!effectCalls) {
    const collectedEffectCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    walkAst(componentFunction.body, (child: EsTreeNode) => {
      if (
        isNodeOfType(child, "CallExpression") &&
        findEnclosingFunction(child) === componentFunction &&
        isReactApiCall(child, "useEffect", context.scopes)
      ) {
        collectedEffectCalls.push(child);
      }
    });
    effectCalls = collectedEffectCalls;
    effectCallsByComponent.set(componentFunction, effectCalls);
  }
  for (const effectCall of effectCalls) {
    const effectStatement = findTransparentExpressionRoot(effectCall).parent;
    if (
      !isNodeOfType(effectStatement, "ExpressionStatement") ||
      effectStatement.parent !== componentFunction.body
    ) {
      continue;
    }
    const effectCallback = getEffectCallback(effectCall);
    if (
      effectCallback &&
      effectReturnsRefOwnedCleanup(
        effectCallback,
        componentFunction,
        retainedFunction,
        usage,
        context,
      )
    ) {
      return true;
    }
  }
  return false;
};

const isUseSyncExternalStoreSubscribeFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const visitedSymbolIds = new Set<number>();
  const isSubscribeBinding = (candidateBinding: EsTreeNode): boolean => {
    const symbol = context.scopes.symbolFor(candidateBinding);
    if (!symbol || visitedSymbolIds.has(symbol.id) || symbol.references.length === 0) return false;
    visitedSymbolIds.add(symbol.id);
    return symbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const referenceParent = referenceRoot.parent;
      if (
        isNodeOfType(referenceParent, "CallExpression") &&
        referenceParent.arguments?.[0] === referenceRoot
      ) {
        return isReactApiCall(referenceParent, "useSyncExternalStore", context.scopes);
      }
      const aliasDeclaration = referenceParent?.parent;
      return Boolean(
        isNodeOfType(referenceParent, "VariableDeclarator") &&
        referenceParent.init === referenceRoot &&
        isNodeOfType(referenceParent.id, "Identifier") &&
        isNodeOfType(aliasDeclaration, "VariableDeclaration") &&
        aliasDeclaration.kind === "const" &&
        isSubscribeBinding(referenceParent.id),
      );
    });
  };
  return isSubscribeBinding(bindingIdentifier);
};

const findUnconditionalReturnStatement = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
): EsTreeNode | null => {
  let expressionRoot = findTransparentExpressionRoot(expression);
  while (
    isNodeOfType(expressionRoot.parent, "SequenceExpression") &&
    expressionRoot.parent.expressions.at(-1) === expressionRoot
  ) {
    expressionRoot = findTransparentExpressionRoot(expressionRoot.parent);
  }
  const returnStatement = expressionRoot.parent;
  return isNodeOfType(returnStatement, "ReturnStatement") &&
    returnStatement.argument === expressionRoot &&
    findEnclosingFunction(returnStatement) === ownerFunction
    ? returnStatement
    : null;
};

const doesResourceResultEscape = (
  resourceNode: EsTreeNode,
  allowReturnedResourceEscape: boolean,
  allowConciseReturnEscape: boolean,
  context: RuleContext,
): boolean => {
  if (!allowReturnedResourceEscape) return false;
  let currentNode = resourceNode;
  let parentNode = currentNode.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "ReturnStatement") && parentNode.argument === currentNode) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "ArrowFunctionExpression") &&
      parentNode.body === currentNode &&
      allowConciseReturnEscape
    ) {
      return true;
    }
    if (
      isNodeOfType(parentNode, "ChainExpression") ||
      isNodeOfType(parentNode, "TSAsExpression") ||
      isNodeOfType(parentNode, "TSNonNullExpression")
    ) {
      currentNode = parentNode;
      parentNode = currentNode.parent;
      continue;
    }
    if (
      (isNodeOfType(parentNode, "ConditionalExpression") &&
        (parentNode.consequent === currentNode || parentNode.alternate === currentNode)) ||
      (isNodeOfType(parentNode, "LogicalExpression") &&
        (parentNode.right === currentNode ||
          (parentNode.left === currentNode && parentNode.operator !== "&&")))
    ) {
      currentNode = parentNode;
      parentNode = currentNode.parent;
      continue;
    }
    if (
      isNodeOfType(parentNode, "VariableDeclarator") &&
      parentNode.init === currentNode &&
      isNodeOfType(parentNode.id, "Identifier") &&
      isNodeOfType(parentNode.parent, "VariableDeclaration") &&
      parentNode.parent.kind === "const"
    ) {
      const ownerFunction = findEnclosingFunction(resourceNode);
      const resourceSymbol = context.scopes.symbolFor(parentNode.id);
      if (!ownerFunction || !resourceSymbol) return false;
      const matchingReturnStatements = resourceSymbol.references.flatMap((reference) => {
        if (reference.flag !== "read") return [];
        const returnStatement = findUnconditionalReturnStatement(
          reference.identifier,
          ownerFunction,
        );
        return returnStatement ? [returnStatement] : [];
      });
      return doMatchingNodesCoverEveryPathAfterUsage(
        resourceNode,
        matchingReturnStatements,
        context,
      );
    }
    return false;
  }
  return false;
};

const findRetainedFunctionLeak = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
  options?: RetainedFunctionLeakOptions,
): SubscribeLikeUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const body = retainedFunction.body;
  if (!body) return null;

  // A registration returned directly from the function escapes to the
  // caller, which owns the handle.
  let leak: SubscribeLikeUsage | null = null;
  const allowReturnedResourceEscape =
    options?.allowReturnedResourceEscape !== false &&
    !retainedFunction.async &&
    !isInlineRetainedHandlerFunction(retainedFunction, context);
  const allowReturnedSocketEscape =
    allowReturnedResourceEscape && options?.requireCallableReturnedResource !== true;
  const isExternalStoreSubscribeFunction = isUseSyncExternalStoreSubscribeFunction(
    retainedFunction,
    context,
  );
  const hasReleaseForUsage = (usage: SubscribeLikeUsage): boolean =>
    isExternalStoreSubscribeFunction
      ? effectHasCleanupForUsage(retainedFunction, usage, context)
      : fileContainsReleaseForUsage(usage, context) ||
        hasGuaranteedRefOwnedUnmountCleanup(retainedFunction, usage, context);
  walkAst(body, (child: EsTreeNode) => {
    if (leak !== null) return false;
    if (isFunctionLike(child)) return false;
    if (!isNodeReachableWithinFunction(child, context)) return false;

    if (
      isSocketConstruction(child) &&
      !doesResourceResultEscape(child, allowReturnedSocketEscape, false, context)
    ) {
      const socketUsage: SubscribeLikeUsage = {
        kind: "socket",
        node: child,
        resourceName: isNodeOfType(child.callee, "Identifier") ? child.callee.name : "WebSocket",
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: null,
        eventKey: null,
        handlerKey: null,
      };
      if (!hasReleaseForUsage(socketUsage)) {
        leak = socketUsage;
        return false;
      }
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      (child.callee.name === "setInterval" ||
        (options?.includeOneShotTimers === true &&
          child.callee.name === "setTimeout" &&
          context.scopes.isGlobalReference(child.callee))) &&
      (options?.allowReturnedTimerEscape === false ||
        !doesResourceResultEscape(child, true, allowReturnedResourceEscape, context))
    ) {
      const timerUsage: SubscribeLikeUsage = {
        kind: "timer",
        node: child,
        resourceName: child.callee.name,
        handleKey: findAssignedResourceKey(child, context),
        receiverKey: null,
        registrationVerbName: child.callee.name,
        eventKey: null,
        handlerKey: null,
      };
      if (!hasReleaseForUsage(timerUsage)) {
        leak = timerUsage;
        return false;
      }
    }

    if (
      isSubscribeOrObserveCallExpression(child) &&
      (!doesResourceResultEscape(
        child,
        allowReturnedResourceEscape,
        allowReturnedResourceEscape,
        context,
      ) ||
        (options?.requireCallableReturnedResource === true &&
          !isCleanupReturningSubscribeLikeCallExpression(child)))
    ) {
      const registrationDetails = getCallRegistrationDetails(child, context);
      const registrationVerbName = registrationDetails.registrationVerbName ?? "subscribe";
      const subscriptionUsage: SubscribeLikeUsage = {
        kind: "subscribe",
        node: child,
        resourceName: registrationVerbName,
        handleKey: findAssignedResourceKey(child, context),
        ...registrationDetails,
      };
      if (
        !hasSelfReleasingListenerOptions(child, context) &&
        !hasReleaseForUsage(subscriptionUsage)
      ) {
        leak = subscriptionUsage;
      }
      return false;
    }
  });
  return leak;
};

const getAssignedReactRefCallbackDefinition = (
  functionNode: EsTreeNode,
  context: RuleContext,
): ReactRefCallbackDefinition | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (functionNode.generator) return null;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const assignment = functionRoot.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== functionRoot
  ) {
    return null;
  }
  const refSymbol = resolveReactRefSymbol(stripParenExpression(assignment.left), context.scopes);
  if (!refSymbol) return null;
  const componentFunction = findRenderPhaseComponentOrHook(assignment, context.scopes);
  if (
    !isFunctionLike(componentFunction) ||
    findEnclosingFunction(assignment) !== componentFunction ||
    findEnclosingFunction(refSymbol.bindingIdentifier) !== componentFunction ||
    !isNodeReachableWithinFunction(assignment, context)
  ) {
    return null;
  }
  return { assignmentNode: assignment, functionNode, refSymbol };
};

const getAssignedReactRefSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null =>
  getAssignedReactRefCallbackDefinition(functionNode, context)?.refSymbol ?? null;

const isExpressionReturnedFromFunction = (
  expression: EsTreeNode,
  ownerFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let expressionRoot = findTransparentExpressionRoot(expression);
  const bindingDeclarator = expressionRoot.parent;
  if (
    isNodeOfType(bindingDeclarator, "VariableDeclarator") &&
    bindingDeclarator.init === expressionRoot &&
    isNodeOfType(bindingDeclarator.id, "Identifier") &&
    isNodeOfType(bindingDeclarator.parent, "VariableDeclaration") &&
    bindingDeclarator.parent.kind === "const"
  ) {
    const resultSymbol = context.scopes.symbolFor(bindingDeclarator.id);
    if (!resultSymbol) return false;
    const matchingReturnStatements = resultSymbol.references.flatMap((reference) => {
      if (reference.flag !== "read") return [];
      const returnStatement = findUnconditionalReturnStatement(reference.identifier, ownerFunction);
      return returnStatement ? [returnStatement] : [];
    });
    return doMatchingNodesCoverEveryPathAfterUsage(expression, matchingReturnStatements, context);
  }
  while (true) {
    const container = expressionRoot.parent;
    if (
      isNodeOfType(container, "ConditionalExpression") &&
      (container.consequent === expressionRoot || container.alternate === expressionRoot)
    ) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    if (
      isNodeOfType(container, "SequenceExpression") &&
      container.expressions.at(-1) === expressionRoot
    ) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    if (isNodeOfType(container, "LogicalExpression") && container.right === expressionRoot) {
      expressionRoot = findTransparentExpressionRoot(container);
      continue;
    }
    break;
  }
  const returnStatement = expressionRoot.parent;
  return Boolean(
    (isNodeOfType(returnStatement, "ReturnStatement") &&
      returnStatement.argument === expressionRoot &&
      findEnclosingFunction(returnStatement) === ownerFunction) ||
    (isNodeOfType(ownerFunction, "ArrowFunctionExpression") &&
      ownerFunction.body === expressionRoot),
  );
};

const isReactRefCurrentCall = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  resolveReactRefSymbol(stripParenExpression(node.callee), context.scopes)?.id === refSymbol.id;

const collectAssignedReactRefCallbacks = (
  componentFunction: ReactRefCallbackDefinition["functionNode"],
  context: RuleContext,
): Map<number, ReactRefCallbackDefinition[]> => {
  const callbackDefinitionsByRefSymbolId = new Map<number, ReactRefCallbackDefinition[]>();
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (!isFunctionLike(child)) return;
    const callbackDefinition = getAssignedReactRefCallbackDefinition(child, context);
    if (callbackDefinition) {
      const existingDefinitions =
        callbackDefinitionsByRefSymbolId.get(callbackDefinition.refSymbol.id) ?? [];
      existingDefinitions.push(callbackDefinition);
      callbackDefinitionsByRefSymbolId.set(callbackDefinition.refSymbol.id, existingDefinitions);
    }
    return false;
  });
  for (const [refSymbolId, callbackDefinitions] of callbackDefinitionsByRefSymbolId) {
    const activeDefinitions = callbackDefinitions.filter(
      (callbackDefinition) =>
        !doMatchingNodesCoverEveryPathAfterUsage(
          callbackDefinition.assignmentNode,
          callbackDefinitions
            .filter((otherDefinition) => otherDefinition !== callbackDefinition)
            .map((otherDefinition) => otherDefinition.assignmentNode),
          context,
        ),
    );
    if (activeDefinitions.length === 0) {
      callbackDefinitionsByRefSymbolId.delete(refSymbolId);
    } else {
      callbackDefinitionsByRefSymbolId.set(refSymbolId, activeDefinitions);
    }
  }
  return callbackDefinitionsByRefSymbolId;
};

const collectUndominatedReactRefCalls = (
  ownerFunction: EsTreeNode,
  refSymbol: SymbolDescriptor,
  context: RuleContext,
): EsTreeNode[] => {
  if (!isFunctionLike(ownerFunction)) return [];
  const refWrites: EsTreeNode[] = [];
  const refCalls: EsTreeNode[] = [];
  walkAst(ownerFunction.body, (child: EsTreeNode) => {
    if (child !== ownerFunction.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeReachableWithinFunction(child, context) &&
      resolveReactRefSymbol(stripParenExpression(child.left), context.scopes)?.id === refSymbol.id
    ) {
      refWrites.push(child);
    }
    if (
      isReactRefCurrentCall(child, refSymbol, context) &&
      isNodeReachableWithinFunction(child, context)
    ) {
      refCalls.push(child);
    }
  });
  return refCalls.filter(
    (refCall) =>
      !doMatchingNodesCoverEveryPathBeforeUsage(refCall, refWrites, ownerFunction, context),
  );
};

const mergeReactRefEffectUsage = (
  usageByRefSymbolId: Map<number, ReactRefEffectUsage>,
  refSymbolId: number,
  doesEffectOwnResult: boolean,
): boolean => {
  const existingUsage = usageByRefSymbolId.get(refSymbolId);
  if (!existingUsage) {
    usageByRefSymbolId.set(refSymbolId, {
      doesEffectOwnEveryResult: doesEffectOwnResult,
    });
    return true;
  }
  if (!existingUsage.doesEffectOwnEveryResult || doesEffectOwnResult) return false;
  existingUsage.doesEffectOwnEveryResult = false;
  return true;
};

const collectReactRefEffectAnalysis = (
  componentFunction: ReactRefCallbackDefinition["functionNode"],
  context: RuleContext,
): ReactRefEffectAnalysis => {
  let analysisByComponent = REACT_REF_EFFECT_ANALYSIS_CACHE.get(context);
  if (!analysisByComponent) {
    analysisByComponent = new WeakMap();
    REACT_REF_EFFECT_ANALYSIS_CACHE.set(context, analysisByComponent);
  }
  const cachedAnalysis = analysisByComponent.get(componentFunction);
  if (cachedAnalysis) return cachedAnalysis;
  const callbackDefinitionsByRefSymbolId = collectAssignedReactRefCallbacks(
    componentFunction,
    context,
  );
  const usageByRefSymbolId = new Map<number, ReactRefEffectUsage>();
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (child !== componentFunction.body && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactApiCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
      })
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (!isFunctionLike(effectCallback)) return;
    for (const callbackDefinitions of callbackDefinitionsByRefSymbolId.values()) {
      const refSymbol = callbackDefinitions[0]?.refSymbol;
      if (!refSymbol) continue;
      for (const refCall of collectUndominatedReactRefCalls(effectCallback, refSymbol, context)) {
        mergeReactRefEffectUsage(
          usageByRefSymbolId,
          refSymbol.id,
          !effectCallback.async &&
            isExpressionReturnedFromFunction(refCall, effectCallback, context),
        );
      }
    }
  });

  let didUsageChange = true;
  while (didUsageChange) {
    didUsageChange = false;
    for (const callbackDefinitions of callbackDefinitionsByRefSymbolId.values()) {
      const ownerRefSymbol = callbackDefinitions[0]?.refSymbol;
      if (!ownerRefSymbol) continue;
      const ownerUsage = usageByRefSymbolId.get(ownerRefSymbol.id);
      if (!ownerUsage) continue;
      for (const callbackDefinition of callbackDefinitions) {
        for (const targetDefinitions of callbackDefinitionsByRefSymbolId.values()) {
          const targetRefSymbol = targetDefinitions[0]?.refSymbol;
          if (!targetRefSymbol) continue;
          for (const refCall of collectUndominatedReactRefCalls(
            callbackDefinition.functionNode,
            targetRefSymbol,
            context,
          )) {
            const doesEffectOwnResult =
              ownerUsage.doesEffectOwnEveryResult &&
              !callbackDefinition.functionNode.async &&
              isExpressionReturnedFromFunction(refCall, callbackDefinition.functionNode, context);
            if (
              mergeReactRefEffectUsage(usageByRefSymbolId, targetRefSymbol.id, doesEffectOwnResult)
            ) {
              didUsageChange = true;
            }
          }
        }
      }
    }
  }
  const analysis = { callbackDefinitionsByRefSymbolId, usageByRefSymbolId };
  analysisByComponent.set(componentFunction, analysis);
  return analysis;
};

const getReactRefEffectUsage = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
): ReactRefEffectUsage | null => {
  if (!isFunctionLike(retainedFunction)) return null;
  const callbackDefinition = getAssignedReactRefCallbackDefinition(retainedFunction, context);
  const componentFunction = findRenderPhaseComponentOrHook(retainedFunction, context.scopes);
  if (!callbackDefinition || !isFunctionLike(componentFunction)) return null;
  const analysis = collectReactRefEffectAnalysis(componentFunction, context);
  const activeDefinitions = analysis.callbackDefinitionsByRefSymbolId.get(
    callbackDefinition.refSymbol.id,
  );
  if (
    !activeDefinitions?.some(
      (activeDefinition) => activeDefinition.functionNode === retainedFunction,
    )
  ) {
    return null;
  }
  return analysis.usageByRefSymbolId.get(callbackDefinition.refSymbol.id) ?? null;
};

const isReactRefCallbackCleanupOwnedByEffect = (
  retainedFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  usage: SubscribeLikeUsage,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(retainedFunction) ||
    retainedFunction.async ||
    getReactRefEffectUsage(retainedFunction, context)?.doesEffectOwnEveryResult !== true
  ) {
    return false;
  }
  if (!isNodeOfType(retainedFunction.body, "BlockStatement")) return false;
  const doesReturnedCleanupCallFunction = (returnedValue: EsTreeNode): boolean => {
    const returnedCleanupFunction = resolveRefOwnedCleanupFunction(
      getFinalSequenceExpressionValue(returnedValue),
      context,
    );
    if (!returnedCleanupFunction) return false;
    if (returnedCleanupFunction === cleanupFunction) return true;
    if (!isFunctionLike(returnedCleanupFunction)) return false;
    const matchingCalls: EsTreeNode[] = [];
    walkAst(returnedCleanupFunction.body, (child: EsTreeNode) => {
      if (child !== returnedCleanupFunction.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        resolveRefOwnedCleanupFunction(child.callee, context) === cleanupFunction
      ) {
        matchingCalls.push(child);
      }
    });
    return doNodesCoverEveryPathFromFunctionEntry(returnedCleanupFunction, matchingCalls, context);
  };
  const matchingReturns: EsTreeNode[] = [];
  walkInsideStatementBlocks(retainedFunction.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      doesReturnedCleanupCallFunction(child.argument)
    ) {
      matchingReturns.push(child);
    }
  });
  return doMatchingNodesCoverEveryPathAfterUsage(usage.node, matchingReturns, context);
};

const isCleanupFunctionReferencedByReturn = (
  ownerFunction: EsTreeNode,
  cleanupFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(ownerFunction) || !isNodeOfType(ownerFunction.body, "BlockStatement")) {
    return false;
  }
  let isReferencedByReturn = false;
  walkInsideStatementBlocks(ownerFunction.body, (child: EsTreeNode) => {
    if (isReferencedByReturn || !isNodeOfType(child, "ReturnStatement") || !child.argument) {
      return;
    }
    walkAst(child.argument, (returnedChild: EsTreeNode) => {
      if (resolveRefOwnedCleanupFunction(returnedChild, context) !== cleanupFunction) return;
      isReferencedByReturn = true;
      return false;
    });
  });
  return isReferencedByReturn;
};

const isRetainedComponentScopeFunction = (functionNode: EsTreeNode): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return enclosingComponentOrHookName(functionNode) !== null;
  }
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression")
  ) {
    return false;
  }
  // Only named component-scope bindings (`const onScroll = () => {...}`);
  // inline callback arguments are attributed to whatever consumes them.
  if (!isNodeOfType(functionNode.parent, "VariableDeclarator")) return false;
  return enclosingComponentOrHookName(functionNode) !== null;
};

const isDirectJsxEventHandlerValue = (expression: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const expressionContainer = expressionRoot.parent;
  return (
    isNodeOfType(expressionContainer, "JSXExpressionContainer") &&
    expressionContainer.expression === expressionRoot &&
    isEventHandlerAttribute(expressionContainer.parent)
  );
};

const isInlineRetainedHandlerFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const callbackCall = functionRoot.parent;
  if (
    isNodeOfType(callbackCall, "CallExpression") &&
    callbackCall.arguments?.[0] === functionRoot &&
    isReactHookCall(callbackCall, "useCallback", context.scopes) &&
    isDirectJsxEventHandlerValue(callbackCall)
  ) {
    return true;
  }
  const parentNode = functionNode.parent;
  if (isDirectJsxEventHandlerValue(functionNode)) return true;
  if (
    !isNodeOfType(parentNode, "Property") ||
    parentNode.value !== functionNode ||
    parentNode.computed
  ) {
    return false;
  }
  const propertyName = getStaticPropertyKeyName(parentNode);
  if (!propertyName || !/^on[A-Z]/.test(propertyName)) return false;
  const objectExpression = parentNode.parent;
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  const objectParent = objectExpression.parent;
  const isPassedInline =
    (isNodeOfType(objectParent, "CallExpression") &&
      objectParent.arguments.some((argument) => argument === objectExpression)) ||
    isNodeOfType(objectParent, "JSXExpressionContainer");
  return isPassedInline && findRenderPhaseComponentOrHook(parentNode, context.scopes) !== null;
};

interface InvocationArgumentValue {
  isDefinitelyUndefined: boolean;
  truthiness: "falsy" | "truthy" | "unknown";
}

const readInvocationArgumentValue = (
  expression: EsTreeNode | null,
  context: RuleContext,
): InvocationArgumentValue => {
  if (!expression) return { isDefinitelyUndefined: true, truthiness: "falsy" };
  const target = stripParenExpression(expression);
  if (isNodeOfType(target, "Literal")) {
    return {
      isDefinitelyUndefined: false,
      truthiness: target.value ? "truthy" : "falsy",
    };
  }
  if (
    isNodeOfType(target, "Identifier") &&
    target.name === "undefined" &&
    context.scopes.isGlobalReference(target)
  ) {
    return { isDefinitelyUndefined: true, truthiness: "falsy" };
  }
  if (isNodeOfType(target, "UnaryExpression") && target.operator === "void") {
    return { isDefinitelyUndefined: true, truthiness: "falsy" };
  }
  if (
    isNodeOfType(target, "ArrayExpression") ||
    isNodeOfType(target, "ArrowFunctionExpression") ||
    isNodeOfType(target, "ClassExpression") ||
    isNodeOfType(target, "FunctionExpression") ||
    isNodeOfType(target, "NewExpression") ||
    isNodeOfType(target, "ObjectExpression")
  ) {
    return { isDefinitelyUndefined: false, truthiness: "truthy" };
  }
  return { isDefinitelyUndefined: false, truthiness: "unknown" };
};

const readInvocationConditionTruthiness = (
  expression: EsTreeNode,
  parameterValues: ReadonlyMap<number, InvocationArgumentValue>,
  context: RuleContext,
): InvocationArgumentValue["truthiness"] => {
  const target = stripParenExpression(expression);
  const atomicValue = readInvocationArgumentValue(target, context);
  if (atomicValue.truthiness !== "unknown") return atomicValue.truthiness;
  if (isNodeOfType(target, "Identifier")) {
    const symbol = context.scopes.symbolFor(target);
    return symbol ? (parameterValues.get(symbol.id)?.truthiness ?? "unknown") : "unknown";
  }
  if (isNodeOfType(target, "UnaryExpression") && target.operator === "!") {
    const argumentTruthiness = readInvocationConditionTruthiness(
      target.argument as EsTreeNode,
      parameterValues,
      context,
    );
    return argumentTruthiness === "truthy"
      ? "falsy"
      : argumentTruthiness === "falsy"
        ? "truthy"
        : "unknown";
  }
  if (isNodeOfType(target, "LogicalExpression")) {
    const leftTruthiness = readInvocationConditionTruthiness(
      target.left as EsTreeNode,
      parameterValues,
      context,
    );
    const rightTruthiness = readInvocationConditionTruthiness(
      target.right as EsTreeNode,
      parameterValues,
      context,
    );
    if (target.operator === "&&") {
      if (leftTruthiness === "falsy" || rightTruthiness === "falsy") return "falsy";
      return leftTruthiness === "truthy" && rightTruthiness === "truthy" ? "truthy" : "unknown";
    }
    if (target.operator === "||") {
      if (leftTruthiness === "truthy" || rightTruthiness === "truthy") return "truthy";
      return leftTruthiness === "falsy" && rightTruthiness === "falsy" ? "falsy" : "unknown";
    }
    return "unknown";
  }
  if (isNodeOfType(target, "ConditionalExpression")) {
    const testTruthiness = readInvocationConditionTruthiness(
      target.test as EsTreeNode,
      parameterValues,
      context,
    );
    if (testTruthiness === "truthy") {
      return readInvocationConditionTruthiness(
        target.consequent as EsTreeNode,
        parameterValues,
        context,
      );
    }
    if (testTruthiness === "falsy") {
      return readInvocationConditionTruthiness(
        target.alternate as EsTreeNode,
        parameterValues,
        context,
      );
    }
    const consequentTruthiness = readInvocationConditionTruthiness(
      target.consequent as EsTreeNode,
      parameterValues,
      context,
    );
    const alternateTruthiness = readInvocationConditionTruthiness(
      target.alternate as EsTreeNode,
      parameterValues,
      context,
    );
    return consequentTruthiness === alternateTruthiness ? consequentTruthiness : "unknown";
  }
  if (
    isNodeOfType(target, "CallExpression") &&
    isNodeOfType(target.callee, "Identifier") &&
    target.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(target.callee) &&
    target.arguments[0] &&
    isAstNode(target.arguments[0])
  ) {
    return readInvocationConditionTruthiness(
      target.arguments[0] as EsTreeNode,
      parameterValues,
      context,
    );
  }
  return "unknown";
};

const getInvocationParameterValues = (
  retainedFunction: EsTreeNode,
  invocation: EffectRetainedInvocation,
  leakNode: EsTreeNode,
  context: RuleContext,
): ReadonlyMap<number, InvocationArgumentValue> => {
  const parameterValues = new Map<number, InvocationArgumentValue>();
  if (!isFunctionLike(retainedFunction) || !invocation.isDirect) return parameterValues;
  for (const [parameterIndex, parameter] of retainedFunction.params.entries()) {
    const argument = invocation.call.arguments[parameterIndex];
    const argumentExpression = argument && isAstNode(argument) ? (argument as EsTreeNode) : null;
    let parameterIdentifier: EsTreeNode | null = null;
    let parameterValue = readInvocationArgumentValue(argumentExpression, context);
    if (isNodeOfType(parameter, "Identifier")) {
      parameterIdentifier = parameter;
    } else if (
      isNodeOfType(parameter, "AssignmentPattern") &&
      isNodeOfType(parameter.left, "Identifier")
    ) {
      parameterIdentifier = parameter.left;
      if (parameterValue.isDefinitelyUndefined) {
        parameterValue = readInvocationArgumentValue(parameter.right as EsTreeNode, context);
      }
    } else if (
      isNodeOfType(parameter, "RestElement") &&
      isNodeOfType(parameter.argument, "Identifier")
    ) {
      parameterIdentifier = parameter.argument;
      parameterValue = { isDefinitelyUndefined: false, truthiness: "truthy" };
    }
    if (!parameterIdentifier) continue;
    const parameterSymbol = context.scopes.symbolFor(parameterIdentifier);
    if (!parameterSymbol) continue;
    const isWrittenBeforeLeak = parameterSymbol.references.some(
      (reference) => reference.flag !== "read" && reference.identifier.range[0] < leakNode.range[0],
    );
    parameterValues.set(
      parameterSymbol.id,
      isWrittenBeforeLeak
        ? { isDefinitelyUndefined: false, truthiness: "unknown" }
        : parameterValue,
    );
  }
  return parameterValues;
};

const isLeakPathDisabledForInvocation = (
  retainedFunction: EsTreeNode,
  leakNode: EsTreeNode,
  invocation: EffectRetainedInvocation,
  context: RuleContext,
): boolean => {
  if (!invocation.isDirect) return false;
  const parameterValues = getInvocationParameterValues(
    retainedFunction,
    invocation,
    leakNode,
    context,
  );
  let child = leakNode;
  let ancestor = leakNode.parent ?? null;
  while (ancestor && ancestor !== retainedFunction) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const precedingStatement of ancestor.body.slice(0, childIndex)) {
        if (
          !isNodeOfType(precedingStatement, "IfStatement") ||
          precedingStatement.alternate ||
          !isEarlyExitStatement(precedingStatement.consequent)
        ) {
          continue;
        }
        const guardTruthiness = readInvocationConditionTruthiness(
          precedingStatement.test as EsTreeNode,
          parameterValues,
          context,
        );
        if (guardTruthiness === "truthy") return true;
      }
    }
    let requiredTruthiness: InvocationArgumentValue["truthiness"] | null = null;
    let condition: EsTreeNode | null = null;
    if (isNodeOfType(ancestor, "IfStatement")) {
      condition = ancestor.test as EsTreeNode;
      requiredTruthiness = ancestor.consequent === child ? "truthy" : "falsy";
    } else if (isNodeOfType(ancestor, "ConditionalExpression")) {
      condition = ancestor.test as EsTreeNode;
      requiredTruthiness = ancestor.consequent === child ? "truthy" : "falsy";
    } else if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.right === child &&
      ancestor.operator !== "??"
    ) {
      condition = ancestor.left as EsTreeNode;
      requiredTruthiness = ancestor.operator === "&&" ? "truthy" : "falsy";
    } else if (
      (isNodeOfType(ancestor, "WhileStatement") || isNodeOfType(ancestor, "DoWhileStatement")) &&
      ancestor.body === child
    ) {
      condition = ancestor.test as EsTreeNode;
      requiredTruthiness = "truthy";
    } else if (isNodeOfType(ancestor, "ForStatement") && ancestor.body === child && ancestor.test) {
      condition = ancestor.test as EsTreeNode;
      requiredTruthiness = "truthy";
    }
    if (condition && requiredTruthiness) {
      const conditionTruthiness = readInvocationConditionTruthiness(
        condition,
        parameterValues,
        context,
      );
      if (conditionTruthiness !== "unknown" && conditionTruthiness !== requiredTruthiness) {
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getEffectRetainedInvocations = (
  retainedFunction: EsTreeNode,
  context: RuleContext,
): EffectRetainedInvocation[] => {
  if (!isFunctionLike(retainedFunction)) return [];
  const componentFunction = findEnclosingFunction(retainedFunction);
  if (!componentFunction || !isFunctionLike(componentFunction)) return [];
  let invocationsByComponent = EFFECT_RETAINED_INVOCATIONS_CACHE.get(context);
  if (!invocationsByComponent) {
    invocationsByComponent = new WeakMap();
    EFFECT_RETAINED_INVOCATIONS_CACHE.set(context, invocationsByComponent);
  }
  const cachedInvocations = invocationsByComponent.get(componentFunction);
  if (cachedInvocations) return cachedInvocations.get(retainedFunction) ?? [];

  const invocationsByRetainedFunction = new Map<EsTreeNode, EffectRetainedInvocation[]>();
  const recordInvocation = (
    targetFunction: EsTreeNode | null,
    call: EsTreeNodeOfType<"CallExpression">,
    isDirect: boolean,
  ): void => {
    if (!targetFunction) return;
    const invocations = invocationsByRetainedFunction.get(targetFunction) ?? [];
    invocations.push({ call, isDirect });
    invocationsByRetainedFunction.set(targetFunction, invocations);
  };
  walkAst(componentFunction.body, (child: EsTreeNode) => {
    if (
      !isNodeOfType(child, "CallExpression") ||
      findEnclosingFunction(child) !== componentFunction ||
      !isReactHookCall(child, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (!effectCallback || !isFunctionLike(effectCallback)) return;
    walkAst(effectCallback.body, (effectChild: EsTreeNode) => {
      if (effectChild !== effectCallback.body && isFunctionLike(effectChild)) return false;
      if (
        !isNodeOfType(effectChild, "CallExpression") ||
        !isNodeReachableWithinFunction(effectChild, context)
      ) {
        return;
      }
      recordInvocation(
        resolveRefOwnedCleanupFunction(effectChild.callee, context),
        effectChild,
        true,
      );
      for (const argument of effectChild.arguments) {
        if (!isAstNode(argument) || !isSynchronousIteratorCallbackCall(effectChild, argument)) {
          continue;
        }
        recordInvocation(resolveRefOwnedCleanupFunction(argument, context), effectChild, false);
      }
    });
  });
  invocationsByComponent.set(componentFunction, invocationsByRetainedFunction);
  return invocationsByRetainedFunction.get(retainedFunction) ?? [];
};

export const effectNeedsCleanup = defineRule({
  id: "effect-needs-cleanup",
  title: "Effect subscription or timer never cleaned up",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Return a cleanup function that stops the subscription or timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` or `clearTimeout(id)` for timers, `return () => observer.disconnect()` for observers, `return () => socket.close()` for connections, or `return unsubscribe` if the subscribe call already gave you one.",
  create: (context: RuleContext) => {
    const reportRetainedLeak = (retainedFunction: EsTreeNode): void => {
      const refEffectUsage = getReactRefEffectUsage(retainedFunction, context);
      if (!refEffectUsage && !isPotentiallyReachableFunction(retainedFunction, context)) {
        return;
      }
      const effectInvocations = getEffectRetainedInvocations(retainedFunction, context);
      const isEffectInvoked = effectInvocations.length > 0;
      const leak = findRetainedFunctionLeak(
        retainedFunction,
        context,
        refEffectUsage
          ? {
              allowReturnedResourceEscape: refEffectUsage.doesEffectOwnEveryResult,
              allowReturnedTimerEscape: false,
              includeOneShotTimers: true,
              requireCallableReturnedResource: true,
            }
          : isEffectInvoked
            ? {
                allowReturnedTimerEscape: false,
                includeOneShotTimers: true,
              }
            : undefined,
      );
      if (!leak) return;
      if (
        isEffectInvoked &&
        leak.resourceName === "setTimeout" &&
        (!isNodeReachableWithinFunction(leak.node, context) ||
          (isFunctionLike(retainedFunction) &&
            retainedFunction.params.length > 0 &&
            !context.cfg.isUnconditionalFromEntry(leak.node) &&
            effectInvocations.every((invocation) =>
              isLeakPathDisabledForInvocation(retainedFunction, leak.node, invocation, context),
            )))
      ) {
        return;
      }
      const resourceNoun = RESOURCE_NOUN_BY_KIND[leak.kind];
      context.report({
        node: leak.node,
        message: `\`${leak.resourceName}\` creates a ${resourceNoun} in a function that outlives the render, with no cleanup path. Store the handle and release it, or move this into a useEffect that returns cleanup, so it does not leak after unmount.`,
      });
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isReactHookCall(node, "useCallback", context.scopes)) {
          const retainedCallback = getEffectCallback(node);
          if (retainedCallback && !isInlineRetainedHandlerFunction(retainedCallback, context)) {
            reportRetainedLeak(retainedCallback);
          }
          return;
        }
        if (!isReactHookCall(node, CLEANUP_EFFECT_HOOK_NAMES, context.scopes)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const usages = removeSynchronouslyReleasedUsages(
          callback,
          findSubscribeLikeUsages(callback, context),
          context,
        );
        if (usages.length === 0) return;

        const firstUsage = findFirstUsageWithoutCleanup(callback, usages, context);
        if (!firstUsage) return;
        const resourceNoun = RESOURCE_NOUN_BY_KIND[firstUsage.kind];
        const hookName = getCalleeName(node) ?? "effect";
        context.report({
          node,
          message: `\`${firstUsage.resourceName}\` creates a ${resourceNoun} in ${hookName} without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.`,
        });
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (isRetainedComponentScopeFunction(node)) reportRetainedLeak(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context) ||
          getAssignedReactRefSymbol(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (
          isRetainedComponentScopeFunction(node) ||
          isInlineRetainedHandlerFunction(node, context) ||
          getAssignedReactRefSymbol(node, context)
        ) {
          reportRetainedLeak(node);
        }
      },
    };
  },
});
