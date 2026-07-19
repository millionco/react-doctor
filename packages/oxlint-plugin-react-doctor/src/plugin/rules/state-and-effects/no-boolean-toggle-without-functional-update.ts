import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findContainingBlock } from "../../utils/find-containing-block.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenPromiseExpression } from "../../utils/is-proven-promise-expression.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveConstIdentifierRootSymbol } from "../../utils/resolve-const-identifier-root-symbol.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import type { ReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { statementTerminates } from "../../utils/statement-terminates.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveEventListenerCapture } from "./utils/resolve-event-listener-capture.js";

const TIMER_CALLBACK_INDEX_BY_NAME = new Map([
  ["setTimeout", 0],
  ["setInterval", 0],
  ["setImmediate", 0],
  ["queueMicrotask", 0],
  ["requestAnimationFrame", 0],
  ["requestIdleCallback", 0],
]);

const TIMER_CLEANUP_NAME_BY_REGISTRATION_NAME = new Map([
  ["requestAnimationFrame", "cancelAnimationFrame"],
  ["requestIdleCallback", "cancelIdleCallback"],
  ["setImmediate", "clearImmediate"],
  ["setInterval", "clearInterval"],
  ["setTimeout", "clearTimeout"],
]);

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);

interface AwaitReachabilityProof {
  readonly node: EsTreeNode;
  readonly sourceBlockId: number;
  readonly reachableBlockIds: ReadonlySet<number>;
}

interface ReactEffectRegistration {
  readonly callback: EsTreeNode;
  readonly call: EsTreeNodeOfType<"CallExpression">;
}

const resolveFunctionExpression = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNode | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return unwrappedExpression;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(unwrappedExpression, context.scopes);
  if (!symbol) return null;
  if (isFunctionLike(symbol.declarationNode)) return symbol.declarationNode;
  return symbol.initializer && isFunctionLike(stripParenExpression(symbol.initializer))
    ? stripParenExpression(symbol.initializer)
    : null;
};

const isGlobalIdentifier = (expression: EsTreeNode, name: string, context: RuleContext): boolean =>
  isNodeOfType(expression, "Identifier") &&
  expression.name === name &&
  context.scopes.isGlobalReference(expression);

const isGlobalObjectIdentifier = (expression: EsTreeNode, context: RuleContext): boolean =>
  isNodeOfType(expression, "Identifier") &&
  (expression.name === "window" ||
    expression.name === "globalThis" ||
    expression.name === "self") &&
  context.scopes.isGlobalReference(expression);

const isProvenSynchronousThenable = (expression: EsTreeNode, context: RuleContext): boolean => {
  let current = stripParenExpression(expression);
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    current = stripParenExpression(symbol.initializer);
  }
  if (!isNodeOfType(current, "ObjectExpression")) return false;
  const thenProperty = current.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "then",
  );
  if (!isNodeOfType(thenProperty, "Property")) return false;
  const thenFunction = stripParenExpression(thenProperty.value);
  if (!isFunctionLike(thenFunction)) return false;
  const callbackParameter = thenFunction.params?.[0];
  if (!isNodeOfType(callbackParameter, "Identifier")) return false;
  const callbackSymbol = context.scopes.symbolFor(callbackParameter);
  return Boolean(
    callbackSymbol &&
    callbackSymbol.references.length > 0 &&
    callbackSymbol.references.every((reference) => {
      const call = reference.identifier.parent;
      return (
        context.cfg.enclosingFunction(reference.identifier) === thenFunction &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === reference.identifier
      );
    }),
  );
};

const reactEffectCallForFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const parent = functionNode.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === functionNode &&
    isReactApiCall(parent, EFFECT_HOOK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return parent;
  }
  const bindingIdentifier =
    isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id
      ? functionNode.id
      : isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === functionNode &&
          isNodeOfType(parent.id, "Identifier")
        ? parent.id
        : null;
  const symbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  for (const reference of symbol?.references ?? []) {
    const call = reference.identifier.parent;
    if (
      isNodeOfType(call, "CallExpression") &&
      call.arguments?.[0] === reference.identifier &&
      isReactApiCall(call, EFFECT_HOOK_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
        resolveNamedAliases: true,
      })
    ) {
      return call;
    }
  }
  return null;
};

const findEnclosingReactEffectRegistration = (
  node: EsTreeNode,
  context: RuleContext,
): ReactEffectRegistration | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current)) {
      const call = reactEffectCallForFunction(current, context);
      if (call) return { callback: current, call };
    }
    current = current.parent;
  }
  return null;
};

