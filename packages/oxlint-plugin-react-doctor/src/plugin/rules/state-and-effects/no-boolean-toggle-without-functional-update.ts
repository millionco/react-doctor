import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveConstIdentifierRootSymbol } from "../../utils/resolve-const-identifier-root-symbol.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const TIMER_CALLBACK_INDEX_BY_NAME = new Map([
  ["setTimeout", 0],
  ["setInterval", 0],
  ["setImmediate", 0],
  ["queueMicrotask", 0],
  ["requestAnimationFrame", 0],
  ["requestIdleCallback", 0],
]);

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);

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

const findEnclosingReactEffectCallback = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (isFunctionLike(current)) {
      const parent: EsTreeNode | null | undefined = current.parent;
      if (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments?.[0] === current &&
        isReactApiCall(parent, EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveNamedAliases: true,
        })
      ) {
        return current;
      }
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
      isGlobalIdentifier(receiver, "window", context)
    ) {
      const callback = resolveFunctionExpression(
        child.arguments?.[TIMER_CALLBACK_INDEX_BY_NAME.get(methodName) ?? 0],
        context,
      );
      addDeferredFunction(callback, child);
      return;
    }
    if (methodName === "then" || methodName === "catch" || methodName === "finally") {
      const firstCallback = resolveFunctionExpression(child.arguments?.[0], context);
      const secondCallback = resolveFunctionExpression(child.arguments?.[1], context);
      addDeferredFunction(firstCallback, child);
      addDeferredFunction(secondCallback, child);
      return;
    }
    const effectCallback = findEnclosingReactEffectCallback(child, context);
    if (!effectCallback) return;
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
    if (methodName === "on" || methodName === "addListener") {
      const callback = resolveFunctionExpression(child.arguments?.[1], context);
      addDeferredFunction(callback, child);
    }
  });
  return deferredFunctions;
};

const nodeCanReach = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
): boolean => {
  const sourceBlock = functionCfg.blockOf(sourceNode);
  const targetBlock = functionCfg.blockOf(targetNode);
  if (!sourceBlock || !targetBlock) return false;
  if (sourceBlock === targetBlock) {
    return (sourceNode.range?.[0] ?? 0) < (targetNode.range?.[0] ?? 0);
  }
  const visitedBlockIds = new Set([sourceBlock.id]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlockIds.has(edge.to.id)) continue;
      visitedBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};

const asyncFunctionHasAwaitBefore = (node: EsTreeNode, context: RuleContext): boolean => {
  const enclosingFunction = context.cfg.enclosingFunction(node);
  if (!enclosingFunction || !isFunctionLike(enclosingFunction) || !enclosingFunction.async) {
    return false;
  }
  const functionCfg = context.cfg.cfgFor(enclosingFunction);
  if (!functionCfg) return false;
  let didFindReachableAwait = false;
  walkAst(enclosingFunction.body, (child: EsTreeNode) => {
    if (didFindReachableAwait) return false;
    if (child !== enclosingFunction.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AwaitExpression") && nodeCanReach(child, node, functionCfg)) {
      didFindReachableAwait = true;
      return false;
    }
  });
  return didFindReachableAwait;
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

const isReturnedCleanupFunction = (node: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== effectCallback) {
    if (isFunctionLike(current)) {
      const parent = current.parent;
      return Boolean(
        parent && isNodeOfType(parent, "ReturnStatement") && parent.argument === current,
      );
    }
    current = current.parent;
  }
  return false;
};

