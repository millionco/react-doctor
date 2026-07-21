import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "../../utils/do-nodes-cover-every-path-from-function-entry.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { BasicBlock } from "../../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const MESSAGE =
  "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.";

// Listener-registration methods that hand back a resource which must be
// explicitly removed on unmount. Sound: each has a matching removal API.
const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "global", "self"]);
const STABLE_GLOBAL_MEMBER_NAMES = new Set(["body", "documentElement", "visualViewport"]);
const MOUNT_LOCAL_RESOURCE_FACTORY_NAMES = new Set(["initPlaces", "places"]);
const COMPONENT_MUTATION_METHOD_NAMES = new Set(["forceUpdate", "setState"]);
const MOBX_REACT_MODULE = "mobx-react";
const DISPOSE_ON_UNMOUNT_NAME = "disposeOnUnmount";

interface ListenerMethodSignature {
  releaseMethodName: string;
  identityArgumentKinds: ReadonlyArray<"event" | "handler">;
  captureOptionsIndex?: number;
}

const MEDIA_QUERY_LISTENER_ARGUMENT_KINDS: ReadonlyArray<"event" | "handler"> = ["handler"];

const LISTENER_REGISTRATION_SIGNATURES = new Map<string, ListenerMethodSignature>([
  [
    "addEventListener",
    {
      releaseMethodName: "removeEventListener",
      identityArgumentKinds: ["event", "handler"],
      captureOptionsIndex: 2,
    },
  ],
  [
    "addListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  [
    "prependListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  [
    "prependOnceListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  ["on", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["once", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["subscribe", { releaseMethodName: "unsubscribe", identityArgumentKinds: ["handler"] }],
]);
const LISTENER_RELEASE_SIGNATURES = new Map<string, ListenerMethodSignature>([
  [
    "removeEventListener",
    {
      releaseMethodName: "removeEventListener",
      identityArgumentKinds: ["event", "handler"],
      captureOptionsIndex: 2,
    },
  ],
  [
    "removeListener",
    { releaseMethodName: "removeListener", identityArgumentKinds: ["event", "handler"] },
  ],
  ["off", { releaseMethodName: "off", identityArgumentKinds: ["event", "handler"] }],
  ["unsubscribe", { releaseMethodName: "unsubscribe", identityArgumentKinds: ["handler"] }],
]);
const EVENT_EMITTER_REGISTRATION_METHOD_NAMES = new Set([
  "addListener",
  "on",
  "once",
  "prependListener",
  "prependOnceListener",
]);
const EVENT_EMITTER_RELEASE_METHOD_NAMES = new Map<string, ReadonlyArray<string>>([
  ["addListener", ["removeListener", "off"]],
  ["on", ["off", "removeListener"]],
  ["once", ["off", "removeListener"]],
  ["prependListener", ["off", "removeListener"]],
  ["prependOnceListener", ["off", "removeListener"]],
]);
const REACT_NATIVE_SUBSCRIPTION_RECEIVER_NAMES = new Set([
  "AccessibilityInfo",
  "AppState",
  "Appearance",
  "BackHandler",
  "Dimensions",
  "Keyboard",
  "Linking",
  "NetInfo",
]);

interface MountHazard {
  isAcquiredAfterSuspension: boolean;
  node: EsTreeNodeOfType<"CallExpression">;
  releaseKeys: ReadonlyArray<string>;
  listenerIdentityKey: string | null;
  registrationCount: number;
}

interface InvocationSuspensionState {
  canInvokeAfterSuspension: boolean;
  canInvokeBeforeSuspension: boolean;
}

const isAfterAwaitInEnclosingFunction = (node: EsTreeNode, context: RuleContext): boolean => {
  const functionNode = findEnclosingFunction(node);
  if (!functionNode) return false;
  const earlierAwaitNodes: EsTreeNodeOfType<"AwaitExpression">[] = [];
  walkOwnFunctionScope(functionNode, (candidate) => {
    if (isNodeOfType(candidate, "AwaitExpression") && candidate.range[0] < node.range[0]) {
      earlierAwaitNodes.push(candidate);
    }
  });
  if (earlierAwaitNodes.length === 0) return false;
  const functionCfg = context.cfg?.cfgFor(functionNode);
  const targetBlock = functionCfg?.blockOf(node);
  if (!functionCfg || !targetBlock) return true;
  const reachableBlocksFromEntry = new Set([functionCfg.entry]);
  const pendingEntryBlocks = [functionCfg.entry];
  while (pendingEntryBlocks.length > 0) {
    const currentBlock = pendingEntryBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (reachableBlocksFromEntry.has(edge.to)) continue;
      reachableBlocksFromEntry.add(edge.to);
      pendingEntryBlocks.push(edge.to);
    }
  }
  let hasReachableEarlierAwait = false;
  for (const candidate of earlierAwaitNodes) {
    if (hasReachableEarlierAwait) break;
    const awaitBlock = functionCfg.blockOf(candidate);
    if (!awaitBlock || !reachableBlocksFromEntry.has(awaitBlock)) continue;
    if (awaitBlock === targetBlock) {
      hasReachableEarlierAwait = true;
      break;
    }
    const visitedBlocks = new Set([awaitBlock]);
    const pendingBlocks: BasicBlock[] = [awaitBlock];
    while (pendingBlocks.length > 0) {
      const currentBlock: BasicBlock | undefined = pendingBlocks.pop();
      if (!currentBlock) break;
      for (const edge of currentBlock.successors) {
        if (edge.to === targetBlock) {
          hasReachableEarlierAwait = true;
          break;
        }
        if (visitedBlocks.has(edge.to)) continue;
        visitedBlocks.add(edge.to);
        pendingBlocks.push(edge.to);
      }
    }
  }
  return hasReachableEarlierAwait;
};

const getBareCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  return isNodeOfType(callee, "Identifier") ? callee.name : null;
};

const isImportedMobxRunInActionCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const calleeName = getBareCalleeName(node);
  const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
  return Boolean(
    calleeName &&
    isNodeOfType(callee, "Identifier") &&
    scopes.symbolFor(callee)?.kind === "import" &&
    getImportedNameFromModule(node, calleeName, "mobx") === "runInAction",
  );
};

// Timers are registered either bare (`setInterval(...)`) or via the global
// object (`window.setInterval(...)`, the TS idiom for a `number` timer id).
const getTimerIdentifierAliasName = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  if (scopes.isGlobalReference(identifier)) return identifier.name;
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id !== symbol.bindingIdentifier
  ) {
    const property = symbol.bindingIdentifier.parent;
    const objectPattern = property?.parent;
    const source = declaration.init ? stripParenExpression(declaration.init) : null;
    if (
      isNodeOfType(property, "Property") &&
      isNodeOfType(objectPattern, "ObjectPattern") &&
      isNodeOfType(source, "Identifier") &&
      GLOBAL_OBJECT_NAMES.has(source.name) &&
      scopes.isGlobalReference(source)
    ) {
      return getStaticPropertyKeyName(property, { allowComputedString: true });
    }
    return null;
  }
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (isNodeOfType(initializer, "Identifier")) {
    return getTimerIdentifierAliasName(initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(initializer, "MemberExpression")) return null;
  const receiver = stripParenExpression(initializer.object);
  return isNodeOfType(receiver, "Identifier") &&
    GLOBAL_OBJECT_NAMES.has(receiver.name) &&
    scopes.isGlobalReference(receiver)
    ? getStaticPropertyName(initializer)
    : null;
};

const getTimerCalleeName = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  const bareName = getBareCalleeName(node);
  if (bareName && isNodeOfType(callee, "Identifier")) {
    return getTimerIdentifierAliasName(callee, scopes);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    !GLOBAL_OBJECT_NAMES.has(receiver.name) ||
    findVariableInitializer(receiver, receiver.name)
  ) {
    return null;
  }
  return getStaticPropertyName(callee);
};

const getClassMemberName = (member: EsTreeNode): string | null => {
  if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
    return "constructor";
  }
  return getStaticPropertyKeyName(member, { allowComputedString: true });
};

