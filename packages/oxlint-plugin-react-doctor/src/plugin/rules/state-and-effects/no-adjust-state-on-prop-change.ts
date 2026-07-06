import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readsPostMountValue } from "../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  findDownstreamNodes,
  getArgsUpstreamRefs,
  getCallExpr,
  getRef,
  getUpstreamRefs,
  resolveToFunction,
} from "./utils/effect/ast.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { Reference } from "eslint-scope";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  isConstant,
  isProp,
  isStateSetterCall,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// A literal-only expression: a literal, a bucket of literals
// (`{ status: 'loading' }`, `[]`), or a negation of one.
const isLiteralOnlyExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "Identifier") && node.name === "undefined") return true;
  if (isNodeOfType(node, "UnaryExpression")) {
    return isLiteralOnlyExpression(node.argument as EsTreeNode);
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    return (node.properties ?? []).every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isLiteralOnlyExpression(property.value as EsTreeNode),
    );
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    return (node.elements ?? []).every((element) => isLiteralOnlyExpression(element as EsTreeNode));
  }
  return false;
};

// `prev => ({ ...prev, loading: true, error: false })` — a functional
// updater that only merges literal flags over the previous value carries no
// prop either; it is the same loading-toggle shape as `setLoading(true)`.
const isSpreadMergeOfLiterals = (body: EsTreeNode | null | undefined): boolean => {
  if (!body || !isNodeOfType(body, "ObjectExpression")) return false;
  const properties = body.properties ?? [];
  let sawSpread = false;
  for (const property of properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      sawSpread = true;
      continue;
    }
    if (!isNodeOfType(property, "Property")) return false;
    if (!isLiteralOnlyExpression(property.value as EsTreeNode)) return false;
  }
  return sawSpread;
};

// A constant/reset value — a loading flag or a cleared bucket — carries no
// prop, so it is not a "prop mirrored into state". (`setStatus({})`,
// `setAuthLoading(true)`, `setState(IDLE)` for a module-level literal
// constant, `setSelection(null)`.)
const isConstantSetterArgument = (
  analysis: ProgramAnalysis,
  callExpr: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const argument = callExpr.arguments?.[0];
  if (!argument) return true;
  if (isLiteralOnlyExpression(argument as EsTreeNode)) return true;
  if (isNodeOfType(argument, "Identifier")) {
    const argumentRef = getRef(analysis, argument as EsTreeNode);
    if (argumentRef && isConstant(argumentRef)) return true;
  }
  if (isNodeOfType(argument, "ArrowFunctionExpression")) {
    return isSpreadMergeOfLiterals(argument.body as EsTreeNode);
  }
  return false;
};

// Callee shapes that register a callback with an external event source
// (listener, subscription, observer). Timer callbacks (`setTimeout`,
// `requestAnimationFrame`) deliberately do NOT count — a delayed constant
// toggle is the two-phase-transition shape the rule must keep flagging.
const SUBSCRIPTION_REGISTRATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "addEventListener",
  "addListener",
  "on",
  "once",
  "subscribe",
  "observe",
  "observeDeep",
  "watch",
]);

const isSubscriptionRegistrationCall = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "NewExpression")) {
    const callee = node.callee;
    return isNodeOfType(callee, "Identifier") && callee.name.endsWith("Observer");
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    SUBSCRIPTION_REGISTRATION_METHOD_NAMES.has(callee.property.name)
  );
};

const isCallArgumentOf = (parent: EsTreeNode, node: EsTreeNode): boolean => {
  if (!isNodeOfType(parent, "CallExpression") && !isNodeOfType(parent, "NewExpression")) {
    return false;
  }
  return (parent.arguments ?? []).some((argument) => (argument as unknown) === (node as unknown));
};

// Every function the effect registers with an external event source: inline
// callbacks (`source.on("change", () => ...)`) and named local callbacks
// (`const onScroll = () => ...; window.addEventListener("scroll", onScroll)`).
const collectSubscriptionCallbackFunctions = (
  analysis: ProgramAnalysis,
  effectFn: EsTreeNode,
): EsTreeNode[] => {
  const registrationCalls = [
    ...findDownstreamNodes(effectFn, "CallExpression"),
    ...findDownstreamNodes(effectFn, "NewExpression"),
  ].filter((call) => isSubscriptionRegistrationCall(call));
  const callbackFunctions: EsTreeNode[] = [];
  for (const registrationCall of registrationCalls) {
    if (
      !isNodeOfType(registrationCall, "CallExpression") &&
      !isNodeOfType(registrationCall, "NewExpression")
    ) {
      continue;
    }
    for (const argument of registrationCall.arguments ?? []) {
      const argumentNode = argument as EsTreeNode;
      if (isFunctionLike(argumentNode)) {
        callbackFunctions.push(argumentNode);
        continue;
      }
      if (isNodeOfType(argumentNode, "Identifier")) {
        const argumentRef = getRef(analysis, argumentNode);
        const resolvedFunction = argumentRef ? resolveToFunction(argumentRef) : null;
        if (resolvedFunction) callbackFunctions.push(resolvedFunction);
      }
    }
  }
  return callbackFunctions;
};

const isInsideAnyFunction = (identifier: EsTreeNode, functions: EsTreeNode[]): boolean => {
  let current: EsTreeNode | null | undefined = identifier;
  while (current) {
    if (functions.includes(current)) return true;
    current = current.parent;
  }
  return false;
};

const isSubscriptionRegistrationArgument = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent || !isSubscriptionRegistrationCall(parent)) return false;
  return isCallArgumentOf(parent, identifier);
};

