import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { CASCADING_SET_STATE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
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
// function bodies are SEGMENTED at awaits — each await is a batch
// boundary, so the canonical fetch pattern `setStatus('loading');
// await fetch(); setData(d); setStatus('idle')` counts max 2 per
// batch, while a post-await run of many consecutive setters still
// compounds and gets counted in full.
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

// A nested function only compounds with the effect body when it runs on the
// effect's own synchronous dispatch: an IIFE or a `forEach`/`map`/… iteration
// callback. Everything else — a callback handed to `store.subscribe(...)` /
// `setTimeout(...)` / `.then(...)`, an event handler registered via
// `addEventListener` or an options object (`dropTargetForElements({ onDrop })`),
// a cleanup closure — fires later on its own dispatch (and React batches it),
// so its setters must not be counted against the effect. A locally-stored
// helper is only counted where the effect body actually CALLS it.
const runsOnEffectDispatch = (functionNode: EsTreeNode): boolean => {
  const parent = (functionNode as unknown as { parent?: EsTreeNode | null }).parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if ((parent.callee as unknown) === (functionNode as unknown)) return true;
  const isCallbackArgument = (parent.arguments ?? []).some(
    (argument) => (argument as unknown) === (functionNode as unknown),
  );
  if (!isCallbackArgument) return false;
  const callee = parent.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    SYNCHRONOUS_ITERATION_METHOD_NAMES.has(callee.property.name)
  );
};

// An await inside a statement suspends the async body: setters before
// it flush in one batch, setters after it in another. Awaits inside
// NESTED functions don't suspend this body, so the walk skips them.
const containsAwait = (node: EsTreeNode): boolean => {
  if (!node || typeof node !== "object") return false;
  if (isNodeOfType(node, "AwaitExpression")) return true;
  if (isNodeOfType(node, "ForOfStatement") && Boolean((node as { await?: boolean }).await)) {
    return true;
  }
  if (isFunctionLike(node)) return false;
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          containsAwait(item as EsTreeNode)
        ) {
          return true;
        }
      }
    } else if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      containsAwait(child as EsTreeNode)
    ) {
      return true;
    }
  }
  return false;
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
const countStatementSequenceSetStateCalls = (
  statements: ReadonlyArray<EsTreeNode>,
  context: HelperCountingContext,
): number => {
  let fallThroughCount = 0;
  let maxTerminatingPathCount = 0;
  let maxBatchCount = 0;
  for (const statement of statements) {
    // Inside an async body an awaiting statement is a batch boundary:
    // close the current batch, count the statement's own setters as
    // their own batch, and start fresh after it.
    if (context.splitOnAwait && containsAwait(statement)) {
      maxBatchCount = Math.max(
        maxBatchCount,
        fallThroughCount,
        countMaxPathSetStateCalls(statement, context),
      );
      fallThroughCount = 0;
      if (isTerminatingStatement(statement)) break;
      continue;
    }
    const guardBranch = isGuardWithTerminatingBranch(statement);
    if (guardBranch) {
      maxTerminatingPathCount = Math.max(
        maxTerminatingPathCount,
        fallThroughCount + countMaxPathSetStateCalls(guardBranch, context),
      );
      continue;
    }
    if (isTerminatingStatement(statement)) break;
    fallThroughCount += countMaxPathSetStateCalls(statement, context);
  }
  return Math.max(maxTerminatingPathCount, fallThroughCount, maxBatchCount);
};

interface HelperCountingContext {
  helpersByName: Map<string, EsTreeNode>;
  activeHelpers: Set<EsTreeNode>;
  splitOnAwait: boolean;
}

// Function bindings declared in the file (`const applyAll = () => {...}`,
// `function fetchAll() {...}`) — inside the effect callback or at component /
// hook level: their setters count at the effect's synchronous CALL site, not
// the declaration.
const collectLocalHelperFunctions = (root: EsTreeNode): Map<string, EsTreeNode> => {
  const helpersByName = new Map<string, EsTreeNode>();
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id) {
      helpersByName.set(node.id.name, node);
    }
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.init &&
      isFunctionLike(node.init)
    ) {
      helpersByName.set(node.id.name, node.init as EsTreeNode);
    }
    // `const fetchAll = useCallback(async () => {...}, [deps])` — the
    // callable binding is the memoized inner function.
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.init &&
      isNodeOfType(node.init, "CallExpression") &&
      isNodeOfType(node.init.callee, "Identifier") &&
      node.init.callee.name === "useCallback" &&
      node.init.arguments?.[0] &&
      isFunctionLike(node.init.arguments[0] as EsTreeNode)
    ) {
      helpersByName.set(node.id.name, node.init.arguments[0] as EsTreeNode);
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return helpersByName;
};