// A `setTimeout` is a hazard only when its callback actually mutates the
// component — `this.setState(...)`, `runInAction(...)`, or any direct
// `this.<action>(...)` call. A one-shot field write (`this.x = true`) or a
// ref/focus nudge (`this.inputRef.current?.focus()`) leaks nothing.
const classMemberFunction = (
  classBody: EsTreeNode | null,
  memberName: string,
  reference?: EsTreeNode,
): EsTreeNode | null => {
  if (!classBody || !isNodeOfType(classBody, "ClassBody")) return null;
  const matchingFunctions = classBody.body.flatMap((candidate) => {
    if (
      (!isNodeOfType(candidate, "MethodDefinition") &&
        !isNodeOfType(candidate, "PropertyDefinition")) ||
      getClassMemberName(candidate) !== memberName ||
      !candidate.value ||
      !isFunctionLike(candidate.value)
    ) {
      return [];
    }
    return [candidate.value];
  });
  const matchingFunction = matchingFunctions.at(-1);
  if (!matchingFunction) return null;
  let isReassigned = false;
  walkAst(classBody, (candidate) => {
    if (isReassigned || !isNodeOfType(candidate, "AssignmentExpression")) return;
    const target = stripParenExpression(candidate.left);
    if (
      isNodeOfType(target, "MemberExpression") &&
      isNodeOfType(stripParenExpression(target.object), "ThisExpression") &&
      getStaticPropertyName(target) === memberName &&
      (!reference || candidate.range[0] <= reference.range[0])
    ) {
      isReassigned = true;
      return false;
    }
  });
  return isReassigned ? null : matchingFunction;
};

const walkClassSynchronousFlow = (
  root: EsTreeNode,
  classBody: EsTreeNode | null,
  visitor: (node: EsTreeNode) => void | false,
  visitedFunctions = new Set<EsTreeNode>(),
): void => {
  if (visitedFunctions.has(root)) return;
  visitedFunctions.add(root);
  walkSynchronousCallbackFlow(root, (node) => {
    const result = visitor(node);
    if (result === false || !isNodeOfType(node, "CallExpression")) return result;
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      return;
    }
    const memberName = getStaticPropertyName(callee);
    const memberFunction = memberName ? classMemberFunction(classBody, memberName, node) : null;
    if (memberFunction) {
      walkClassSynchronousFlow(memberFunction, classBody, visitor, visitedFunctions);
    }
  });
};

const collectSuspendedClassHelperNodes = (
  root: EsTreeNode,
  classBody: EsTreeNode | null,
  context: RuleContext,
): Set<EsTreeNode> => {
  const suspendedNodes = new Set<EsTreeNode>();
  const visitedFunctions = new Map<EsTreeNode, boolean>();
  const visitFlow = (flowRoot: EsTreeNode, isCalledAfterSuspension: boolean): void => {
    const previousSuspensionState = visitedFunctions.get(flowRoot);
    if (previousSuspensionState === true || previousSuspensionState === isCalledAfterSuspension) {
      return;
    }
    visitedFunctions.set(flowRoot, isCalledAfterSuspension);
    walkSynchronousCallbackFlow(flowRoot, (node) => {
      if (context.cfg && !isNodeReachableWithinFunction(node, context)) return false;
      if (isCalledAfterSuspension) suspendedNodes.add(node);
      if (!isNodeOfType(node, "CallExpression")) return;
      const callee = stripParenExpression(node.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
      ) {
        return;
      }
      const memberName = getStaticPropertyName(callee);
      const memberFunction = memberName ? classMemberFunction(classBody, memberName, node) : null;
      if (memberFunction) {
        visitFlow(
          memberFunction,
          isCalledAfterSuspension || isAfterAwaitInEnclosingFunction(node, context),
        );
      }
    });
  };
  visitFlow(root, false);
  return suspendedNodes;
};

const isEnclosingFunctionInvokedAfterSuspension = (
  node: EsTreeNode,
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const targetFunction = findEnclosingFunction(node);
  const mountFunction = findEnclosingFunction(mountBody);
  if (!targetFunction || !mountFunction || targetFunction === mountFunction) return false;
  const invocationStates = new Map<EsTreeNode, InvocationSuspensionState>();
  const activeFunctions = new Set<EsTreeNode>();
  const resolveInvocationState = (functionNode: EsTreeNode): InvocationSuspensionState => {
    if (functionNode === mountFunction) {
      return { canInvokeAfterSuspension: false, canInvokeBeforeSuspension: true };
    }
    const cachedState = invocationStates.get(functionNode);
    if (cachedState) return cachedState;
    if (activeFunctions.has(functionNode)) {
      return { canInvokeAfterSuspension: false, canInvokeBeforeSuspension: false };
    }
    activeFunctions.add(functionNode);
    const state: InvocationSuspensionState = {
      canInvokeAfterSuspension: false,
      canInvokeBeforeSuspension: false,
    };
    walkAst(classBody ?? mountBody, (candidate) => {
      if (!isNodeOfType(candidate, "CallExpression")) return;
      const callee = stripParenExpression(candidate.callee);
      const invokedFunction = isNodeOfType(callee, "Identifier")
        ? resolveExactLocalFunction(callee, context.scopes)
        : isNodeOfType(callee, "MemberExpression") &&
            isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
          ? classMemberFunction(classBody, getStaticPropertyName(callee) ?? "", candidate)
          : null;
      if (invokedFunction !== functionNode) return;
      const callerFunction = findEnclosingFunction(candidate);
      if (!callerFunction) return;
      const callerState = resolveInvocationState(callerFunction);
      if (callerState.canInvokeAfterSuspension) state.canInvokeAfterSuspension = true;
      if (!callerState.canInvokeBeforeSuspension) return;
      if (isAfterAwaitInEnclosingFunction(candidate, context)) {
        state.canInvokeAfterSuspension = true;
      } else {
        state.canInvokeBeforeSuspension = true;
      }
    });
    activeFunctions.delete(functionNode);
    invocationStates.set(functionNode, state);
    return state;
  };
  return resolveInvocationState(targetFunction).canInvokeAfterSuspension;
};

const functionSetsComponentState = (
  functionNode: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let mutates = false;
  walkSynchronousCallbackFlow(functionNode, (node: EsTreeNode) => {
    if (mutates) return false;
    if (isImportedMobxRunInActionCall(node, scopes)) {
      mutates = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      return;
    }
    const memberName = getStaticPropertyName(callee);
    if (memberName && COMPONENT_MUTATION_METHOD_NAMES.has(memberName)) {
      mutates = true;
      return false;
    }
    const nestedFunction = memberName ? classMemberFunction(classBody, memberName, node) : null;
    if (
      nestedFunction &&
      functionSetsComponentState(nestedFunction, classBody, scopes, visitedFunctions)
    ) {
      mutates = true;
      return false;
    }
  });
  return mutates;
};

const resolveTimeoutCallbackFunction = (
  callback: EsTreeNode,
  classBody: EsTreeNode | null,
  visitedExpressions = new Set<EsTreeNode>(),
): EsTreeNode | null => {
  const expression = stripParenExpression(callback);
  if (visitedExpressions.has(expression)) return null;
  visitedExpressions.add(expression);
  if (isFunctionLike(expression)) return expression;
  if (isNodeOfType(expression, "Identifier")) {
    const initializer = findVariableInitializer(expression, expression.name)?.initializer;
    return initializer
      ? resolveTimeoutCallbackFunction(initializer, classBody, visitedExpressions)
      : null;
  }
  const callee = isNodeOfType(expression, "CallExpression")
    ? stripParenExpression(expression.callee)
    : null;
  const boundTarget =
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "bind" &&
    expression.arguments?.[0] &&
    isNodeOfType(stripParenExpression(expression.arguments[0] as EsTreeNode), "ThisExpression")
      ? stripParenExpression(callee.object)
      : null;
  const methodReference = boundTarget ?? expression;
  const memberName =
    isNodeOfType(methodReference, "MemberExpression") &&
    isNodeOfType(stripParenExpression(methodReference.object), "ThisExpression")
      ? getStaticPropertyName(methodReference)
      : null;
  return memberName ? classMemberFunction(classBody, memberName, expression) : null;
};

