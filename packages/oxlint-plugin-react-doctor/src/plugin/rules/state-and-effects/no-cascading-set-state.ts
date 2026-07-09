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

// Count the maximum number of setState call sites that can run together
// on ONE synchronous dispatch of the effect body. If/else and
// conditional branches are mutually exclusive — only one branch runs —
// so they contribute MAX, not sum (summing inflated the "N setState
// calls run together" message with writes that never co-run; a
// source-verified corpus audit confirmed the inflated counts were false
// positives). ASYNC function bodies are NOT walked — their setStates
// fire across async boundaries on separate render cycles, and React 18+
// batches each continuation into a single render (the canonical fetch
// pattern `setStatus('loading'); await fetch(); setData(d);
// setStatus('idle')` is not a synchronous cascade; a delta audit
// against 0.7.1 confirmed every async-continuation flag on 121 repos
// was a false positive).
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
// unconditional `return`/`throw` are unreachable. Function declarations
// don't execute where they appear — their setters count at call sites.
const countStatementSequenceSetStateCalls = (
  statements: ReadonlyArray<EsTreeNode>,
  context: HelperCountingContext,
): number => {
  let fallThroughCount = 0;
  let maxTerminatingPathCount = 0;
  for (const statement of statements) {
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
  return Math.max(maxTerminatingPathCount, fallThroughCount);
};

interface HelperCountingContext {
  helpersByName: Map<string, EsTreeNode>;
  activeHelpers: Set<EsTreeNode>;
  effectCallback: EsTreeNode;
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

// A helper's setters only count when the effect body delegates to it
// WHOLESALE — an unconditional top-level `applyAll();` / `resetToCached();`
// statement (or an expression-bodied `useEffect(() => resetAll(), …)`).
// Helper calls nested in branches, member chains (`settle()?.onComplete`),
// or other expressions are shared event-handler routines the effect merely
// reuses on one of several exclusive paths; counting their setters at those
// sites produced confirmed false positives (portos StoryBuilder, catho
// DropdownLight) in the delta audit.
const isWholesaleDelegationCall = (callNode: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  const parent = (callNode as unknown as { parent?: EsTreeNode | null }).parent;
  if (!parent) return false;
  if ((parent as unknown) === (effectCallback as unknown)) return true;
  if (!isNodeOfType(parent, "ExpressionStatement")) return false;
  const grandParent = (parent as unknown as { parent?: EsTreeNode | null }).parent;
  return (grandParent as unknown) === ((effectCallback as { body?: EsTreeNode }).body as unknown);
};

// Walk INTO a function's body — only for the whitelisted entries that
// run on the effect's own synchronous dispatch (the effect callback
// itself, a wholesale-delegated helper, a functional updater, an IIFE /
// sync iteration callback). Async bodies stay unwalked (see the header
// comment); every other nested function is its own scope boundary and
// is never entered by countMaxPathSetStateCalls directly.
const countFunctionBodySetStateCalls = (
  functionNode: EsTreeNode,
  context: HelperCountingContext,
): number => {
  if (isAsyncFunctionLike(functionNode)) return 0;
  const body = (functionNode as { body?: EsTreeNode }).body;
  if (!body) return 0;
  return countMaxPathSetStateCalls(body, context);
};

const countMaxPathSetStateCalls = (node: EsTreeNode, context: HelperCountingContext): number => {
  if (!node || typeof node !== "object") return 0;
  // EVERY nested function — sync or async — is its own scope boundary: a
  // `const handleKeyDown = () => {…}` DOM listener defined inside the
  // effect fires on its own dispatch, never together with the effect
  // body. Whitelisted bodies are entered via countFunctionBodySetStateCalls.
  if (isFunctionLike(node)) return 0;
  // Statement lists: walk with block-level control flow so setters in an
  // early-returning guard branch are mutually exclusive with the
  // post-guard body (max), not summed.
  if (isNodeOfType(node, "BlockStatement") || isNodeOfType(node, "Program")) {
    return countStatementSequenceSetStateCalls((node.body ?? []) as EsTreeNode[], context);
  }
  // If/else: MAX across the branches. Only one branch fires per
  // dispatch, so the branches never co-run — counting both inflates the
  // "N setState calls run together" message with writes that cannot
  // happen together (source-verified corpus false positives). The `if`
  // test's own expression can still hold setters, so it accumulates.
  if (isNodeOfType(node, "IfStatement") || isNodeOfType(node, "ConditionalExpression")) {
    const consequent = node.consequent as EsTreeNode;
    const alternate = node.alternate as EsTreeNode | null | undefined;
    const testCount = countMaxPathSetStateCalls(node.test as EsTreeNode, context);
    const thenCount = countMaxPathSetStateCalls(consequent, context);
    const elseCount = alternate ? countMaxPathSetStateCalls(alternate, context) : 0;
    return testCount + Math.max(thenCount, elseCount);
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
      // A functional updater `setX(prev => { setY(); ... })` runs its body
      // synchronously during dispatch, so its setters compound.
      nestedSettersInArgs += isFunctionLike(argument as EsTreeNode)
        ? countFunctionBodySetStateCalls(argument as EsTreeNode, context)
        : countMaxPathSetStateCalls(argument as EsTreeNode, context);
    }
    return 1 + nestedSettersInArgs;
  }
  // A wholesale top-level delegation to a locally-declared sync helper runs
  // its body on the effect's dispatch — count the helper's setters here, at
  // the call site.
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier")) {
    const helperFunction = context.helpersByName.get(node.callee.name);
    if (
      helperFunction &&
      !context.activeHelpers.has(helperFunction) &&
      isWholesaleDelegationCall(node, context.effectCallback)
    ) {
      context.activeHelpers.add(helperFunction);
      let helperCount = countFunctionBodySetStateCalls(helperFunction, context);
      context.activeHelpers.delete(helperFunction);
      for (const argument of node.arguments ?? []) {
        helperCount += countMaxPathSetStateCalls(argument as EsTreeNode, context);
      }
      return helperCount;
    }
  }
  // Walk children, summing — sequential statements compound. Nested
  // function-like children are scope boundaries unless they run on the
  // effect's own dispatch (IIFEs, `forEach`/`map`/… iteration callbacks):
  // callbacks handed to other APIs and stored handlers fire later on their
  // own dispatch. Helper declarations are counted at their synchronous call
  // sites instead (see the helper-call branch above). (A `setX(prev =>
  // { setY() })` functional updater is counted via the setter-call
  // arguments branch.)
  const countChild = (child: EsTreeNode): number => {
    if (isFunctionLike(child)) {
      return runsOnEffectDispatch(child) ? countFunctionBodySetStateCalls(child, context) : 0;
    }
    return countMaxPathSetStateCalls(child, context);
  };
  let total = 0;
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          total += countChild(item as EsTreeNode);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      total += countChild(child as EsTreeNode);
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

const DEV_ENV_FLAG_NAMES: ReadonlySet<string> = new Set(["DEV", "PROD", "MODE", "NODE_ENV"]);

const mentionsDevEnvFlag = (node: EsTreeNode): boolean => {
  if (!node || typeof node !== "object") return false;
  if (
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.property, "Identifier") &&
    DEV_ENV_FLAG_NAMES.has(node.property.name) &&
    isNodeOfType(node.object, "MemberExpression") &&
    isNodeOfType(node.object.property, "Identifier") &&
    node.object.property.name === "env"
  ) {
    return true;
  }
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
          mentionsDevEnvFlag(item as EsTreeNode)
        ) {
          return true;
        }
      }
    } else if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      mentionsDevEnvFlag(child as EsTreeNode)
    ) {
      return true;
    }
  }
  return false;
};

// An effect whose first statement is an early return gated on
// `import.meta.env.DEV` / `process.env.NODE_ENV` is a dev-only harness —
// the body never runs in production, so its setter count is not a
// production render-cascade concern.
const isDevOnlyGuardedEffect = (callback: EsTreeNode): boolean => {
  const body = (callback as { body?: EsTreeNode }).body;
  if (!body || !isNodeOfType(body, "BlockStatement")) return false;
  const firstStatement = (body.body ?? [])[0] as EsTreeNode | undefined;
  if (!firstStatement) return false;
  if (!isGuardWithTerminatingBranch(firstStatement)) return false;
  return mentionsDevEnvFlag((firstStatement as EsTreeNodeOfType<"IfStatement">).test as EsTreeNode);
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
      if (isDevOnlyGuardedEffect(callback)) return;

      const countingContext: HelperCountingContext = {
        helpersByName: collectLocalHelperFunctions(findProgramRoot(node) ?? callback),
        activeHelpers: new Set(),
        effectCallback: callback,
      };
      const setStateCallCount = countFunctionBodySetStateCalls(callback, countingContext);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in one useEffect redraw your screen each time they run together.`,
        });
      }
    },
  }),
});