// The sync constant toggle is the initial-sync / reset branch of a
// subscription effect: the SAME setter (or setter-calling helper) is also
// invoked from a listener / observer callback the effect registers — or is
// itself registered as the callback (`source.on('change', renderUsers);
// renderUsers()`). The real value arrives from an external event; the prop
// is just the re-subscribe trigger, not a value being mirrored into state.
const hasSubscriptionCallbackCallToSameSetter = (
  analysis: ProgramAnalysis,
  setterRef: Reference,
  effectFnRefs: Reference[],
  effectFn: EsTreeNode,
): boolean => {
  const callbackFunctions = collectSubscriptionCallbackFunctions(analysis, effectFn);
  return effectFnRefs.some((otherRef) => {
    if (otherRef === setterRef) return false;
    if (otherRef.resolved !== setterRef.resolved) return false;
    const otherIdentifier = otherRef.identifier as unknown as EsTreeNode;
    if (isSubscriptionRegistrationArgument(otherIdentifier)) return true;
    if (!getCallExpr(otherRef)) return false;
    return isInsideAnyFunction(otherIdentifier, callbackFunctions);
  });
};

const derivesFromPostMountRead = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      return readsPostMountValue(node.init as EsTreeNode);
    }),
  );

const PROMISE_CONTINUATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "then",
  "catch",
  "finally",
]);

// A function on the effect's async data-fetch path: an `async` function
// (awaits the request) or a promise continuation (`fetch(...).then(cb)`).
// Timer / listener / cleanup callbacks are NOT — a setter inside those is not
// the fetch signature.
const isPromiseFlowFunction = (fn: EsTreeNode): boolean => {
  if (isFunctionLike(fn) && fn.async) return true;
  const parent = fn.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!(parent.arguments ?? []).some((argument) => (argument as unknown) === (fn as unknown))) {
    return false;
  }
  const callee = parent.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    PROMISE_CONTINUATION_METHOD_NAMES.has(callee.property.name)
  );
};

// The setter call sits behind the effect's await / `.then` flow — every
// function between the call and the effect body is async or a promise
// continuation. This is the async data-fetch signature whose leading sync
// `setLoading(true)` toggle must not be mislabelled as a prop→state mirror.
const isPromiseFlowStateSetterCall = (
  analysis: ProgramAnalysis,
  ref: Reference,
  effectFn: EsTreeNode,
): boolean => {
  if (!isStateSetterCall(analysis, ref)) return false;
  let current = (ref.identifier as unknown as EsTreeNode).parent;
  let sawPromiseFlowFunction = false;
  while (current && current !== effectFn) {
    if (isFunctionLike(current)) {
      if (!isPromiseFlowFunction(current)) return false;
      sawPromiseFlowFunction = true;
    }
    current = current.parent;
  }
  return sawPromiseFlowFunction;
};

// Detector logic is a port of upstream `src/rules/no-adjust-state-on-prop-change.js`
// (severity and message intentionally diverge — see SOURCE.md).
// Note: upstream does NOT skip on cleanup return.

export const noAdjustStateOnPropChange = defineRule({
  id: "no-adjust-state-on-prop-change",
  title: "State synced to a prop inside an effect",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Adjust the state inline during render with a `prev`-prop comparison (`if (prop !== prevProp) { setPrevProp(prop); setX(...); }`), or refactor to remove the duplicated state. Routing the adjustment through a useEffect forces an extra render with a stale UI between the two commits. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const isSomeDepsProps = depsRefs
        .flatMap((ref) => getUpstreamRefs(analysis, ref))
        .some((ref) => isProp(analysis, ref));
      if (!isSomeDepsProps) return;

      // A fetch effect sets a loading flag / clears a bucket synchronously
      // up top, then awaits the request and sets the real result behind the
      // `await` / `.then` (which `isSyncStateSetterCall` correctly skips). The
      // leading sync toggle has a constant arg, so it is NOT a prop→state
      // mirror — suppress it to avoid mislabelling the async data-fetch
      // signature. Only genuine await/`.then`-flow setters count: a setter in
      // a `setTimeout` / listener / cleanup callback must not disarm the rule.
      const hasAsyncStateSetter = effectFnRefs.some((ref) =>
        isPromiseFlowStateSetterCall(analysis, ref, effectFn),
      );

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        // The new value is measured from the DOM / a ref / a browser global
        // (`setMobile(ref.current.offsetWidth < 600)`), which can't be
        // computed during render — so the "adjust inline during render"
        // advice doesn't apply; the prop is just the re-measure trigger.
        if (readsPostMountValue(callExpr)) continue;
        // Same measurement escape when the measurement is stored in a local
        // first (`const rect = node.getBoundingClientRect(); setStyle({ top:
        // rect.top })`) or the setter sits behind a local helper
        // (`updatePosition()`): the value the setter stores still derives
        // from the DOM, so trace the setter's argument sources.
        const argsUpstreamRefs = getArgsUpstreamRefs(analysis, ref);
        if (argsUpstreamRefs.some((argRef) => derivesFromPostMountRead(argRef))) continue;
        if (
          isNodeOfType(callExpr, "CallExpression") &&
          isConstantSetterArgument(analysis, callExpr) &&
          hasSubscriptionCallbackCallToSameSetter(analysis, ref, effectFnRefs, effectFn)
        ) {
          continue;
        }
        if (
          hasAsyncStateSetter &&
          isNodeOfType(callExpr, "CallExpression") &&
          isConstantSetterArgument(analysis, callExpr)
        ) {
          continue;
        }
        // Avoid overlap with no-derived-state
        const isSomeArgsProps = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isProp(analysis, argRef),
        );
        if (isSomeArgsProps) continue;
        context.report({
          node: callExpr,
          message:
            "This effect adjusts state after a prop changes, so users briefly see the stale value.",
        });
      }
    },
  }),
});