const timeoutCallbackMutatesComponent = (
  callback: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  const resolvedCallback = resolveTimeoutCallbackFunction(callback, classBody);
  if (!isFunctionLike(resolvedCallback)) return false;
  const body = resolvedCallback.body;
  if (!body) return false;
  let mutates = false;
  walkSynchronousCallbackFlow(body, (node) => {
    if (mutates) return;
    if (isImportedMobxRunInActionCall(node, scopes)) {
      mutates = true;
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      // `this.focusInput()` — resolve the instance method; a ref/DOM nudge
      // that never calls setState/runInAction mutates nothing when it
      // fires after unmount.
      const memberName = getStaticPropertyName(callee);
      if (memberName && COMPONENT_MUTATION_METHOD_NAMES.has(memberName)) {
        mutates = true;
        return;
      }
      const memberFunction = memberName ? classMemberFunction(classBody, memberName, node) : null;
      if (memberFunction && !functionSetsComponentState(memberFunction, classBody, scopes)) return;
      mutates = true;
    }
  });
  return mutates;
};

// Variables declared inside the synchronous mount flow whose values never
// escape it (never assigned onto `this` or another object): a listener
// registered on such a locally constructed emitter dies with the component,
// so it needs no teardown.
const collectMountLocalReceiverSymbolIds = (
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): Set<number> => {
  const declaredSymbolIds = new Set<number>();
  const escapedSymbolIds = new Set<number>();
  walkClassSynchronousFlow(mountBody, classBody, (node) => {
    if (isNodeOfType(node, "VariableDeclarator")) {
      const initializer = node.init ? stripParenExpression(node.init as EsTreeNode) : null;
      const initializerCallee = isNodeOfType(initializer, "CallExpression")
        ? stripParenExpression(initializer.callee)
        : null;
      if (
        initializer &&
        (isNodeOfType(initializer, "NewExpression") ||
          isNodeOfType(initializer, "ObjectExpression") ||
          isNodeOfType(initializer, "ArrayExpression") ||
          (isNodeOfType(initializer, "CallExpression") &&
            isNodeOfType(initializerCallee, "Identifier") &&
            MOUNT_LOCAL_RESOURCE_FACTORY_NAMES.has(initializerCallee.name)))
      ) {
        const declaredNames = new Set<string>();
        collectPatternNames(node.id, declaredNames);
        const declarationScope = scopes.scopeFor(node);
        for (const declaredName of declaredNames) {
          const symbol = declarationScope.symbolsByName.get(declaredName);
          if (symbol) declaredSymbolIds.add(symbol.id);
        }
      } else if (isNodeOfType(initializer, "Identifier")) {
        const initializerSymbol = scopes.symbolFor(initializer);
        if (initializerSymbol && declaredSymbolIds.has(initializerSymbol.id)) {
          const declaredNames = new Set<string>();
          collectPatternNames(node.id, declaredNames);
          const declarationScope = scopes.scopeFor(node);
          for (const declaredName of declaredNames) {
            const symbol = declarationScope.symbolsByName.get(declaredName);
            if (symbol) declaredSymbolIds.add(symbol.id);
          }
        }
      }
    }
    if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
      const assignedValue = stripParenExpression(node.right);
      const assignedSymbol = isNodeOfType(assignedValue, "Identifier")
        ? scopes.symbolFor(assignedValue)
        : null;
      if (assignedSymbol) escapedSymbolIds.add(assignedSymbol.id);
    }
    if (isNodeOfType(node, "CallExpression")) {
      for (const argument of node.arguments ?? []) {
        const argumentExpression = stripParenExpression(argument as EsTreeNode);
        const argumentSymbol = isNodeOfType(argumentExpression, "Identifier")
          ? scopes.symbolFor(argumentExpression)
          : null;
        if (argumentSymbol && declaredSymbolIds.has(argumentSymbol.id)) {
          escapedSymbolIds.add(argumentSymbol.id);
        }
      }
    }
  });
  for (const escapedSymbolId of escapedSymbolIds) declaredSymbolIds.delete(escapedSymbolId);
  return declaredSymbolIds;
};

// `addEventListener` immediately paired with `removeEventListener` for the
// same event in the same mount body (passive-support detection) leaves
// nothing registered.
const getRootThisMemberName = (node: EsTreeNode): string | null => {
  let expression = stripParenExpression(node);
  while (isNodeOfType(expression, "MemberExpression")) {
    const receiver = stripParenExpression(expression.object);
    if (isNodeOfType(receiver, "ThisExpression")) return getStaticPropertyName(expression);
    expression = receiver;
  }
  return null;
};

const getEnclosingClassMember = (node: EsTreeNode, classBody: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current.parent !== classBody) current = current.parent;
  return current ?? null;
};

const isStableInstanceMember = (
  memberName: string,
  reference: EsTreeNode,
  classBody: EsTreeNode | null,
): boolean => {
  if (memberName === "props" || memberName === "state") return false;
  if (!isNodeOfType(classBody, "ClassBody")) return true;
  if (
    classBody.body.some(
      (member) =>
        isNodeOfType(member, "MethodDefinition") &&
        (member.kind === "get" || member.kind === "set") &&
        getClassMemberName(member) === memberName,
    )
  ) {
    return false;
  }
  const referenceMember = getEnclosingClassMember(reference, classBody);
  const referenceMemberName = referenceMember ? getClassMemberName(referenceMember) : null;
  let hasUnstableWrite = false;
  walkAst(classBody, (candidate) => {
    if (hasUnstableWrite) return false;
    const target = isNodeOfType(candidate, "AssignmentExpression")
      ? stripParenExpression(candidate.left)
      : isNodeOfType(candidate, "UpdateExpression")
        ? stripParenExpression(candidate.argument)
        : null;
    if (
      isNodeOfType(target, "MemberExpression") &&
      isNodeOfType(stripParenExpression(target.object), "ThisExpression") &&
      getStaticPropertyName(target) === memberName
    ) {
      const writeMember = getEnclosingClassMember(candidate, classBody);
      const writeMemberName = writeMember ? getClassMemberName(writeMember) : null;
      const isBeforeMountReference =
        referenceMemberName === "componentDidMount" &&
        writeMemberName === "componentDidMount" &&
        candidate.range[0] <= reference.range[0];
      const isBeforeConstructorReference =
        referenceMemberName === "constructor" &&
        writeMemberName === "constructor" &&
        candidate.range[0] <= reference.range[0];
      const isMountInitializationForUnmount =
        referenceMemberName === "componentWillUnmount" && writeMemberName === "componentDidMount";
      const isAfterUnmountReference =
        referenceMemberName === "componentWillUnmount" &&
        writeMemberName === "componentWillUnmount" &&
        candidate.range[0] > reference.range[0];
      const isUnmountWriteAfterAcquisition =
        (referenceMemberName === "constructor" || referenceMemberName === "componentDidMount") &&
        writeMemberName === "componentWillUnmount";
      if (
        !(writeMemberName === "constructor" && referenceMemberName !== "constructor") &&
        !isBeforeMountReference &&
        !isBeforeConstructorReference &&
        !isMountInitializationForUnmount &&
        !isAfterUnmountReference &&
        !isUnmountWriteAfterAcquisition
      ) {
        hasUnstableWrite = true;
        return false;
      }
    }
  });
  return !hasUnstableWrite;
};

const isUnconditionalInstanceAliasAssignment = (
  assignment: EsTreeNode,
  classBody: EsTreeNode | null,
): boolean => {
  if (!isNodeOfType(classBody, "ClassBody")) return false;
  let current = assignment.parent;
  while (current && current !== classBody) {
    if (isFunctionLike(current)) {
      return current.parent?.parent === classBody;
    }
    if (
      isNodeOfType(current, "IfStatement") ||
      isNodeOfType(current, "ConditionalExpression") ||
      isNodeOfType(current, "LogicalExpression") ||
      isNodeOfType(current, "SwitchStatement") ||
      isNodeOfType(current, "TryStatement") ||
      isNodeOfType(current, "CatchClause") ||
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return false;
    }
    current = current.parent;
  }
  return false;
};