const countMaxPathSetStateCalls = (node: EsTreeNode, context: HelperCountingContext): number => {
  if (!node || typeof node !== "object") return 0;
  // Entering a function body resets await-segmentation: async bodies
  // split batches at awaits (see comment above), sync bodies run in one
  // batch regardless of the enclosing function's asyncness.
  if (isFunctionLike(node)) {
    const enclosingSplitOnAwait = context.splitOnAwait;
    context.splitOnAwait = isAsyncFunctionLike(node);
    const bodyCount = countMaxPathSetStateCalls(
      (node as { body?: EsTreeNode }).body as EsTreeNode,
      context,
    );
    context.splitOnAwait = enclosingSplitOnAwait;
    return bodyCount;
  }
  // Statement lists: walk with block-level control flow so setters in an
  // early-returning guard branch are mutually exclusive with the
  // post-guard body (max), not summed.
  if (isNodeOfType(node, "BlockStatement") || isNodeOfType(node, "Program")) {
    return countStatementSequenceSetStateCalls((node.body ?? []) as EsTreeNode[], context);
  }
  // If/else: SUM the branches' call sites. Only one branch fires per run,
  // but every call site is a separate write the rule's reducer
  // recommendation would consolidate — an `if/else if/else` ladder that
  // fans out over 3+ setters is exactly the cascading shape to flag.
  // (Mutually exclusive early-return guards are handled at the statement-
  // sequence level instead, where the mined FP shape actually lives.
  // A branch-MAX variant was measured on the corpus and traded ~1:1
  // against judged true positives, so summing stays.)
  if (isNodeOfType(node, "IfStatement") || isNodeOfType(node, "ConditionalExpression")) {
    const consequent = node.consequent as EsTreeNode;
    const alternate = node.alternate as EsTreeNode | null | undefined;
    const thenCount = countMaxPathSetStateCalls(consequent, context);
    const elseCount = alternate ? countMaxPathSetStateCalls(alternate, context) : 0;
    return thenCount + elseCount;
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
        caseSetters += countMaxPathSetStateCalls(statement as EsTreeNode, context);
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
    const tryCount = countMaxPathSetStateCalls(node.block as EsTreeNode, context);
    const catchCount = node.handler
      ? countMaxPathSetStateCalls((node.handler as { body: EsTreeNode }).body, context)
      : 0;
    const finallyCount = node.finalizer
      ? countMaxPathSetStateCalls(node.finalizer as EsTreeNode, context)
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
      nestedSettersInArgs += countMaxPathSetStateCalls(argument as EsTreeNode, context);
    }
    return 1 + nestedSettersInArgs;
  }
  // A synchronous call to a locally-declared helper runs its body on the
  // effect's dispatch — count the helper's setters here, at the call site.
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier")) {
    const helperFunction = context.helpersByName.get(node.callee.name);
    if (helperFunction && !context.activeHelpers.has(helperFunction)) {
      context.activeHelpers.add(helperFunction);
      let helperCount = countMaxPathSetStateCalls(helperFunction, context);
      context.activeHelpers.delete(helperFunction);
      for (const argument of node.arguments ?? []) {
        helperCount += countMaxPathSetStateCalls(argument as EsTreeNode, context);
      }
      return helperCount;
    }
  }
  // Walk children, summing — sequential statements compound. Nested
  // function-like children are skipped unless they run on the effect's own
  // dispatch (IIFEs, `forEach`/`map`/… iteration callbacks): callbacks handed
  // to other APIs and stored handlers fire later on their own dispatch.
  // Helper declarations are counted at their synchronous call sites instead
  // (see the helper-call branch above). (A `setX(prev => { setY() })`
  // functional updater is counted via the setter-call arguments branch.)
  const shouldWalkChild = (child: EsTreeNode): boolean =>
    !isFunctionLike(child) || runsOnEffectDispatch(child);
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
          total += countMaxPathSetStateCalls(item as EsTreeNode, context);
        }
      }
    } else if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      shouldWalkChild(child as EsTreeNode)
    ) {
      total += countMaxPathSetStateCalls(child as EsTreeNode, context);
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

      const countingContext: HelperCountingContext = {
        helpersByName: collectLocalHelperFunctions(findProgramRoot(node) ?? callback),
        activeHelpers: new Set(),
        splitOnAwait: false,
      };
      const setStateCallCount = countMaxPathSetStateCalls(callback, countingContext);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in one useEffect redraw your screen each time they run together.`,
        });
      }
    },
  }),
});