const registrationResultKey = (
  registrationCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  const parent = registrationCall.parent;
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== registrationCall ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return null;
  }
  return resolveExpressionKey(parent.id, context);
};

const collectDeferredFunctions = (
  programNode: EsTreeNodeOfType<"Program">,
  context: RuleContext,
  registrationCallsByCallback: Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>,
): ReadonlySet<EsTreeNode> => {
  const deferredFunctions = new Set<EsTreeNode>();
  const addDeferredFunction = (
    callback: EsTreeNode | null,
    registrationCall: EsTreeNodeOfType<"CallExpression">,
  ): void => {
    if (!callback) return;
    deferredFunctions.add(callback);
    const registrationCalls = registrationCallsByCallback.get(callback) ?? [];
    if (!registrationCalls.includes(registrationCall)) registrationCalls.push(registrationCall);
    registrationCallsByCallback.set(callback, registrationCalls);
  };
  walkAst(programNode, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (isNodeOfType(callee, "Identifier")) {
      const callbackIndex = TIMER_CALLBACK_INDEX_BY_NAME.get(callee.name);
      if (callbackIndex === undefined || !context.scopes.isGlobalReference(callee)) return;
      const callback = resolveFunctionExpression(child.arguments?.[callbackIndex], context);
      addDeferredFunction(callback, child);
      return;
    }
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    if (!methodName) return;
    const receiver = stripParenExpression(callee.object);
    if (
      TIMER_CALLBACK_INDEX_BY_NAME.has(methodName) &&
      isGlobalObjectIdentifier(receiver, context)
    ) {
      const callback = resolveFunctionExpression(
        child.arguments?.[TIMER_CALLBACK_INDEX_BY_NAME.get(methodName) ?? 0],
        context,
      );
      addDeferredFunction(callback, child);
      return;
    }
    if (
      (methodName === "then" || methodName === "catch" || methodName === "finally") &&
      (isProvenPromiseExpression(callee.object, context.scopes) ||
        !isProvenSynchronousThenable(callee.object, context))
    ) {
      const firstCallback = resolveFunctionExpression(child.arguments?.[0], context);
      const secondCallback = resolveFunctionExpression(child.arguments?.[1], context);
      addDeferredFunction(firstCallback, child);
      addDeferredFunction(secondCallback, child);
      return;
    }
    if (methodName === "addEventListener") {
      const callback = resolveFunctionExpression(child.arguments?.[1], context);
      addDeferredFunction(callback, child);
      return;
    }
    if (methodName === "subscribe") {
      const callback = resolveFunctionExpression(child.arguments?.[0], context);
      addDeferredFunction(callback, child);
      return;
    }
    if (methodName === "on" || methodName === "addListener" || methodName === "once") {
      const callback = resolveFunctionExpression(child.arguments?.[1], context);
      addDeferredFunction(callback, child);
    }
  });
  return deferredFunctions;
};

const collectAwaitReachabilityProofs = (
  functionNode: EsTreeNode,
  functionCfg: FunctionCfg,
): AwaitReachabilityProof[] => {
  const proofs: AwaitReachabilityProof[] = [];
  walkAst(functionNode, (child: EsTreeNode) => {
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AwaitExpression")) return;
    const sourceBlock = functionCfg.blockOf(child);
    if (!sourceBlock) return;
    const reachableBlockIds = new Set<number>();
    const pendingBlocks = sourceBlock.successors.map((edge) => edge.to);
    while (pendingBlocks.length > 0) {
      const currentBlock = pendingBlocks.pop();
      if (!currentBlock || reachableBlockIds.has(currentBlock.id)) continue;
      reachableBlockIds.add(currentBlock.id);
      pendingBlocks.push(...currentBlock.successors.map((edge) => edge.to));
    }
    proofs.push({ node: child, sourceBlockId: sourceBlock.id, reachableBlockIds });
  });
  return proofs;
};