const cleanupCallsMethodOnKey = (
  effectCallback: EsTreeNode,
  methodName: string,
  receiverKey: string,
  context: RuleContext,
): boolean => {
  let didFindCleanup = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (didFindCleanup) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isReturnedCleanupFunction(child, effectCallback)
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
  const callee = stripParenExpression(registrationCall.callee);
  const timerMethodName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
        isGlobalIdentifier(stripParenExpression(callee.object), "window", context)
      ? getStaticPropertyName(callee)
      : null;
  const clearMethodName =
    timerMethodName === "setInterval"
      ? "clearInterval"
      : timerMethodName === "setTimeout"
        ? "clearTimeout"
        : null;
  if (clearMethodName) {
    const resultKey = registrationResultKey(registrationCall, context);
    if (!resultKey) return false;
    let didFindCleanup = false;
    walkAst(effectCallback, (child: EsTreeNode) => {
      if (didFindCleanup) return false;
      if (
        !isNodeOfType(child, "CallExpression") ||
        !isReturnedCleanupFunction(child, effectCallback)
      ) {
        return;
      }
      const cleanupCallee = stripParenExpression(child.callee);
      const cleanupMethodName = isNodeOfType(cleanupCallee, "Identifier")
        ? isGlobalIdentifier(cleanupCallee, cleanupCallee.name, context)
          ? cleanupCallee.name
          : null
        : isNodeOfType(cleanupCallee, "MemberExpression") &&
            isGlobalIdentifier(stripParenExpression(cleanupCallee.object), "window", context)
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
  if (methodName !== "addEventListener") return false;
  const options = stripParenExpression(registrationCall.arguments?.[2]);
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
    if (controllerKey && cleanupCallsMethodOnKey(effectCallback, "abort", controllerKey, context)) {
      return true;
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
  const effectCallback = findEnclosingReactEffectCallback(deferredFunction, context);
  if (!effectCallback) return false;
  const effectCall = effectCallback.parent;
  if (!isNodeOfType(effectCall, "CallExpression")) return false;
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
    registrationCalls.every((registrationCall) =>
      registrationHasCleanup(registrationCall, effectCallback, context),
    )
  );
};

const hasPromiseCommandNegation = (
  node: EsTreeNode,
  stateSymbolId: number,
  deferredFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const deferredFunction = findEnclosingDeferredFunction(node, deferredFunctions);
  const thenCall = deferredFunction?.parent;
  if (!isNodeOfType(thenCall, "CallExpression")) return false;
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
};

const refMemberIsFreshStateMirror = (
  refMember: EsTreeNodeOfType<"MemberExpression">,
  node: EsTreeNode,
  stateSymbolId: number,
  context: RuleContext,
): boolean => {
  const refIdentifier = stripParenExpression(refMember.object);
  if (!isNodeOfType(refIdentifier, "Identifier")) return false;
  const refSymbol = context.scopes.symbolFor(refIdentifier);
  const declarator = refSymbol?.declarationNode;
  if (
    !refSymbol ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useRef", context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }) ||
    !isNodeOfType(stripParenExpression(declarator.init.arguments?.[0]), "Identifier") ||
    resolveConstIdentifierRootSymbol(
      stripParenExpression(declarator.init.arguments?.[0]),
      context.scopes,
    )?.id !== stateSymbolId
  ) {
    return false;
  }
  const componentFunction = context.cfg.enclosingFunction(declarator);
  return refSymbol.references.some((reference) => {
    const member = reference.identifier.parent;
    const assignment = member?.parent;
    return Boolean(
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      getStaticPropertyName(member) === "current" &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.left === member &&
      isNodeOfType(stripParenExpression(assignment.right), "Identifier") &&
      resolveConstIdentifierRootSymbol(stripParenExpression(assignment.right), context.scopes)
        ?.id === stateSymbolId &&
      context.cfg.enclosingFunction(assignment) === componentFunction &&
      context.cfg.isUnconditionalFromEntry(assignment) &&
      (assignment.range?.[0] ?? 0) < (node.range?.[0] ?? 0),
    );
  });
};

const containingBlock = (node: EsTreeNode): EsTreeNodeOfType<"BlockStatement"> | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "BlockStatement")) return current;
    current = current.parent;
  }
  return null;
};

const statementTerminates = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  const lastStatement = statement.body.at(-1);
  return Boolean(lastStatement && statementTerminates(lastStatement));
};

const hasLatestRefEqualityGuard = (
  node: EsTreeNode,
  stateSymbolId: number,
  context: RuleContext,
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
          if (refMemberIsFreshStateMirror(refOperand, node, stateSymbolId, context)) return true;
        }
      }
    }
    current = current.parent;
  }
  const block = containingBlock(node);
  if (!block) return false;
  let containingStatement: EsTreeNode = node;
  while (containingStatement.parent && containingStatement.parent !== block) {
    containingStatement = containingStatement.parent;
  }
  for (const statement of block.body) {
    if (statement === containingStatement) break;
    if (!isNodeOfType(statement, "IfStatement") || !statementTerminates(statement.consequent)) {
      continue;
    }
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
      refMemberIsFreshStateMirror(refOperand, node, stateSymbolId, context)
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
        const pair = resolveReactUseStatePair(callee, context.scopes);
        if (
          !pair ||
          !pair.stateSymbol ||
          resolveConstIdentifierRootSymbol(operand, context.scopes)?.id !== pair.stateSymbol.id
        ) {
          return;
        }
        if (
          !isInsideDeferredFunction(node, deferredFunctions) &&
          !asyncFunctionHasAwaitBefore(node, context)
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
          hasPromiseCommandNegation(node, pair.stateSymbol.id, deferredFunctions, context) ||
          hasLatestRefEqualityGuard(node, pair.stateSymbol.id, context)
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