const getStableInstanceAlias = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): EsTreeNode | null => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "const") return null;
  const assignments = symbol.references.flatMap((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    if (
      !isNodeOfType(parent, "AssignmentExpression") ||
      parent.right !== referenceRoot ||
      !isNodeOfType(parent.left, "MemberExpression") ||
      !isNodeOfType(stripParenExpression(parent.left.object), "ThisExpression") ||
      !isUnconditionalInstanceAliasAssignment(parent, classBody)
    ) {
      return [];
    }
    const memberName = getStaticPropertyName(parent.left);
    return memberName && isStableInstanceMember(memberName, parent.left, classBody) ? [parent] : [];
  });
  if (assignments.length !== 1) return null;
  const assignment = assignments[0];
  if (!assignment || !isNodeOfType(assignment, "AssignmentExpression")) return null;
  const declarationFunction = findEnclosingFunction(symbol.declarationNode);
  if (!declarationFunction || findEnclosingFunction(assignment) !== declarationFunction)
    return null;
  const intervalStart = Math.min(identifier.range[0], assignment.range[0]);
  const intervalEnd = Math.max(identifier.range[0], assignment.range[0]);
  let hasInterveningAwait = false;
  walkOwnFunctionScope(declarationFunction, (candidate) => {
    if (
      isNodeOfType(candidate, "AwaitExpression") &&
      candidate.range[0] > intervalStart &&
      candidate.range[0] < intervalEnd
    ) {
      hasInterveningAwait = true;
      return false;
    }
  });
  return hasInterveningAwait ? null : assignment.left;
};

const serializeLifecycleReference = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol) return expression.name;
    const instanceAlias = getStableInstanceAlias(expression, scopes, classBody);
    if (instanceAlias) {
      return serializeLifecycleReference(instanceAlias, scopes, classBody, visitedSymbolIds);
    }
    if (
      symbol.kind === "const" &&
      symbol.initializer &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier &&
      !visitedSymbolIds.has(symbol.id)
    ) {
      visitedSymbolIds.add(symbol.id);
      const initializer = stripParenExpression(symbol.initializer);
      if (
        isNodeOfType(initializer, "Identifier") ||
        isNodeOfType(initializer, "MemberExpression")
      ) {
        return serializeLifecycleReference(initializer, scopes, classBody, visitedSymbolIds);
      }
      return `${expression.name}#${symbol.id}`;
    }
    if (symbol.kind === "const") return `${expression.name}#${symbol.id}`;
    if (
      symbol.kind === "function" &&
      symbol.references.every((reference) => reference.flag === "read")
    ) {
      return `${expression.name}#${symbol.id}`;
    }
    return symbol.kind === "import" ? `${expression.name}#${symbol.id}` : null;
  }
  if (isNodeOfType(expression, "ThisExpression")) return "this";
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const rootMemberName = getRootThisMemberName(expression);
  if (!rootMemberName) {
    const receiver = stripParenExpression(expression.object);
    const propertyName = getStaticPropertyName(expression);
    if (
      !isNodeOfType(receiver, "Identifier") ||
      !scopes.isGlobalReference(receiver) ||
      !propertyName ||
      !STABLE_GLOBAL_MEMBER_NAMES.has(propertyName)
    ) {
      return null;
    }
    return `${receiver.name}.${propertyName}`;
  }
  if (
    rootMemberName &&
    (!isNodeOfType(stripParenExpression(expression.object), "ThisExpression") ||
      !isStableInstanceMember(rootMemberName, expression, classBody))
  ) {
    return null;
  }
  const receiverKey = serializeLifecycleReference(
    expression.object,
    scopes,
    classBody,
    visitedSymbolIds,
  );
  const propertyName = getStaticPropertyName(expression);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};

const serializeListenerIdentityPart = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return JSON.stringify(expression.value);
  return serializeLifecycleReference(expression, scopes, classBody);
};

const serializeLifecycleEventKey = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return `literal:${expression.value}`;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return `literal:${expression.quasis[0]?.value.cooked ?? ""}`;
  }
  const referenceKey = serializeLifecycleReference(expression, scopes, classBody);
  return referenceKey ? `reference:${referenceKey}` : null;
};

const opaqueCaptureOptionsKey = (options: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const expression = stripParenExpression(options);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    hasSymbolWriteBefore(symbol, expression, scopes) ||
    hasPossibleStaticPropertyWriteBefore(expression, "capture", expression, scopes)
  ) {
    return null;
  }
  const referenceKey = serializeReferenceKey({ node: expression, scopes });
  return referenceKey ? `options:${referenceKey}` : null;
};

const isStaticallyFalseCaptureValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return !expression.value;
  return (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    scopes.isGlobalReference(expression)
  );
};

const listenerIdentityKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  signature: ListenerMethodSignature,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  const effectiveSignature =
    call.arguments.length === 1 && (methodName === "addListener" || methodName === "removeListener")
      ? { ...signature, identityArgumentKinds: MEDIA_QUERY_LISTENER_ARGUMENT_KINDS }
      : signature;
  const maximumArgumentCount =
    effectiveSignature.captureOptionsIndex === undefined
      ? effectiveSignature.identityArgumentKinds.length
      : effectiveSignature.captureOptionsIndex + 1;
  if (
    call.arguments.length < effectiveSignature.identityArgumentKinds.length ||
    call.arguments.length > maximumArgumentCount
  ) {
    return null;
  }
  const receiverKey = serializeListenerIdentityPart(callee.object, scopes, classBody);
  if (!receiverKey) return null;
  const identityArgumentKeys: string[] = [];
  for (const [argumentIndex, argumentKind] of effectiveSignature.identityArgumentKinds.entries()) {
    const argument = call.arguments?.[argumentIndex];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
    const argumentKey =
      argumentKind === "event"
        ? serializeLifecycleEventKey(argument, scopes, classBody)
        : serializeListenerIdentityPart(argument, scopes, classBody);
    if (!argumentKey) return null;
    identityArgumentKeys.push(argumentKey);
  }
  const identityKey = `${receiverKey}|${identityArgumentKeys.join("|")}`;
  if (effectiveSignature.captureOptionsIndex === undefined) return identityKey;
  const options = call.arguments?.[effectiveSignature.captureOptionsIndex];
  if (options && isNodeOfType(options, "SpreadElement")) return null;
  let captureKey = "false";
  if (options) {
    const unwrappedOptions = stripParenExpression(options);
    if (isStaticallyFalseCaptureValue(unwrappedOptions, scopes)) {
      captureKey = "false";
    } else if (
      isNodeOfType(unwrappedOptions, "Literal") &&
      typeof unwrappedOptions.value === "boolean"
    ) {
      captureKey = String(unwrappedOptions.value);
    } else {
      const optionsObject = resolveStableOptionsObject(options, ["capture"], scopes);
      const opaqueOptionsKey = opaqueCaptureOptionsKey(options, scopes);
      if (!optionsObject) return opaqueOptionsKey ? `${identityKey}|${opaqueOptionsKey}` : null;
      if (
        optionsObject.properties.some(
          (property) =>
            !isNodeOfType(property, "Property") ||
            getStaticPropertyKeyName(property, { allowComputedString: true }) === null,
        )
      ) {
        return opaqueOptionsKey ? `${identityKey}|${opaqueOptionsKey}` : null;
      }
      const captureProperty = optionsObject.properties.find(
        (property) =>
          isNodeOfType(property, "Property") &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === "capture",
      );
      if (
        captureProperty &&
        isNodeOfType(captureProperty, "Property") &&
        isStaticallyFalseCaptureValue(captureProperty.value, scopes)
      ) {
        captureKey = "false";
      } else if (
        captureProperty &&
        isNodeOfType(captureProperty, "Property") &&
        isNodeOfType(captureProperty.value, "Literal") &&
        typeof captureProperty.value.value === "boolean"
      ) {
        captureKey = String(captureProperty.value.value);
      } else if (captureProperty) {
        return null;
      }
    }
  }
  return `${identityKey}|${captureKey}`;
};

const listenerReleaseKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  signature: ListenerMethodSignature,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const identityKey = listenerIdentityKey(call, signature, scopes, classBody);
  return identityKey ? `listener:${signature.releaseMethodName}:${identityKey}` : null;
};

const listenerRemoveAllKeys = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): ReadonlyArray<string> => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return [];
  const receiverKey = serializeLifecycleReference(callee.object, scopes, classBody);
  if (!receiverKey) return [];
  const keys = [`listener:removeAllListeners:${receiverKey}`];
  const eventArgument = call.arguments[0];
  if (!eventArgument || isNodeOfType(eventArgument, "SpreadElement")) return keys;
  const eventKey = serializeLifecycleEventKey(eventArgument, scopes, classBody);
  return eventKey ? [...keys, `listener:removeAllListeners:${receiverKey}|${eventKey}`] : keys;
};

const listenerAbortSignalReleaseKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const optionsArgument = call.arguments[2];
  if (!optionsArgument || isNodeOfType(optionsArgument, "SpreadElement")) return null;
  const optionsObject = resolveStableOptionsObject(optionsArgument, ["signal"], scopes);
  if (!optionsObject) return null;
  const signalProperty = optionsObject.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "signal",
  );
  if (!signalProperty || !isNodeOfType(signalProperty, "Property")) return null;
  const signal = stripParenExpression(signalProperty.value);
  if (!isNodeOfType(signal, "MemberExpression") || getStaticPropertyName(signal) !== "signal") {
    return null;
  }
  const controllerKey = serializeLifecycleReference(signal.object, scopes, classBody);
  return controllerKey ? `abort:${controllerKey}` : null;
};

const listenerRegistrationReleaseKeys = (
  call: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  signature: ListenerMethodSignature,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): ReadonlyArray<string> => {
  const releaseMethodNames = EVENT_EMITTER_RELEASE_METHOD_NAMES.get(methodName) ?? [
    signature.releaseMethodName,
  ];
  const identityKey = listenerIdentityKey(call, signature, scopes, classBody);
  const releaseKeys = identityKey
    ? releaseMethodNames.map((releaseMethodName) => `listener:${releaseMethodName}:${identityKey}`)
    : [];
  const abortReleaseKey =
    methodName === "addEventListener"
      ? listenerAbortSignalReleaseKey(call, scopes, classBody)
      : null;
  if (abortReleaseKey) releaseKeys.push(abortReleaseKey);
  if (!EVENT_EMITTER_REGISTRATION_METHOD_NAMES.has(methodName)) return releaseKeys;
  return [...releaseKeys, ...listenerRemoveAllKeys(call, scopes, classBody)];
};

const storedCallResultReferenceKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): string | null => {
  const expressionRoot = findTransparentExpressionRoot(call);
  const parent = expressionRoot.parent;
  const storageTarget =
    isNodeOfType(parent, "AssignmentExpression") && parent.right === expressionRoot
      ? parent.left
      : isNodeOfType(parent, "VariableDeclarator") && parent.init === expressionRoot
        ? parent.id
        : null;
  return storageTarget ? serializeLifecycleReference(storageTarget, scopes, classBody) : null;
};

const isProvenDisposeOnUnmountCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      scopes.symbolFor(callee)?.kind === "import" &&
      getImportedNameFromModule(call, callee.name, MOBX_REACT_MODULE) === DISPOSE_ON_UNMOUNT_NAME
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    getStaticPropertyName(callee) === DISPOSE_ON_UNMOUNT_NAME &&
    isNodeOfType(receiver, "Identifier") &&
    scopes.symbolFor(receiver)?.kind === "import" &&
    isNamespaceImportFromModule(call, receiver.name, MOBX_REACT_MODULE)
  );
};

const cleanupReleaseKeys = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  classBody: EsTreeNode | null,
): ReadonlyArray<string> => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    const signature = methodName ? LISTENER_RELEASE_SIGNATURES.get(methodName) : undefined;
    if (signature) {
      const releaseKey = listenerReleaseKey(call, signature, scopes, classBody);
      if (releaseKey) return [releaseKey];
    }
    if (methodName === "removeAllListeners" && call.arguments.length <= 1) {
      const allKeys = listenerRemoveAllKeys(call, scopes, classBody);
      return call.arguments.length === 0 ? allKeys.slice(0, 1) : allKeys.slice(1);
    }
    if (
      (methodName === "unsubscribe" || methodName === "remove") &&
      call.arguments.length === 0 &&
      !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      const receiverKey = serializeLifecycleReference(callee.object, scopes, classBody);
      return receiverKey ? [`returned:${methodName}:${receiverKey}`] : [];
    }
    if (methodName === "abort" && call.arguments.length === 0) {
      const receiverKey = serializeLifecycleReference(callee.object, scopes, classBody);
      return receiverKey ? [`abort:${receiverKey}`] : [];
    }
    if (call.arguments.length === 0) {
      const callableKey = serializeLifecycleReference(callee, scopes, classBody);
      return callableKey ? [`returned:call:${callableKey}`] : [];
    }
  }
  const timerCalleeName = getTimerCalleeName(call, scopes);
  const handleArgument = call.arguments?.[0];
  if (
    (timerCalleeName === "clearInterval" || timerCalleeName === "clearTimeout") &&
    handleArgument &&
    !isNodeOfType(handleArgument, "SpreadElement")
  ) {
    const handleKey = serializeLifecycleReference(handleArgument, scopes, classBody);
    return handleKey ? [`timer:${timerCalleeName}:${handleKey}`] : [];
  }
  return [];
};

const functionHasPotentialSynchronousThrow = (
  functionNode: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  beforeRangeStart: number,
  visitedFunctions = new Set<EsTreeNode>(),
): boolean => {
  if (visitedFunctions.has(functionNode)) return true;
  visitedFunctions.add(functionNode);
  let canThrow = false;
  walkSynchronousCallbackFlow(functionNode, (candidate) => {
    if (canThrow || candidate.range[0] >= beforeRangeStart) return;
    if (isNodeOfType(candidate, "ThrowStatement") || isNodeOfType(candidate, "NewExpression")) {
      canThrow = true;
      return false;
    }
    if (!isNodeOfType(candidate, "CallExpression")) return;
    if (cleanupReleaseKeys(candidate, scopes, classBody).length > 0) return;
    const callee = stripParenExpression(candidate.callee);
    if (isNodeOfType(callee, "MemberExpression")) {
      const receiver = stripParenExpression(callee.object);
      if (
        isNodeOfType(receiver, "Identifier") &&
        receiver.name === "console" &&
        scopes.isGlobalReference(receiver)
      ) {
        return;
      }
      if (isNodeOfType(receiver, "ThisExpression")) {
        const memberName = getStaticPropertyName(callee);
        const memberFunction = memberName
          ? classMemberFunction(classBody, memberName, candidate)
          : null;
        if (
          memberFunction &&
          !functionHasPotentialSynchronousThrow(
            memberFunction,
            classBody,
            scopes,
            Number.POSITIVE_INFINITY,
            new Set(visitedFunctions),
          )
        ) {
          return;
        }
      }
      canThrow = true;
      return false;
    }
    const localFunction = resolveExactLocalFunction(callee, scopes);
    if (
      localFunction &&
      !functionHasPotentialSynchronousThrow(
        localFunction,
        classBody,
        scopes,
        Number.POSITIVE_INFINITY,
        new Set(visitedFunctions),
      )
    ) {
      return;
    }
    canThrow = true;
    return false;
  });
  return canThrow;
};

const collectMobxDisposalReleaseCalls = (
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  context: RuleContext,
): Map<string, EsTreeNode[]> => {
  const releaseCallsByKey = new Map<string, EsTreeNode[]>();
  walkClassSynchronousFlow(mountBody, classBody, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const ownerArgument = candidate.arguments?.[0];
    const owner =
      ownerArgument && !isNodeOfType(ownerArgument, "SpreadElement")
        ? stripParenExpression(ownerArgument)
        : null;
    if (
      !isProvenDisposeOnUnmountCall(candidate, context.scopes) ||
      !isNodeOfType(owner, "ThisExpression")
    ) {
      return;
    }
    const cleanupArgument = candidate.arguments?.[1];
    if (!cleanupArgument || isNodeOfType(cleanupArgument, "SpreadElement")) return;
    const cleanupFunction = resolveTimeoutCallbackFunction(cleanupArgument, classBody);
    if (!isFunctionLike(cleanupFunction)) return;
    const cleanupCallsByKey = new Map<string, EsTreeNode[]>();
    walkClassSynchronousFlow(cleanupFunction, classBody, (cleanupCandidate) => {
      if (!isNodeOfType(cleanupCandidate, "CallExpression")) return;
      for (const releaseKey of cleanupReleaseKeys(cleanupCandidate, context.scopes, classBody)) {
        const cleanupCalls = cleanupCallsByKey.get(releaseKey) ?? [];
        cleanupCalls.push(cleanupCandidate);
        cleanupCallsByKey.set(releaseKey, cleanupCalls);
      }
    });
    for (const [releaseKey, cleanupCalls] of cleanupCallsByKey) {
      if (!doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, cleanupCalls, context)) continue;
      const disposalCalls = releaseCallsByKey.get(releaseKey) ?? [];
      disposalCalls.push(candidate);
      releaseCallsByKey.set(releaseKey, disposalCalls);
    }
  });
  return releaseCallsByKey;
};