const asyncFunctionHasAwaitBefore = (
  node: EsTreeNode,
  context: RuleContext,
  awaitProofsByFunction: WeakMap<EsTreeNode, AwaitReachabilityProof[]>,
): boolean => {
  const enclosingFunction = context.cfg.enclosingFunction(node);
  if (!enclosingFunction || !isFunctionLike(enclosingFunction) || !enclosingFunction.async) {
    return false;
  }
  const functionCfg = context.cfg.cfgFor(enclosingFunction);
  if (!functionCfg) return false;
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return false;
  const awaitProofs =
    awaitProofsByFunction.get(enclosingFunction) ??
    collectAwaitReachabilityProofs(enclosingFunction, functionCfg);
  awaitProofsByFunction.set(enclosingFunction, awaitProofs);
  return awaitProofs.some((proof) => {
    if (!nodesCanCoExecute(proof.node, node, context)) return false;
    if (proof.sourceBlockId === targetBlock.id) {
      return (proof.node.range?.[0] ?? 0) < (node.range?.[0] ?? 0);
    }
    return proof.reachableBlockIds.has(targetBlock.id);
  });
};

const isInsideDeferredFunction = (
  node: EsTreeNode,
  deferredFunctions: ReadonlySet<EsTreeNode>,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current) && deferredFunctions.has(current)) return true;
    current = current.parent;
  }
  return false;
};

const findEnclosingDeferredFunction = (
  node: EsTreeNode,
  deferredFunctions: ReadonlySet<EsTreeNode>,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current) && deferredFunctions.has(current)) return current;
    current = current.parent;
  }
  return null;
};

const callbackRegistrationCalls = (
  callback: EsTreeNode,
  registrationCallsByCallback: ReadonlyMap<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>,
): EsTreeNodeOfType<"CallExpression">[] => {
  return registrationCallsByCallback.get(callback) ?? [];
};

const isInsideReturnedCleanupFunction = (
  node: EsTreeNode,
  returnedCleanupFunctions: ReadonlySet<EsTreeNode>,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current)) return returnedCleanupFunctions.has(current);
    current = current.parent;
  }
  return false;
};

const cleanupCallsMethodOnKey = (
  effectCallback: EsTreeNode,
  methodName: string,
  receiverKey: string,
  returnedCleanupFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  let didFindCleanup = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (didFindCleanup) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isInsideReturnedCleanupFunction(child, returnedCleanupFunctions) ||
      !context.cfg.isUnconditionalFromEntry(child)
    ) {
      return;
    }
    const callee = stripParenExpression(child.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === methodName &&
      resolveExpressionKey(callee.object, context) === receiverKey
    ) {
      didFindCleanup = true;
      return false;
    }
  });
  return didFindCleanup;
};

