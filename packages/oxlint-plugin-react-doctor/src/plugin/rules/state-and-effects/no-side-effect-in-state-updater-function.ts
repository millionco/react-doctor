import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.";

const STATE_HOOK_NAMES = new Set(["useState"]);
const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
  "toSorted",
]);
const SIDE_EFFECT_CALL_NAME_PATTERN =
  /^(?:analytics|capture|dispatch|emit|log|notify|on[A-Z]|persist|record|report|send|track)/;
const SAFE_GLOBAL_RECEIVER_NAMES = new Set(["Math", "JSON", "Object", "Array"]);
const FRESH_CONTAINER_CONSTRUCTOR_NAMES = new Set([
  "Array",
  "Map",
  "Object",
  "Set",
  "WeakMap",
  "WeakSet",
]);
const SIDE_EFFECT_METHOD_NAMES = new Set([
  "appendChild",
  "click",
  "dispatchEvent",
  "focus",
  "insertBefore",
  "remove",
  "removeChild",
  "removeItem",
  "replaceChild",
  "setItem",
]);

const isReactStateSetterCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean =>
  isNodeOfType(node.callee, "Identifier") &&
  isReactHookResultReference(node.callee, STATE_HOOK_NAMES, 1, context.scopes);

const resolveLocalFunction = (expression: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  let current = stripParenExpression(expression);
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      (symbol.kind !== "const" && symbol.kind !== "function")
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    current = stripParenExpression(symbol.initializer);
  }
  return isFunctionLike(current) ? current : null;
};

const baseReceiverIdentifier = (expression: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? current : null;
};

const nodeIsInsideFunction = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === functionNode) return true;
    current = current.parent;
  }
  return false;
};

const receiverIsUpdaterLocal = (
  receiver: EsTreeNode,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const baseIdentifier = baseReceiverIdentifier(receiver);
  if (!baseIdentifier) return false;
  const symbol = context.scopes.symbolFor(baseIdentifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const isDeclaredInsideUpdater = [...executedFunctions].some((functionNode) =>
    nodeIsInsideFunction(symbol.bindingIdentifier, functionNode),
  );
  if (!isDeclaredInsideUpdater) return false;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (!initializer) return false;
  if (
    isNodeOfType(initializer, "ObjectExpression") ||
    isNodeOfType(initializer, "ArrayExpression")
  ) {
    return true;
  }
  if (isNodeOfType(initializer, "NewExpression")) {
    const constructor = stripParenExpression(initializer.callee);
    return Boolean(
      isNodeOfType(constructor, "Identifier") &&
      FRESH_CONTAINER_CONSTRUCTOR_NAMES.has(constructor.name) &&
      context.scopes.isGlobalReference(constructor),
    );
  }
  if (!isNodeOfType(initializer, "Identifier")) return false;
  return receiverIsUpdaterLocal(initializer, executedFunctions, context, visitedSymbolIds);
};

const isStaticallyUnreachable = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== boundary) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (parent && isNodeOfType(parent, "IfStatement")) {
      const test = stripParenExpression(parent.test);
      if (isNodeOfType(test, "Literal") && typeof test.value === "boolean") {
        if (
          (parent.consequent === current && !test.value) ||
          (parent.alternate === current && test.value)
        ) {
          return true;
        }
      }
    }
    if (parent && isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      const left = stripParenExpression(parent.left);
      if (
        isNodeOfType(left, "Literal") &&
        ((parent.operator === "&&" && !left.value) ||
          (parent.operator === "||" && Boolean(left.value)))
      ) {
        return true;
      }
    }
    current = parent;
  }
  return false;
};

const getCallName = (call: EsTreeNodeOfType<"CallExpression">): string | null => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  return isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;
};

const identifierIsCallbackParameter = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (symbol?.kind !== "parameter") return false;
  const bindingParent = symbol.bindingIdentifier.parent;
  return Boolean(
    isNodeOfType(bindingParent, "Property") &&
    /^on[A-Z]/.test(getStaticPropertyKeyName(bindingParent, { allowComputedString: true }) ?? ""),
  );
};