const collectCleanupReleaseKeys = (
  cleanupFunction: EsTreeNode | null,
  classBody: EsTreeNode | null,
  context: RuleContext,
  visitedFunctions = new Set<EsTreeNode>(),
): Set<string> => {
  const releaseKeys = new Set<string>();
  if (
    !cleanupFunction ||
    !isFunctionLike(cleanupFunction) ||
    visitedFunctions.has(cleanupFunction)
  ) {
    return releaseKeys;
  }
  visitedFunctions.add(cleanupFunction);
  let firstAwaitStart: number | null = null;
  walkSynchronousCallbackFlow(cleanupFunction, (candidate) => {
    if (
      isNodeOfType(candidate, "AwaitExpression") &&
      findEnclosingFunction(candidate) === cleanupFunction &&
      (firstAwaitStart === null || candidate.range[0] < firstAwaitStart)
    ) {
      firstAwaitStart = candidate.range[0];
    }
  });
  const releaseCallsByKey = new Map<string, EsTreeNode[]>();
  walkClassSynchronousFlow(cleanupFunction, classBody, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    if (
      firstAwaitStart !== null &&
      findEnclosingFunction(candidate) === cleanupFunction &&
      candidate.range[0] > firstAwaitStart
    ) {
      return;
    }
    const hasThrowingPrelude = functionHasPotentialSynchronousThrow(
      cleanupFunction,
      classBody,
      context.scopes,
      candidate.range[0],
    );
    const callee = stripParenExpression(candidate.callee);
    if (isNodeOfType(callee, "Identifier")) {
      const localFunction = resolveExactLocalFunction(callee, context.scopes);
      const delegatedReleaseKeys = collectCleanupReleaseKeys(
        localFunction,
        classBody,
        context,
        visitedFunctions,
      );
      for (const releaseKey of hasThrowingPrelude ? [] : delegatedReleaseKeys) {
        const releaseCalls = releaseCallsByKey.get(releaseKey) ?? [];
        releaseCalls.push(candidate);
        releaseCallsByKey.set(releaseKey, releaseCalls);
      }
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
    ) {
      const memberName = getStaticPropertyName(callee);
      const memberFunction = memberName
        ? classMemberFunction(classBody, memberName, candidate)
        : null;
      const delegatedReleaseKeys = collectCleanupReleaseKeys(
        memberFunction,
        classBody,
        context,
        visitedFunctions,
      );
      for (const releaseKey of delegatedReleaseKeys) {
        const releaseCalls = releaseCallsByKey.get(releaseKey) ?? [];
        releaseCalls.push(candidate);
        releaseCallsByKey.set(releaseKey, releaseCalls);
      }
    }
    for (const releaseKey of hasThrowingPrelude
      ? []
      : cleanupReleaseKeys(candidate, context.scopes, classBody)) {
      const releaseCalls = releaseCallsByKey.get(releaseKey) ?? [];
      releaseCalls.push(candidate);
      releaseCallsByKey.set(releaseKey, releaseCalls);
    }
  });
  for (const [releaseKey, releaseCalls] of releaseCallsByKey) {
    if (doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, releaseCalls, context)) {
      releaseKeys.add(releaseKey);
    }
  }
  return releaseKeys;
};

const collectGuaranteedCleanupReleaseCounts = (
  cleanupFunction: EsTreeNode | null,
  classBody: EsTreeNode | null,
  context: RuleContext,
  visitedFunctions = new Set<EsTreeNode>(),
): Map<string, number> => {
  const releaseCounts = new Map<string, number>();
  const directReleaseCallsByKey = new Map<string, EsTreeNode[]>();
  if (
    !cleanupFunction ||
    !isFunctionLike(cleanupFunction) ||
    visitedFunctions.has(cleanupFunction)
  ) {
    return releaseCounts;
  }
  visitedFunctions.add(cleanupFunction);
  let firstAwaitStart: number | null = null;
  walkSynchronousCallbackFlow(cleanupFunction, (candidate) => {
    if (
      isNodeOfType(candidate, "AwaitExpression") &&
      findEnclosingFunction(candidate) === cleanupFunction &&
      (firstAwaitStart === null || candidate.range[0] < firstAwaitStart)
    ) {
      firstAwaitStart = candidate.range[0];
    }
  });
  walkSynchronousCallbackFlow(cleanupFunction, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    if (
      firstAwaitStart !== null &&
      findEnclosingFunction(candidate) === cleanupFunction &&
      candidate.range[0] > firstAwaitStart
    ) {
      return;
    }
    if (
      functionHasPotentialSynchronousThrow(
        cleanupFunction,
        classBody,
        context.scopes,
        candidate.range[0],
      )
    ) {
      return;
    }
    for (const releaseKey of cleanupReleaseKeys(candidate, context.scopes, classBody)) {
      const directReleaseCalls = directReleaseCallsByKey.get(releaseKey) ?? [];
      directReleaseCalls.push(candidate);
      directReleaseCallsByKey.set(releaseKey, directReleaseCalls);
      if (doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, [candidate], context)) {
        releaseCounts.set(releaseKey, (releaseCounts.get(releaseKey) ?? 0) + 1);
      }
    }
    if (!doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, [candidate], context)) return;
    const callee = stripParenExpression(candidate.callee);
    const memberName =
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
        ? getStaticPropertyName(callee)
        : null;
    const delegatedFunction = memberName
      ? classMemberFunction(classBody, memberName, candidate)
      : isNodeOfType(callee, "Identifier")
        ? resolveExactLocalFunction(callee, context.scopes)
        : null;
    const delegatedReleaseCounts = collectGuaranteedCleanupReleaseCounts(
      delegatedFunction,
      classBody,
      context,
      new Set(visitedFunctions),
    );
    for (const [releaseKey, delegatedCount] of delegatedReleaseCounts) {
      releaseCounts.set(releaseKey, (releaseCounts.get(releaseKey) ?? 0) + delegatedCount);
    }
  });
  for (const [releaseKey, directReleaseCalls] of directReleaseCallsByKey) {
    if (!doNodesCoverEveryPathFromFunctionEntry(cleanupFunction, directReleaseCalls, context)) {
      continue;
    }
    let guaranteedBranchCount = 1;
    if (
      [...directReleaseCalls.keys()].every((omittedIndex) =>
        doNodesCoverEveryPathFromFunctionEntry(
          cleanupFunction,
          directReleaseCalls.filter(
            (directReleaseCall) => directReleaseCall !== directReleaseCalls[omittedIndex],
          ),
          context,
        ),
      )
    ) {
      guaranteedBranchCount += 1;
    }
    releaseCounts.set(
      releaseKey,
      Math.max(releaseCounts.get(releaseKey) ?? 0, guaranteedBranchCount),
    );
  }
  return releaseCounts;
};

const collectSynchronouslyRemovedListeners = (
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
): Map<string, EsTreeNode[]> => {
  const removedListeners = new Map<string, EsTreeNode[]>();
  walkClassSynchronousFlow(mountBody, classBody, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    for (const releaseKey of cleanupReleaseKeys(node, scopes, classBody)) {
      const removalCalls = removedListeners.get(releaseKey) ?? [];
      removalCalls.push(node);
      removedListeners.set(releaseKey, removalCalls);
    }
  });
  return removedListeners;
};