const registrationHasCleanup = (
  registrationCall: EsTreeNodeOfType<"CallExpression">,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  const returnedCleanupFunctions = new Set(
    collectReturnedCleanupFunctions(effectCallback, context.scopes),
  );
  const callee = stripParenExpression(registrationCall.callee);
  const timerMethodName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
        isGlobalObjectIdentifier(stripParenExpression(callee.object), context)
      ? getStaticPropertyName(callee)
      : null;
  const clearMethodName = timerMethodName
    ? (TIMER_CLEANUP_NAME_BY_REGISTRATION_NAME.get(timerMethodName) ?? null)
    : null;
  if (clearMethodName) {
    const resultKey = registrationResultKey(registrationCall, context);
    if (!resultKey) return false;
    let didFindCleanup = false;
    walkAst(effectCallback, (child: EsTreeNode) => {
      if (didFindCleanup) return false;
      if (
        !isNodeOfType(child, "CallExpression") ||
        !isInsideReturnedCleanupFunction(child, returnedCleanupFunctions) ||
        !context.cfg.isUnconditionalFromEntry(child)
      ) {
        return;
      }
      const cleanupCallee = stripParenExpression(child.callee);
      const cleanupMethodName = isNodeOfType(cleanupCallee, "Identifier")
        ? isGlobalIdentifier(cleanupCallee, cleanupCallee.name, context)
          ? cleanupCallee.name
          : null
        : isNodeOfType(cleanupCallee, "MemberExpression") &&
            isGlobalObjectIdentifier(stripParenExpression(cleanupCallee.object), context)
          ? getStaticPropertyName(cleanupCallee)
          : null;
      if (
        cleanupMethodName === clearMethodName &&
        resolveExpressionKey(child.arguments?.[0], context) === resultKey
      ) {
        didFindCleanup = true;
        return false;
      }
    });
    return didFindCleanup;
  }
  if (isNodeOfType(callee, "Identifier")) return false;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (methodName === "subscribe") {
    const subscriptionKey = registrationResultKey(registrationCall, context);
    return Boolean(
      subscriptionKey &&
      cleanupCallsMethodOnKey(
        effectCallback,
        "unsubscribe",
        subscriptionKey,
        returnedCleanupFunctions,
        context,
      ),
    );
  }
  if (methodName === "addEventListener") {
    const receiverKey = resolveExpressionKey(callee.object, context);
    const eventKey = resolveExpressionKey(registrationCall.arguments?.[0], context);
    const callbackKey = resolveExpressionKey(registrationCall.arguments?.[1], context);
    const registrationCapture = resolveEventListenerCapture(registrationCall.arguments?.[2], {
      allowComputedString: true,
    });
    let didFindMatchingRemoval = false;
    if (receiverKey && eventKey && callbackKey) {
      walkAst(effectCallback, (child: EsTreeNode) => {
        if (didFindMatchingRemoval) return false;
        if (
          !isNodeOfType(child, "CallExpression") ||
          !isInsideReturnedCleanupFunction(child, returnedCleanupFunctions) ||
          !context.cfg.isUnconditionalFromEntry(child)
        ) {
          return;
        }
        const cleanupCallee = stripParenExpression(child.callee);
        if (
          isNodeOfType(cleanupCallee, "MemberExpression") &&
          getStaticPropertyName(cleanupCallee) === "removeEventListener" &&
          registrationCapture !== null &&
          resolveEventListenerCapture(child.arguments?.[2], { allowComputedString: true }) ===
            registrationCapture &&
          resolveExpressionKey(cleanupCallee.object, context) === receiverKey &&
          resolveExpressionKey(child.arguments?.[0], context) === eventKey &&
          resolveExpressionKey(child.arguments?.[1], context) === callbackKey
        ) {
          didFindMatchingRemoval = true;
          return false;
        }
      });
    }
    if (didFindMatchingRemoval) return true;
    const optionsArgument = registrationCall.arguments?.[2];
    if (!optionsArgument) return false;
    const options = stripParenExpression(optionsArgument);
    if (!isNodeOfType(options, "ObjectExpression")) return false;
    for (const property of options.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== "signal"
      ) {
        continue;
      }
      const signal = stripParenExpression(property.value);
      if (!isNodeOfType(signal, "MemberExpression") || getStaticPropertyName(signal) !== "signal") {
        continue;
      }
      const controllerKey = resolveExpressionKey(signal.object, context);
      if (
        controllerKey &&
        cleanupCallsMethodOnKey(
          effectCallback,
          "abort",
          controllerKey,
          returnedCleanupFunctions,
          context,
        )
      ) {
        return true;
      }
    }
  }
  return false;
};

const effectResubscribesWithCleanup = (
  node: EsTreeNode,
  stateSymbolId: number,
  deferredFunctions: ReadonlySet<EsTreeNode>,
  registrationCallsByCallback: ReadonlyMap<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>,
  context: RuleContext,
): boolean => {
  const deferredFunction = findEnclosingDeferredFunction(node, deferredFunctions);
  if (!deferredFunction) return false;
  const effectRegistration = findEnclosingReactEffectRegistration(deferredFunction, context);
  if (!effectRegistration) return false;
  const { callback: effectCallback, call: effectCall } = effectRegistration;
  const dependencyArray = stripParenExpression(effectCall.arguments?.[1]);
  if (!isNodeOfType(dependencyArray, "ArrayExpression")) return false;
  const hasStateDependency = dependencyArray.elements.some((element) => {
    if (!element || !isNodeOfType(stripParenExpression(element), "Identifier")) return false;
    return (
      resolveConstIdentifierRootSymbol(stripParenExpression(element), context.scopes)?.id ===
      stateSymbolId
    );
  });
  if (!hasStateDependency) return false;
  const registrationCalls = callbackRegistrationCalls(
    deferredFunction,
    registrationCallsByCallback,
  );
  return (
    registrationCalls.length > 0 &&
    registrationCalls.every(
      (registrationCall) =>
        context.cfg.enclosingFunction(registrationCall) === effectCallback &&
        registrationHasCleanup(registrationCall, effectCallback, context),
    )
  );
};

