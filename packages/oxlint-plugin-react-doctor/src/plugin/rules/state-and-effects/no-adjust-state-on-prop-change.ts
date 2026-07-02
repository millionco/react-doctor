import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readsPostMountValue } from "../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getArgsUpstreamRefs, getCallExpr, getUpstreamRefs } from "./utils/effect/ast.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { Reference } from "eslint-scope";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  isProp,
  isStateSetterCall,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// A constant/reset value — a loading flag or a cleared bucket — carries no
// prop, so it is not a "prop mirrored into state". (`setStatus({})`,
// `setAuthLoading(true)`, `setSelection(null)`.)
const isConstantSetterArgument = (callExpr: EsTreeNodeOfType<"CallExpression">): boolean => {
  const argument = callExpr.arguments?.[0];
  if (!argument) return true;
  if (isNodeOfType(argument, "Literal")) return true;
  if (isNodeOfType(argument, "Identifier") && argument.name === "undefined") return true;
  if (isNodeOfType(argument, "ObjectExpression") && (argument.properties?.length ?? 0) === 0) {
    return true;
  }
  if (isNodeOfType(argument, "ArrayExpression") && (argument.elements?.length ?? 0) === 0) {
    return true;
  }
  return false;
};

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
        if (
          hasAsyncStateSetter &&
          isNodeOfType(callExpr, "CallExpression") &&
          isConstantSetterArgument(callExpr)
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
