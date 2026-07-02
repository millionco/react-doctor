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

// Count distinct setState call sites reachable from the effect body.
// If/else and conditional branches SUM (each call site is a separate
// write the reducer recommendation would fold together), but an
// early-returning guard branch stays mutually exclusive with the
// post-guard body (see countStatementSequenceSetStateCalls). ASYNC
// function bodies are NOT walked — their setStates fire across async
// boundaries on separate render cycles (the canonical fetch pattern
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

// A function expression passed INLINE as a call argument to something other
// than a synchronous array iteration — `store.subscribe(() => { … })`,
// `setTimeout(() => { … })`, `promise.then(() => { … })` — is a deferred
// callback that runs on its own dispatch, so its setters don't compound with
// the effect body's. Everything else IS walked: IIFEs and `forEach`/`map`/…
// callbacks run on the same synchronous dispatch, and a function stored in a
// variable (a helper invoked inline, or a handler registered via
// `addEventListener`) keeps its setter call sites counted — those are the
// exact writes the reducer recommendation targets.
const isDeferredInlineCallback = (functionNode: EsTreeNode): boolean => {
  const parent = (functionNode as unknown as { parent?: EsTreeNode | null }).parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if ((parent.callee as unknown) === (functionNode as unknown)) return false;
  const isCallbackArgument = (parent.arguments ?? []).some(
    (argument) => (argument as unknown) === (functionNode as unknown),
  );
  if (!isCallbackArgument) return false;
  const callee = parent.callee;
  return !(
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

// An `if (cond) { …; return }` (no `else`) whose consequent ends the
// control-flow path: the branch is mutually exclusive with everything
// AFTER it in the block, so its setters must NOT be summed with the
// post-guard body — only one path runs.
const isGuardWithTerminatingBranch = (statement: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(statement, "IfStatement")) return null;
  if (statement.alternate) return null;
  const consequent = statement.consequent as EsTreeNode;
  if (isTerminatingStatement(consequent)) return consequent;
  if (
    isNodeOfType(consequent, "BlockStatement") &&
    (consequent.body ?? []).some((inner) => isTerminatingStatement(inner as EsTreeNode))
  ) {
    return consequent;
  }
  return null;
};

// Count setters along a single execution path through a statement list,
// modeling block-level control flow: setters before an early-returning
// guard always run (they accumulate), the guard branch is a separate
// mutually-exclusive path (tracked as a max), and statements after an
// unconditional `return`/`throw` are unreachable.
const countStatementSequenceSetStateCalls = (statements: ReadonlyArray<EsTreeNode>): number => {
  let fallThroughCount = 0;
  let maxTerminatingPathCount = 0;
  for (const statement of statements) {
    const guardBranch = isGuardWithTerminatingBranch(statement);
    if (guardBranch) {
      maxTerminatingPathCount = Math.max(
        maxTerminatingPathCount,
        fallThroughCount + countMaxPathSetStateCalls(guardBranch),
      );
      continue;
    }
    if (isTerminatingStatement(statement)) break;
    fallThroughCount += countMaxPathSetStateCalls(statement);
  }
  return Math.max(maxTerminatingPathCount, fallThroughCount);
};

const countMaxPathSetStateCalls = (node: EsTreeNode): number => {
  if (!node || typeof node !== "object") return 0;
  // Async function bodies — see comment above. Deferred INLINE callbacks
  // (`.then(...)`, `setTimeout(...)`, subscriptions) are skipped by
  // shouldWalkChild below; other sync function bodies are walked.
  if (isAsyncFunctionLike(node)) return 0;
  // Statement lists: walk with block-level control flow so setters in an
  // early-returning guard branch are mutually exclusive with the
  // post-guard body (max), not summed.
  if (isNodeOfType(node, "BlockStatement") || isNodeOfType(node, "Program")) {
    return countStatementSequenceSetStateCalls((node.body ?? []) as EsTreeNode[]);
  }
  // If/else: SUM the branches' call sites. Only one branch fires per run,
  // but every call site is a separate write the rule's reducer
  // recommendation would consolidate — an `if/else if/else` ladder that
  // fans out over 3+ setters is exactly the cascading shape to flag.
  // (Mutually exclusive early-return guards are handled at the statement-
  // sequence level instead, where the mined FP shape actually lives.)
  if (isNodeOfType(node, "IfStatement")) {
    const thenCount = countMaxPathSetStateCalls(node.consequent as EsTreeNode);
    const elseCount = node.alternate ? countMaxPathSetStateCalls(node.alternate as EsTreeNode) : 0;
    return thenCount + elseCount;
  }
  // Conditional expression — same logic.
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      countMaxPathSetStateCalls(node.consequent as EsTreeNode) +
      countMaxPathSetStateCalls(node.alternate as EsTreeNode)
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
  if (
    isNodeOfType(node, "CallExpression") &&
    isSetterCall(node) &&
    isNodeOfType(node.callee, "Identifier") &&
    isUseStateSetterInScope(node, node.callee.name)
  ) {
    let nestedSettersInArgs = 0;
    for (const argument of (node as EsTreeNodeOfType<"CallExpression">).arguments ?? []) {
      nestedSettersInArgs += countMaxPathSetStateCalls(argument as EsTreeNode);
    }
    return 1 + nestedSettersInArgs;
  }
  // Walk children, summing — sequential statements compound. The only
  // function-like children skipped are DEFERRED inline callbacks (handed
  // straight to `store.subscribe(...)` / `setTimeout(...)` / `.then(...)`),
  // which run on their own dispatch. IIFEs, `forEach`/`map`/… callbacks, and
  // variable-stored helpers/handlers ARE walked. (A `setX(prev => { setY() })`
  // functional updater is counted via the setter-call arguments branch above,
  // not here.)
  const shouldWalkChild = (child: EsTreeNode): boolean =>
    !isFunctionLike(child) || !isDeferredInlineCallback(child);
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

      const setStateCallCount = countMaxPathSetStateCalls(callback);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in one useEffect redraw your screen each time they run together.`,
        });
      }
    },
  }),
});
