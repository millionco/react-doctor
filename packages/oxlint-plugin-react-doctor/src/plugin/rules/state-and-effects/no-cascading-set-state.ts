import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { CASCADING_SET_STATE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

// Count setState calls along a SINGLE execution path. For if/else
// branches and switch/case alternatives, take the MAX of the branches
// (only one fires per render) instead of SUM. ASYNC function bodies
// are NOT walked — their setStates fire across async boundaries on
// separate render cycles (the canonical fetch pattern
// `setStatus('loading'); await fetch(); setData(d); setStatus('idle')`
// is 3 setStates separated by awaits, not 3 cascading synchronous
// updates that need a reducer).
const isAsyncFunctionLike = (node: EsTreeNode): boolean => {
  if (
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "FunctionDeclaration")
  ) {
    return Boolean((node as { async?: boolean }).async);
  }
  return false;
};

// Array iteration methods that invoke their callback SYNCHRONOUSLY, so
// setters inside the callback still compound on the effect's dispatch.
const SYNCHRONOUS_ITERATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "flatMap",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "sort",
]);

// A nested function whose body runs on the SAME synchronous dispatch as the
// effect: an IIFE (`(() => { … })()`) or the callback of a synchronous array
// iteration (`items.forEach(() => { setA(); setB() })`). Its setters DO
// compound and must still be counted — unlike a deferred callback (timer /
// listener / observer / promise / subscription), which runs on its own
// dispatch and is only counted when the effect ALSO sets state synchronously
// (see countSynchronouslyRegisteredCallbackSetStateCalls).
const runsSynchronouslyInline = (fn: EsTreeNode): boolean => {
  const parent = fn.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (parent.callee === fn) return true;
  const isCallbackArgument = (parent.arguments ?? []).some((argument) => argument === fn);
  if (!isCallbackArgument) return false;
  const callee = parent.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    SYNCHRONOUS_ITERATION_METHOD_NAMES.has(callee.property.name)
  );
};

// `break` / `return` / `throw` / `continue` end a switch-case run; the
// absence of any of these means the next case label falls through and
// its setters execute on the same dispatch.
const isTerminatingStatement = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "BreakStatement") ||
  isNodeOfType(statement, "ReturnStatement") ||
  isNodeOfType(statement, "ThrowStatement") ||
  isNodeOfType(statement, "ContinueStatement");

// Count setters through a statement list, stopping at an unconditional
// `return` / `throw` — statements after it are unreachable. Early-return
// guard branches (`if (cond) { setX(); return; }`) still ACCUMULATE with
// the post-guard body: across dep-driven re-runs both paths execute, so
// the cascading-state smell is the cumulative setter count, not the max
// of one run's mutually exclusive paths.
const countStatementSequenceSetStateCalls = (statements: ReadonlyArray<EsTreeNode>): number => {
  let cumulativeCount = 0;
  for (const statement of statements) {
    if (isTerminatingStatement(statement)) break;
    cumulativeCount += countMaxPathSetStateCalls(statement);
  }
  return cumulativeCount;
};

const isScopedSetterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isSetterCall(node) &&
  isNodeOfType(node.callee, "Identifier") &&
  isUseStateSetterInScope(node, node.callee.name);

const countMaxPathSetStateCalls = (node: EsTreeNode): number => {
  if (!node || typeof node !== "object") return 0;
  // Async function bodies — see comment above.
  if (isAsyncFunctionLike(node)) return 0;
  // Statement lists: truncate at unreachable code.
  if (isNodeOfType(node, "BlockStatement") || isNodeOfType(node, "Program")) {
    return countStatementSequenceSetStateCalls((node.body ?? []) as EsTreeNode[]);
  }
  // If/else: max of branches (only one fires).
  if (isNodeOfType(node, "IfStatement")) {
    const thenCount = countMaxPathSetStateCalls(node.consequent as EsTreeNode);
    const elseCount = node.alternate ? countMaxPathSetStateCalls(node.alternate as EsTreeNode) : 0;
    return Math.max(thenCount, elseCount);
  }
  // Conditional expression — same logic.
  if (isNodeOfType(node, "ConditionalExpression")) {
    return Math.max(
      countMaxPathSetStateCalls(node.consequent as EsTreeNode),
      countMaxPathSetStateCalls(node.alternate as EsTreeNode),
    );
  }
  // Switch: max across runs (a "run" is a sequence of cases that fall
  // through into each other; a run ends at break/return/throw/continue).
  // Without fall-through every run is a single case, so this reduces to
  // plain max. With fall-through, falling cases sum together because
  // they execute on the same dispatch.
  if (isNodeOfType(node, "SwitchStatement")) {
    let maxRunSetters = 0;
    let currentRunSetters = 0;
    for (const switchCase of node.cases ?? []) {
      const consequent = (switchCase as EsTreeNodeOfType<"SwitchCase">).consequent ?? [];
      let caseSetters = 0;
      let runEnds = false;
      for (const statement of consequent) {
        caseSetters += countMaxPathSetStateCalls(statement as EsTreeNode);
        if (isTerminatingStatement(statement as EsTreeNode)) runEnds = true;
      }
      currentRunSetters += caseSetters;
      if (runEnds) {
        if (currentRunSetters > maxRunSetters) maxRunSetters = currentRunSetters;
        currentRunSetters = 0;
      }
    }
    if (currentRunSetters > maxRunSetters) maxRunSetters = currentRunSetters;
    return maxRunSetters;
  }
  // Try/catch/finally: max(try, catch) (only one path runs on
  // success vs throw) + finally (always runs).
  if (isNodeOfType(node, "TryStatement")) {
    const tryCount = countMaxPathSetStateCalls(node.block as EsTreeNode);
    const catchCount = node.handler
      ? countMaxPathSetStateCalls((node.handler as { body: EsTreeNode }).body)
      : 0;
    const finallyCount = node.finalizer
      ? countMaxPathSetStateCalls(node.finalizer as EsTreeNode)
      : 0;
    return Math.max(tryCount, catchCount) + finallyCount;
  }
  // Direct setter call — plus any setters inside its arguments. A
  // functional updater `setX(prev => { setY(); ... })` runs the
  // callback synchronously during dispatch, so `setY()` compounds.
  if (isNodeOfType(node, "CallExpression") && isScopedSetterCall(node)) {
    let nestedSettersInArgs = 0;
    for (const argument of node.arguments ?? []) {
      nestedSettersInArgs += countMaxPathSetStateCalls(argument as EsTreeNode);
    }
    return 1 + nestedSettersInArgs;
  }
  // Walk children, summing — sequential statements compound. A DEFERRED
  // callback child (handed to `addEventListener` / `setTimeout` / an
  // observer / `.then(...)`) runs on its own dispatch, so it is skipped
  // here; it is counted separately (and cumulatively) by
  // countSynchronouslyRegisteredCallbackSetStateCalls when the effect
  // also sets state synchronously. A function that runs synchronously
  // inline (an IIFE or a `forEach`/`map`/… callback) IS walked.
  const shouldWalkChild = (child: EsTreeNode): boolean =>
    !isFunctionLike(child) || runsSynchronouslyInline(child);
  let total = 0;
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          shouldWalkChild(item as EsTreeNode)
        ) {
          total += countMaxPathSetStateCalls(item as EsTreeNode);
        }
      }
    } else if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      shouldWalkChild(child as EsTreeNode)
    ) {
      total += countMaxPathSetStateCalls(child as EsTreeNode);
    }
  }
  return total;
};