const findEnclosingRepeatingLoop = (node: EsTreeNode, boundary?: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent;
  while (ancestor && ancestor !== boundary) {
    if (isFunctionLike(ancestor)) return null;
    if (
      isNodeOfType(ancestor, "ForStatement") ||
      isNodeOfType(ancestor, "ForInStatement") ||
      isNodeOfType(ancestor, "ForOfStatement") ||
      isNodeOfType(ancestor, "WhileStatement") ||
      isNodeOfType(ancestor, "DoWhileStatement")
    ) {
      return ancestor;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

const collectMountedListenerCounts = (
  mountBody: EsTreeNode,
  classBody: EsTreeNode | null,
  context: RuleContext,
): Map<string, number> => {
  const scopes = context.scopes;
  const listenerCalls = new Map<string, EsTreeNodeOfType<"CallExpression">[]>();
  walkClassSynchronousFlow(mountBody, classBody, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    if (context.cfg && !isNodeReachableWithinFunction(node, context)) return false;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    const signature = methodName ? LISTENER_REGISTRATION_SIGNATURES.get(methodName) : undefined;
    if (!signature) return;
    const identityKey = listenerIdentityKey(node, signature, scopes, classBody);
    if (!identityKey) return;
    const matchingCalls = listenerCalls.get(identityKey) ?? [];
    matchingCalls.push(node);
    listenerCalls.set(identityKey, matchingCalls);
  });
  const listenerCounts = new Map<string, number>();
  for (const [identityKey, matchingCalls] of listenerCalls) {
    const hasRepeatingRegistration = matchingCalls.some((call) =>
      Boolean(findEnclosingRepeatingLoop(call, mountBody)),
    );
    if (hasRepeatingRegistration) {
      listenerCounts.set(identityKey, Number.POSITIVE_INFINITY);
      continue;
    }
    const exclusiveCallGroups: EsTreeNode[][] = [];
    for (const call of matchingCalls) {
      const matchingGroup = exclusiveCallGroups.find((group) =>
        group.every((groupCall) =>
          areNodesOnExclusiveConditionalBranches(call, groupCall, mountBody),
        ),
      );
      if (matchingGroup) matchingGroup.push(call);
      else exclusiveCallGroups.push([call]);
    }
    listenerCounts.set(identityKey, exclusiveCallGroups.length);
  }
  return listenerCounts;
};

const isRefOwnedReceiver = (
  expression: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = scopes.symbolFor(receiver);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, receiver, scopes)
    ) {
      return false;
    }
    const initializer = findVariableInitializer(receiver, receiver.name)?.initializer;
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isRefOwnedReceiver(initializer, classBody, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(receiver, "MemberExpression")) {
    const propertyName = getStaticPropertyName(receiver);
    const owner = stripParenExpression(receiver.object);
    if (propertyName !== "current") {
      return isRefOwnedReceiver(owner, classBody, scopes, visitedSymbolIds);
    }
    if (!isNodeOfType(classBody, "ClassBody") || !isNodeOfType(owner, "MemberExpression")) {
      return false;
    }
    const refPropertyName = getStaticPropertyName(owner);
    const refOwner = stripParenExpression(owner.object);
    if (!refPropertyName || !isNodeOfType(refOwner, "ThisExpression")) return false;
    const refMember = classBody.body?.find(
      (member) => getClassMemberName(member) === refPropertyName,
    );
    if (
      !refMember ||
      !isNodeOfType(refMember, "PropertyDefinition") ||
      refMember.static ||
      !isNodeOfType(refMember.value, "CallExpression") ||
      !isReactApiCall(refMember.value, "createRef", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: false,
        resolveNamedAliases: true,
      })
    ) {
      return false;
    }
    let enclosingMember: EsTreeNode | null | undefined = receiver;
    while (enclosingMember && enclosingMember.parent !== classBody) {
      enclosingMember = enclosingMember.parent;
    }
    const enclosingBody = enclosingMember ? getMemberFunctionBody(enclosingMember) : null;
    let wasReassigned = false;
    if (enclosingBody) {
      walkSynchronousCallbackFlow(enclosingBody, (candidate) => {
        if (
          wasReassigned ||
          candidate.range[0] >= receiver.range[0] ||
          !isNodeOfType(candidate, "AssignmentExpression")
        ) {
          return;
        }
        const target = stripParenExpression(candidate.left);
        if (!isNodeOfType(target, "MemberExpression")) return;
        const targetOwner = stripParenExpression(target.object);
        if (
          isNodeOfType(targetOwner, "ThisExpression") &&
          getStaticPropertyName(target) === refPropertyName
        ) {
          wasReassigned = true;
        }
      });
    }
    return !wasReassigned;
  }
  return false;
};