const hasPromiseCommandNegation = (
  node: EsTreeNode,
  stateSymbolId: number,
  deferredFunctions: ReadonlySet<EsTreeNode>,
  registrationCallsByCallback: ReadonlyMap<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>,
  context: RuleContext,
): boolean => {
  const deferredFunction = findEnclosingDeferredFunction(node, deferredFunctions);
  if (!deferredFunction) return false;
  const registrationCalls = callbackRegistrationCalls(
    deferredFunction,
    registrationCallsByCallback,
  );
  return (
    registrationCalls.length > 0 &&
    registrationCalls.every((thenCall) => {
      const callee = stripParenExpression(thenCall.callee);
      if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "then") {
        return false;
      }
      const commandCall = stripParenExpression(callee.object);
      if (!isNodeOfType(commandCall, "CallExpression")) return false;
      const commandCallee = stripParenExpression(commandCall.callee);
      if (!isNodeOfType(commandCallee, "MemberExpression")) return false;
      const commandName = getStaticPropertyName(commandCallee);
      if (!commandName || !/^set[A-Z]/.test(commandName) || commandCall.arguments.length !== 1) {
        return false;
      }
      const argument = commandCall.arguments[0];
      if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
      const expression = stripParenExpression(argument);
      return Boolean(
        isNodeOfType(expression, "UnaryExpression") &&
        expression.operator === "!" &&
        isNodeOfType(stripParenExpression(expression.argument), "Identifier") &&
        resolveConstIdentifierRootSymbol(stripParenExpression(expression.argument), context.scopes)
          ?.id === stateSymbolId,
      );
    })
  );
};

const refMemberIsFreshStateMirror = (
  refMember: EsTreeNodeOfType<"MemberExpression">,
  stateSymbolId: number,
  context: RuleContext,
): boolean => {
  const refIdentifier = stripParenExpression(refMember.object);
  if (!isNodeOfType(refIdentifier, "Identifier")) return false;
  const refSymbol = context.scopes.symbolFor(refIdentifier);
  const declarator = refSymbol?.declarationNode;
  if (
    !refSymbol ||
    refSymbol.kind !== "const" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useRef", context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return false;
  }
  const componentFunction = context.cfg.enclosingFunction(declarator);
  let latestMirrorAssignment: EsTreeNodeOfType<"AssignmentExpression"> | null = null;
  for (const reference of refSymbol.references) {
    const member = reference.identifier.parent;
    const assignment = member?.parent;
    if (
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      getStaticPropertyName(member) === "current" &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.left === member &&
      context.cfg.enclosingFunction(assignment) === componentFunction &&
      context.cfg.isUnconditionalFromEntry(assignment) &&
      (!latestMirrorAssignment ||
        (assignment.range?.[0] ?? 0) > (latestMirrorAssignment.range?.[0] ?? 0))
    ) {
      latestMirrorAssignment = assignment;
    }
  }
  if (!latestMirrorAssignment) return false;
  const assignedValue = stripParenExpression(latestMirrorAssignment.right);
  return Boolean(
    isNodeOfType(assignedValue, "Identifier") &&
    resolveConstIdentifierRootSymbol(assignedValue, context.scopes)?.id === stateSymbolId,
  );
};

const hasLatestRefEqualityGuard = (
  node: EsTreeNode,
  stateSymbolId: number,
  context: RuleContext,
  earlyGuardCandidatesByBlock: WeakMap<EsTreeNode, EsTreeNode[]>,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isNodeOfType(current, "IfStatement")) {
      let branchCursor: EsTreeNode | null | undefined = node;
      let isInsideConsequent = false;
      while (branchCursor && branchCursor !== current) {
        if (branchCursor === current.consequent) isInsideConsequent = true;
        branchCursor = branchCursor.parent;
      }
      if (!isInsideConsequent) {
        current = current.parent;
        continue;
      }
      const test = stripParenExpression(current.test);
      if (
        isNodeOfType(test, "BinaryExpression") &&
        (test.operator === "===" || test.operator === "==")
      ) {
        const operands = [stripParenExpression(test.left), stripParenExpression(test.right)];
        const stateOperand = operands.find(
          (operand) =>
            isNodeOfType(operand, "Identifier") &&
            resolveConstIdentifierRootSymbol(operand, context.scopes)?.id === stateSymbolId,
        );
        const refOperand = operands.find(
          (operand) =>
            isNodeOfType(operand, "MemberExpression") &&
            getStaticPropertyName(operand) === "current" &&
            isNodeOfType(stripParenExpression(operand.object), "Identifier"),
        );
        if (stateOperand && refOperand && isNodeOfType(refOperand, "MemberExpression")) {
          if (refMemberIsFreshStateMirror(refOperand, stateSymbolId, context)) return true;
        }
      }
    }
    current = current.parent;
  }
  const block = findContainingBlock(node);
  if (!block) return false;
  let containingStatement: EsTreeNode = node;
  while (containingStatement.parent && containingStatement.parent !== block) {
    containingStatement = containingStatement.parent;
  }
  let earlyGuardCandidates = earlyGuardCandidatesByBlock.get(block);
  if (!earlyGuardCandidates) {
    earlyGuardCandidates = block.body.filter(
      (statement) =>
        isNodeOfType(statement, "IfStatement") && statementTerminates(statement.consequent),
    );
    earlyGuardCandidatesByBlock.set(block, earlyGuardCandidates);
  }
  const containingStatementStart = containingStatement.range?.[0] ?? 0;
  for (const statement of earlyGuardCandidates) {
    if (!isNodeOfType(statement, "IfStatement")) continue;
    if ((statement.range?.[0] ?? 0) >= containingStatementStart) break;
    const test = stripParenExpression(statement.test);
    if (
      !isNodeOfType(test, "BinaryExpression") ||
      (test.operator !== "!==" && test.operator !== "!=")
    ) {
      continue;
    }
    const operands = [stripParenExpression(test.left), stripParenExpression(test.right)];
    const stateOperand = operands.find(
      (operand) =>
        isNodeOfType(operand, "Identifier") &&
        resolveConstIdentifierRootSymbol(operand, context.scopes)?.id === stateSymbolId,
    );
    const refOperand = operands.find(
      (operand) =>
        isNodeOfType(operand, "MemberExpression") && getStaticPropertyName(operand) === "current",
    );
    if (
      stateOperand &&
      refOperand &&
      isNodeOfType(refOperand, "MemberExpression") &&
      refMemberIsFreshStateMirror(refOperand, stateSymbolId, context)
    ) {
      return true;
    }
  }
  return false;
};