// The synchronous execution surface of the effect: every node reached
// without crossing into a deferred function body (IIFEs and synchronous
// iteration callbacks stay on the surface).
const forEachSynchronousNode = (
  effectCallback: EsTreeNode,
  visit: (node: EsTreeNode) => void,
): void => {
  walkAst(effectCallback, (node) => {
    if (node !== effectCallback && isFunctionLike(node) && !runsSynchronouslyInline(node)) {
      return false;
    }
    visit(node);
  });
};

const collectEffectScopeFunctionBindings = (
  effectCallback: EsTreeNode,
): Map<string, EsTreeNode> => {
  const functionBindings = new Map<string, EsTreeNode>();
  forEachSynchronousNode(effectCallback, (node) => {
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      isFunctionLike(node.init)
    ) {
      functionBindings.set(node.id.name, node.init);
    }
    if (isNodeOfType(node, "FunctionDeclaration") && isNodeOfType(node.id, "Identifier")) {
      functionBindings.set(node.id.name, node);
    }
  });
  return functionBindings;
};

// Setters inside handlers the effect REGISTERS on its synchronous path —
// an inline callback argument (`window.addEventListener("x", () => …)`,
// `promise.then(() => …)`) or an effect-scope function passed by name
// (`const onShow = () => …; window.addEventListener("show", onShow)`).
// They run on their own dispatch, but when the effect itself also sets
// state synchronously the component is orchestrating one state machine
// across the effect and its handlers, so the calls compound toward the
// threshold. A pure listener-registration effect (zero synchronous
// setters) never reaches this counter.
const countSynchronouslyRegisteredCallbackSetStateCalls = (effectCallback: EsTreeNode): number => {
  const functionBindings = collectEffectScopeFunctionBindings(effectCallback);
  const countedBindingNames = new Set<string>();
  let registeredCallbackCount = 0;
  forEachSynchronousNode(effectCallback, (node) => {
    if (!isNodeOfType(node, "CallExpression") || isScopedSetterCall(node)) return;
    for (const argument of node.arguments ?? []) {
      const argumentNode = argument;
      if (isFunctionLike(argumentNode) && !runsSynchronouslyInline(argumentNode)) {
        registeredCallbackCount += countMaxPathSetStateCalls(argumentNode);
        continue;
      }
      if (!isNodeOfType(argumentNode, "Identifier")) continue;
      const boundFunction = functionBindings.get(argumentNode.name);
      if (!boundFunction || countedBindingNames.has(argumentNode.name)) continue;
      countedBindingNames.add(argumentNode.name);
      registeredCallbackCount += countMaxPathSetStateCalls(boundFunction);
    }
  });
  return registeredCallbackCount;
};

// `useEffect(() => { setX(...); setY(...); setZ(...); }, [])` is the
// canonical mount-time initialisation pattern — N independent state
// atoms set ONCE on first render. The rule's "use useReducer"
// recommendation is overkill here: a reducer doesn't reduce the call
// count, it just hides the same N writes behind a switch. Reactivity
// concerns about cascading re-renders don't apply because there's no
// dep-driven re-execution.
const isInitOnlyEffect = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const depsArg = node.arguments?.[1] as EsTreeNode | undefined;
  if (!depsArg) return false;
  if (!isNodeOfType(depsArg, "ArrayExpression")) return false;
  return (depsArg.elements ?? []).length === 0;
};

export const noCascadingSetState = defineRule({
  id: "no-cascading-set-state",
  title: "Multiple setState calls in one effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Combine related updates in `useReducer` so one effect does not redraw the screen once per `setState` call.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      if (isInitOnlyEffect(node)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const synchronousSetStateCallCount = countMaxPathSetStateCalls(callback);
      if (synchronousSetStateCallCount === 0) return;
      const setStateCallCount =
        synchronousSetStateCallCount + countSynchronouslyRegisteredCallbackSetStateCalls(callback);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in one useEffect redraw your screen each time they run together.`,
        });
      }
    },
  }),
});