const callHasSideEffectName = (
  call: EsTreeNodeOfType<"CallExpression">,
  executedFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const callName = getCallName(call);
  if (!callName) return false;
  const callee = stripParenExpression(call.callee);
  if (
    isNodeOfType(callee, "Identifier") &&
    !SIDE_EFFECT_CALL_NAME_PATTERN.test(callName) &&
    !identifierIsCallbackParameter(callee, context)
  ) {
    return false;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !SIDE_EFFECT_CALL_NAME_PATTERN.test(callName) &&
    !SIDE_EFFECT_METHOD_NAMES.has(callName)
  ) {
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return true;
  const receiver = stripParenExpression(callee.object);
  const baseIdentifier = baseReceiverIdentifier(receiver);
  if (
    baseIdentifier &&
    SAFE_GLOBAL_RECEIVER_NAMES.has(baseIdentifier.name) &&
    context.scopes.isGlobalReference(baseIdentifier)
  ) {
    return false;
  }
  return !receiverIsUpdaterLocal(receiver, executedFunctions, context);
};

const nodeIsReachable = (
  node: EsTreeNode,
  functionCfg: FunctionCfg,
  reachableBlockIdsByCfg: WeakMap<FunctionCfg, ReadonlySet<number>>,
): boolean => {
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return false;
  const cachedBlockIds = reachableBlockIdsByCfg.get(functionCfg);
  if (cachedBlockIds) return cachedBlockIds.has(targetBlock.id);
  const pendingBlocks = [functionCfg.entry];
  const visitedBlockIds = new Set([functionCfg.entry.id]);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (visitedBlockIds.has(edge.to.id)) continue;
      visitedBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  reachableBlockIdsByCfg.set(functionCfg, visitedBlockIds);
  return visitedBlockIds.has(targetBlock.id);
};

const collectExecutedFunctions = (
  updaterFunction: EsTreeNode,
  context: RuleContext,
): Set<EsTreeNode> => {
  const executedFunctions = new Set<EsTreeNode>([updaterFunction]);
  const pendingFunctions = [updaterFunction];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction) break;
    walkOwnFunctionScope(currentFunction, (child: EsTreeNode) => {
      if (isNodeOfType(child, "NewExpression")) {
        const constructor = stripParenExpression(child.callee);
        if (
          isNodeOfType(constructor, "Identifier") &&
          constructor.name === "Promise" &&
          context.scopes.isGlobalReference(constructor)
        ) {
          const executor = child.arguments?.[0];
          if (executor && !isNodeOfType(executor, "SpreadElement")) {
            const executorFunction = resolveLocalFunction(executor, context);
            if (executorFunction && !executedFunctions.has(executorFunction)) {
              executedFunctions.add(executorFunction);
              pendingFunctions.push(executorFunction);
            }
          }
        }
        return;
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      if (isReactStateSetterCall(child, context)) {
        const updaterArgument = child.arguments?.[0];
        if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
        const nestedUpdater = resolveLocalFunction(updaterArgument, context);
        if (nestedUpdater && !executedFunctions.has(nestedUpdater)) {
          executedFunctions.add(nestedUpdater);
          pendingFunctions.push(nestedUpdater);
        }
        return;
      }
      const callee = stripParenExpression(child.callee);
      const directFunction = resolveLocalFunction(callee, context);
      if (directFunction && !executedFunctions.has(directFunction)) {
        executedFunctions.add(directFunction);
        pendingFunctions.push(directFunction);
      }
      const arrayReceiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : null;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "from" &&
        isNodeOfType(arrayReceiver, "Identifier") &&
        arrayReceiver.name === "Array" &&
        context.scopes.isGlobalReference(arrayReceiver)
      ) {
        const mapperArgument = child.arguments?.[1];
        if (mapperArgument && !isNodeOfType(mapperArgument, "SpreadElement")) {
          const mapperFunction = resolveLocalFunction(mapperArgument, context);
          if (mapperFunction && !executedFunctions.has(mapperFunction)) {
            executedFunctions.add(mapperFunction);
            pendingFunctions.push(mapperFunction);
          }
        }
      }
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
      ) {
        return;
      }
      const callbackArgument = child.arguments?.[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
      const callbackFunction = resolveLocalFunction(callbackArgument, context);
      if (!callbackFunction || executedFunctions.has(callbackFunction)) return;
      executedFunctions.add(callbackFunction);
      pendingFunctions.push(callbackFunction);
    });
  }
  return executedFunctions;
};

export const noSideEffectInStateUpdaterFunction = defineRule({
  id: "no-side-effect-in-state-updater-function",
  title: "Side effect inside a state updater function",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "React may replay a state updater, so callbacks, analytics, and persistence inside it can run more than once. Compute state purely, then perform the side effect outside the setter.",
  create: (context: RuleContext) => {
    const executedFunctionsByUpdater = new WeakMap<EsTreeNode, Set<EsTreeNode>>();
    const reachableBlockIdsByCfg = new WeakMap<FunctionCfg, ReadonlySet<number>>();
    const reportedSideEffectNodes = new WeakSet<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactStateSetterCall(node, context)) return;
        const updaterArgument = node.arguments[0];
        if (!updaterArgument || isNodeOfType(updaterArgument, "SpreadElement")) return;
        const updaterFunction = resolveLocalFunction(updaterArgument, context);
        if (!updaterFunction) return;
        const executedFunctions =
          executedFunctionsByUpdater.get(updaterFunction) ??
          collectExecutedFunctions(updaterFunction, context);
        executedFunctionsByUpdater.set(updaterFunction, executedFunctions);
        for (const executedFunction of executedFunctions) {
          const functionCfg = context.cfg.cfgFor(executedFunction);
          walkOwnFunctionScope(executedFunction, (child: EsTreeNode) => {
            if (!isNodeOfType(child, "CallExpression")) return;
            if (isStaticallyUnreachable(child, executedFunction)) return;
            if (functionCfg && !nodeIsReachable(child, functionCfg, reachableBlockIdsByCfg)) return;
            if (child !== node && isReactStateSetterCall(child, context)) {
              if (!reportedSideEffectNodes.has(child)) {
                reportedSideEffectNodes.add(child);
                context.report({ node: child, message: MESSAGE });
              }
              return;
            }
            const resolvedFunction = resolveLocalFunction(child.callee, context);
            if (resolvedFunction && executedFunctions.has(resolvedFunction)) return;
            if (!callHasSideEffectName(child, executedFunctions, context)) return;
            if (reportedSideEffectNodes.has(child)) return;
            reportedSideEffectNodes.add(child);
            context.report({ node: child, message: MESSAGE });
          });
        }
      },
    };
  },
});