export const noBooleanToggleWithoutFunctionalUpdate = defineRule({
  id: "no-boolean-toggle-without-functional-update",
  title: "Boolean toggle reads a stale value",
  severity: "warn",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Toggle boolean state with the functional updater `setX(previous => !previous)` so deferred callbacks always read the latest committed value.",
  create: (context: RuleContext) => {
    let deferredFunctions: ReadonlySet<EsTreeNode> = new Set();
    const registrationCallsByCallback = new Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>();
    const awaitProofsByFunction = new WeakMap<EsTreeNode, AwaitReachabilityProof[]>();
    const useStatePairByCalleeSymbolId = new Map<number, ReactUseStatePair | null>();
    const earlyGuardCandidatesByBlock = new WeakMap<EsTreeNode, EsTreeNode[]>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        deferredFunctions = collectDeferredFunctions(node, context, registrationCallsByCallback);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "Identifier")) return;
        const argument = node.arguments?.[0] ? stripParenExpression(node.arguments[0]) : null;
        if (!argument || !isNodeOfType(argument, "UnaryExpression") || argument.operator !== "!") {
          return;
        }
        const operand = stripParenExpression(argument.argument);
        if (!isNodeOfType(operand, "Identifier")) return;
        const calleeSymbol = context.scopes.symbolFor(callee);
        const cachedPair = calleeSymbol
          ? useStatePairByCalleeSymbolId.get(calleeSymbol.id)
          : undefined;
        const pair =
          calleeSymbol && useStatePairByCalleeSymbolId.has(calleeSymbol.id)
            ? (cachedPair ?? null)
            : resolveReactUseStatePair(callee, context.scopes);
        if (calleeSymbol && cachedPair === undefined) {
          useStatePairByCalleeSymbolId.set(calleeSymbol.id, pair);
        }
        if (
          !pair ||
          !pair.stateSymbol ||
          resolveConstIdentifierRootSymbol(operand, context.scopes)?.id !== pair.stateSymbol.id
        ) {
          return;
        }
        if (
          !isInsideDeferredFunction(node, deferredFunctions) &&
          !asyncFunctionHasAwaitBefore(node, context, awaitProofsByFunction)
        ) {
          return;
        }
        if (
          effectResubscribesWithCleanup(
            node,
            pair.stateSymbol.id,
            deferredFunctions,
            registrationCallsByCallback,
            context,
          ) ||
          hasPromiseCommandNegation(
            node,
            pair.stateSymbol.id,
            deferredFunctions,
            registrationCallsByCallback,
            context,
          ) ||
          hasLatestRefEqualityGuard(node, pair.stateSymbol.id, context, earlyGuardCandidatesByBlock)
        ) {
          return;
        }
        context.report({
          node,
          message: `You can lose this update because ${callee.name}(!${operand.name}) reads a stale value; use ${callee.name}(previous => !previous).`,
        });
      },
    };
  },
});