const isD3SelectionRootedAtRefOwnedNode = (
  expression: EsTreeNode,
  classBody: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "Identifier")) {
    const symbol = scopes.symbolFor(receiver);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, receiver, scopes)
    ) {
      return false;
    }
    const initializer = findVariableInitializer(receiver, receiver.name)?.initializer;
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isD3SelectionRootedAtRefOwnedNode(initializer, classBody, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  const callee = stripParenExpression(receiver.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  const calleeReceiver = stripParenExpression(callee.object);
  if (
    (methodName === "select" || methodName === "selectAll") &&
    isNodeOfType(calleeReceiver, "Identifier") &&
    (isNamespaceImportFromModule(receiver, calleeReceiver.name, "d3") ||
      (calleeReceiver.name === "d3" && !scopes.symbolFor(calleeReceiver)))
  ) {
    const selectedNode = receiver.arguments?.[0];
    return Boolean(
      selectedNode &&
      !isNodeOfType(selectedNode, "SpreadElement") &&
      isRefOwnedReceiver(selectedNode, classBody, scopes),
    );
  }
  return isD3SelectionRootedAtRefOwnedNode(callee.object, classBody, scopes, visitedSymbolIds);
};

const isMountHazard = (
  node: EsTreeNode,
  localReceiverSymbolIds: Set<number>,
  removedListeners: Map<string, EsTreeNode[]>,
  mountedListenerCounts: Map<string, number>,
  classBody: EsTreeNode | null,
  context: RuleContext,
  isCalledAfterSuspension: boolean,
): MountHazard | null => {
  const scopes = context.scopes;
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  const methodName = isNodeOfType(callee, "MemberExpression")
    ? getStaticPropertyName(callee)
    : null;
  if (
    methodName &&
    LISTENER_REGISTRATION_SIGNATURES.has(methodName) &&
    isNodeOfType(callee, "MemberExpression")
  ) {
    const signature = LISTENER_REGISTRATION_SIGNATURES.get(methodName);
    const callArguments = node.arguments ?? [];
    const isFunctionFactoryOnce = methodName === "once" && callArguments.length < 2;
    let receiverBase = stripParenExpression(callee.object);
    const receiverIsRefOwnedNode = isRefOwnedReceiver(receiverBase, classBody, scopes);
    const receiverIsRefOwnedD3Selection = isD3SelectionRootedAtRefOwnedNode(
      receiverBase,
      classBody,
      scopes,
    );
    while (true) {
      receiverBase = stripParenExpression(receiverBase);
      if (isNodeOfType(receiverBase, "CallExpression")) {
        receiverBase = stripParenExpression(receiverBase.callee);
        continue;
      }
      if (isNodeOfType(receiverBase, "MemberExpression")) {
        receiverBase = stripParenExpression(receiverBase.object);
        continue;
      }
      break;
    }
    const receiverSymbol = isNodeOfType(receiverBase, "Identifier")
      ? scopes.symbolFor(receiverBase)
      : null;
    const isLocalReceiver = receiverSymbol ? localReceiverSymbolIds.has(receiverSymbol.id) : false;
    const listenerKey = signature ? listenerIdentityKey(node, signature, scopes, classBody) : null;
    const registrationReleaseKeys = signature
      ? listenerRegistrationReleaseKeys(node, methodName, signature, scopes, classBody)
      : [];
    const removalCalls = registrationReleaseKeys.flatMap(
      (releaseKey) => removedListeners.get(releaseKey) ?? [],
    );
    const removeAllCalls = registrationReleaseKeys
      .filter((releaseKey) => releaseKey.startsWith("listener:removeAllListeners:"))
      .flatMap((releaseKey) => removedListeners.get(releaseKey) ?? []);
    const guaranteedIndividualRemovalCount = removalCalls.filter((removalCall) =>
      doNodesCoverEveryPathAfterNode(node, [removalCall], context),
    ).length;
    const registrationLoop = findEnclosingRepeatingLoop(node);
    const hasPerIterationRemoval = Boolean(
      registrationLoop &&
      removalCalls.some(
        (removalCall) =>
          findEnclosingRepeatingLoop(removalCall) === registrationLoop &&
          doNodesCoverEveryPathAfterNode(node, [removalCall], context),
      ),
    );
    const registrationCount = listenerKey ? (mountedListenerCounts.get(listenerKey) ?? 1) : 1;
    const isSynchronouslyRemoved = Boolean(
      listenerKey &&
      (doNodesCoverEveryPathAfterNode(node, removeAllCalls, context) ||
        (doNodesCoverEveryPathAfterNode(node, removalCalls, context) &&
          (methodName === "addEventListener" ||
            hasPerIterationRemoval ||
            guaranteedIndividualRemovalCount >= registrationCount))),
    );
    const isSelfRemovingListener = isSynchronouslyRemoved;
    const isHazard =
      !isFunctionFactoryOnce &&
      !isLocalReceiver &&
      !isSelfRemovingListener &&
      !receiverIsRefOwnedNode &&
      !receiverIsRefOwnedD3Selection;
    if (!isHazard) return null;
    const returnedReferenceKey = storedCallResultReferenceKey(node, scopes, classBody);
    const originalReceiver = stripParenExpression(callee.object);
    const importedReactNativeReceiverName = isNodeOfType(originalReceiver, "Identifier")
      ? getImportedNameFromModule(node, originalReceiver.name, "react-native")
      : null;
    const isReactNativeReceiver =
      isNodeOfType(originalReceiver, "Identifier") &&
      ((importedReactNativeReceiverName !== null &&
        REACT_NATIVE_SUBSCRIPTION_RECEIVER_NAMES.has(importedReactNativeReceiverName)) ||
        (scopes.isGlobalReference(originalReceiver) &&
          REACT_NATIVE_SUBSCRIPTION_RECEIVER_NAMES.has(originalReceiver.name)));
    const isReactNativeSubscription =
      (methodName === "addEventListener" || methodName === "addListener") && isReactNativeReceiver;
    const returnedReleaseKeys =
      methodName === "subscribe" && returnedReferenceKey
        ? [`returned:unsubscribe:${returnedReferenceKey}`, `returned:call:${returnedReferenceKey}`]
        : isReactNativeSubscription && returnedReferenceKey
          ? [`returned:remove:${returnedReferenceKey}`]
          : [];
    return {
      isAcquiredAfterSuspension:
        isCalledAfterSuspension || isAfterAwaitInEnclosingFunction(node, context),
      node,
      listenerIdentityKey: EVENT_EMITTER_REGISTRATION_METHOD_NAMES.has(methodName)
        ? listenerKey
        : null,
      registrationCount: EVENT_EMITTER_REGISTRATION_METHOD_NAMES.has(methodName)
        ? registrationCount
        : 1,
      releaseKeys: signature
        ? [
            ...listenerRegistrationReleaseKeys(node, methodName, signature, scopes, classBody),
            ...returnedReleaseKeys,
          ]
        : returnedReleaseKeys,
    };
  }

  const timerCalleeName = getTimerCalleeName(node, scopes);
  if (timerCalleeName === "setInterval") {
    const handleKey = storedCallResultReferenceKey(node, scopes, classBody);
    return {
      isAcquiredAfterSuspension:
        isCalledAfterSuspension || isAfterAwaitInEnclosingFunction(node, context),
      node,
      listenerIdentityKey: null,
      registrationCount: 1,
      releaseKeys: handleKey ? [`timer:clearInterval:${handleKey}`] : [],
    };
  }
  if (timerCalleeName === "setTimeout" && node.arguments?.[0]) {
    if (!timeoutCallbackMutatesComponent(node.arguments[0], classBody, scopes)) return null;
    const handleKey = storedCallResultReferenceKey(node, scopes, classBody);
    return {
      isAcquiredAfterSuspension:
        isCalledAfterSuspension || isAfterAwaitInEnclosingFunction(node, context),
      node,
      listenerIdentityKey: null,
      registrationCount: 1,
      releaseKeys: handleKey ? [`timer:clearTimeout:${handleKey}`] : [],
    };
  }
  return null;
};

const getMemberFunction = (member: EsTreeNode): EsTreeNode | null => {
  const isRelevantMember =
    isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition");
  return isRelevantMember && isFunctionLike(member.value) ? member.value : null;
};

const getMemberFunctionBody = (member: EsTreeNode): EsTreeNode | null => {
  const memberFunction = getMemberFunction(member);
  return memberFunction && isFunctionLike(memberFunction) ? (memberFunction.body ?? null) : null;
};

// KNOWN ACCEPTED NOISE: an app-root class component that never unmounts
// (cboard's AppContainer, mounted once via a non-exact `<Route path="/">`
// under ReactDOM.render) registers intentionally app-lifetime listeners,
// yet stays flagged. The mount site lives in a DIFFERENT module
// (src/index.js), so no single-file signal proves root-ness — the
// component's own file only exports a connected class, and name/path
// heuristics ("App", `components/App/`) misfire on route-level screens
// and embeddable widgets that do unmount.
export const classComponentMissingComponentWillUnmountTeardown = defineRule({
  id: "class-component-missing-component-will-unmount-teardown",
  title: "Class component acquires a resource with no teardown",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  recommendation:
    "Release listeners and timers acquired in `componentDidMount`/`constructor` by adding a `componentWillUnmount` that removes them (or use MobX `disposeOnUnmount`).",
  create: (context: RuleContext) => ({
    ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
      const classNode = node.parent;
      if (!classNode || !isEs6Component(classNode)) return;

      const members = node.body ?? [];
      const componentWillUnmountMember = members.find(
        (member) => getClassMemberName(member) === "componentWillUnmount",
      );
      const componentWillUnmountReleaseKeys = collectCleanupReleaseKeys(
        componentWillUnmountMember ? getMemberFunction(componentWillUnmountMember) : null,
        node,
        context,
      );
      const componentWillUnmountReleaseCounts = collectGuaranteedCleanupReleaseCounts(
        componentWillUnmountMember ? getMemberFunction(componentWillUnmountMember) : null,
        node,
        context,
      );

      for (const member of members) {
        const memberName = getClassMemberName(member);
        if (memberName !== "constructor" && memberName !== "componentDidMount") continue;
        const body = getMemberFunctionBody(member);
        if (!body) continue;

        const localReceiverSymbolIds = collectMountLocalReceiverSymbolIds(
          body,
          node,
          context.scopes,
        );
        const removedListeners = collectSynchronouslyRemovedListeners(body, node, context.scopes);
        const mountedListenerCounts = collectMountedListenerCounts(body, node, context);
        const suspendedClassHelperNodes = collectSuspendedClassHelperNodes(body, node, context);
        const mountHazards: MountHazard[] = [];
        walkClassSynchronousFlow(body, node, (candidate) => {
          if (context.cfg && !isNodeReachableWithinFunction(candidate, context)) return false;
          const candidateHazard = isMountHazard(
            candidate,
            localReceiverSymbolIds,
            removedListeners,
            mountedListenerCounts,
            node,
            context,
            suspendedClassHelperNodes.has(candidate) ||
              isEnclosingFunctionInvokedAfterSuspension(candidate, body, node, context),
          );
          if (candidateHazard) mountHazards.push(candidateHazard);
        });
        if (mountHazards.length === 0) continue;
        const mobxDisposalReleaseCalls = collectMobxDisposalReleaseCalls(body, node, context);
        const undisposedHazard = mountHazards.find((mountHazard) => {
          if (mountHazard.isAcquiredAfterSuspension) return true;
          if (mountHazard.releaseKeys.length === 0) return true;
          if (
            mountHazard.releaseKeys.some((releaseKey) =>
              componentWillUnmountReleaseKeys.has(releaseKey),
            )
          ) {
            if (mountHazard.listenerIdentityKey && mountHazard.registrationCount > 1) {
              const hasRemoveAllCleanup = mountHazard.releaseKeys.some(
                (releaseKey) =>
                  releaseKey.startsWith("listener:removeAllListeners:") &&
                  componentWillUnmountReleaseKeys.has(releaseKey),
              );
              const matchingCleanupCount = mountHazard.releaseKeys.reduce(
                (cleanupCount, releaseKey) =>
                  releaseKey.startsWith("listener:removeAllListeners:")
                    ? cleanupCount
                    : cleanupCount + (componentWillUnmountReleaseCounts.get(releaseKey) ?? 0),
                0,
              );
              if (!hasRemoveAllCleanup && matchingCleanupCount < mountHazard.registrationCount) {
                return true;
              }
            }
            return false;
          }
          return !mountHazard.releaseKeys.some((releaseKey) => {
            const disposalCalls = mobxDisposalReleaseCalls.get(releaseKey) ?? [];
            return doNodesCoverEveryPathAfterNode(mountHazard.node, disposalCalls, context);
          });
        });
        if (undisposedHazard) {
          context.report({ node: undisposedHazard.node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
