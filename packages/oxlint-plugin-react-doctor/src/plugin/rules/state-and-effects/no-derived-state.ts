import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readsPostMountValue } from "../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getDownstreamRefs,
  getUpstreamRefs,
} from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isControlledPropMirror } from "./utils/is-controlled-prop-mirror.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  hasCleanup,
  isProp,
  isState,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// 1:1 port of upstream
// `eslint-plugin-react-you-might-not-need-an-effect/src/rules/no-derived-state.js`.
// Diagnostic messages match upstream verbatim. The ESLint scope APIs
// upstream uses (`context.sourceCode.getScope`, `ref.resolved.defs`)
// are sourced from a cached eslint-scope `ScopeManager` via
// `getProgramAnalysis(node)`.

const countSetterCallSites = (ref: Reference): number => {
  if (!ref.resolved) return 0;
  let count = 0;
  for (const reference of ref.resolved.references) {
    const parent = (reference.identifier as unknown as { parent?: EsTreeNode | null }).parent;
    if (parent && isNodeOfType(parent, "CallExpression")) count += 1;
  }
  return count;
};

// Reads of the updater function's own parameter inside its body —
// `previous` in `setKeys((previous) => new Set(previous).add(key))`.
// Resolved through eslint-scope so a shadowing inner binding named the
// same does not count.
const collectUpdaterParameterReads = (
  analysis: ProgramAnalysis,
  updaterFn:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">,
): EsTreeNode[] => {
  const reads: EsTreeNode[] = [];
  for (const ref of getDownstreamRefs(analysis, updaterFn.body)) {
    const resolvesToOwnParameter = ref.resolved?.defs.some(
      (def) => def.type === "Parameter" && (def.node as unknown as EsTreeNode) === updaterFn,
    );
    if (resolvesToOwnParameter) reads.push(ref.identifier as unknown as EsTreeNode);
  }
  return reads;
};

// `(prev) => ({ ...prev, field: <derived> })` — the previous value is
// only carried through an object spread while every piece of NEW
// information comes from props/state, so the overwritten field is
// still derivable and the report stands (upstream invalid case
// "Partially update complex state from props via callback setter").
const readsParameterOnlyViaObjectSpread = (parameterReads: ReadonlyArray<EsTreeNode>): boolean =>
  parameterReads.every((read) => {
    const spread = read.parent;
    if (!spread || !isNodeOfType(spread, "SpreadElement")) return false;
    const container = spread.parent;
    return Boolean(container && isNodeOfType(container, "ObjectExpression"));
  });

// A functional updater whose new value is computed FROM the previous
// value (`setKeys((previous) => new Set(previous).add(key))`,
// `setTotal((prev) => prev + delta)`, `setItems((prev) => [...prev, item])`)
// accumulates state across renders. An accumulator is by definition not
// derivable from the CURRENT props/state — the rule's entire premise —
// so it must stay quiet. The spread-only object merge is the one
// param-reading shape that is still derived state, so it stays reported.
const isAccumulatingFunctionalUpdater = (
  analysis: ProgramAnalysis,
  callExpr: EsTreeNode,
): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const firstArgument: EsTreeNode | undefined = callExpr.arguments?.[0];
  if (!firstArgument || !isFunctionLike(firstArgument)) return false;
  const parameterReads = collectUpdaterParameterReads(analysis, firstArgument);
  if (parameterReads.length === 0) return false;
  return !readsParameterOnlyViaObjectSpread(parameterReads);
};

const getStateNameForUseStateDecl = (useStateNode: EsTreeNode | null): string | null => {
  if (!useStateNode || !isNodeOfType(useStateNode, "VariableDeclarator")) return null;
  if (!isNodeOfType(useStateNode.id, "ArrayPattern")) return null;
  const elements = useStateNode.id.elements ?? [];
  const candidate = elements[0] ?? elements[1];
  if (!candidate) return null;
  return isNodeOfType(candidate, "Identifier") ? candidate.name : null;
};

export const noDerivedState = defineRule({
  id: "no-derived-state",
  title: "Derived value copied into state",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Work out the value while rendering (or with useMemo if it's expensive) instead of copying it into useState through a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;

        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        // A value measured from the DOM / a ref / a browser global can't be
        // "worked out while rendering" — the element isn't mounted yet. This
        // is a deferred measurement, not a derived value copied into state.
        if (readsPostMountValue(callExpr)) continue;
        const useStateNode = getUseStateDecl(analysis, ref);
        const stateName = getStateNameForUseStateDecl(useStateNode) ?? "<state>";

        const argsUpstreamRefs = getArgsUpstreamRefs(analysis, ref);
        const depsUpstreamRefs: Reference[] = depsRefs.flatMap((depRef) =>
          getUpstreamRefs(analysis, depRef),
        );

        // Initial-only / default / seed prop pattern. When the
        // setter receives EXACTLY one arg that IS a bare prop
        // identifier whose name signals init-only intent
        // (`initialValue`, `defaultX`, `seedY`, etc.), the consumer
        // is intentionally re-syncing on a controlled-init prop —
        // `useState(initialValue) + useEffect(() => setX(initialValue), [initialValue])`
        // to rebind on explicit "reset". Strict shape: avoids
        // `.every([]) === true` and AST-shape false-positives.
        if (isInitialOnlySetterCall(callExpr)) continue;

        // Controlled/uncontrolled value mirror: a bare-prop setter argument
        // whose setter is wired into a JSX event-handler attribute
        // (`onChange={setValue}` / `onChange={(e) => setValue(e.target.value)}`).
        // See `is-controlled-prop-mirror.ts` for the full discriminator.
        if (isControlledPropMirror(node, callExpr)) continue;

        if (isAccumulatingFunctionalUpdater(analysis, callExpr)) continue;

        const isSomeArgsInternal = argsUpstreamRefs.some(
          (argRef) => isState(analysis, argRef) || isProp(analysis, argRef),
        );

        const isAllArgsInDeps =
          argsUpstreamRefs.length > 0 &&
          argsUpstreamRefs.every((argRef) =>
            depsUpstreamRefs.some((depRef) => argRef.resolved === depRef.resolved),
          );
        const isValueAlwaysInSync = isAllArgsInDeps && countSetterCallSites(ref) === 1;

        if (isSomeArgsInternal) {
          context.report({
            node: callExpr,
            message: `Storing "${stateName}" in state when you can derive it from other values costs an extra render.`,
          });
        } else if (isValueAlwaysInSync) {
          context.report({
            node: callExpr,
            message: `"${stateName}" is only set here from other values, so storing it costs an extra render.`,
          });
        }
      }
    },
  }),
});

// `setX(initialValue)` — sole argument is a bare identifier whose name
// signals the consumer's controlled-init / reset intent.
const isInitialOnlySetterCall = (callExpr: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  const arg = args[0] as EsTreeNode;
  if (!isNodeOfType(arg, "Identifier")) return false;
  return isInitialOnlyPropName(arg.name);
};
