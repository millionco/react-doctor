import { containsNonDeterministicSource } from "../../utils/contains-non-deterministic-source.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  isMeasurementMemberRead,
  isPostMountGlobalRead,
} from "../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getCallExpr } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isStateSetter,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// Storage globals (`localStorage.getItem(...)` → setter) are deliberately NOT
// measurement sources: a storage-seeded init is still the init-in-an-effect
// smell (the read is synchronous and cheap), whereas a DOM/layout measurement
// genuinely cannot exist before mount.
const MEASUREMENT_GLOBAL_NAMES: ReadonlySet<string> = new Set(["window", "document", "navigator"]);

const findEffectLocalInitializer = (effectFn: EsTreeNode, name: string): EsTreeNode | null => {
  let initializer: EsTreeNode | null = null;
  walkAst(effectFn, (child: EsTreeNode): boolean | void => {
    if (initializer) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === name &&
      child.init
    ) {
      initializer = child.init as EsTreeNode;
      return false;
    }
  });
  return initializer;
};

// A measurement-global identifier only defers state init when it feeds a DOM
// API CALL (`window.matchMedia(...)`, `document.querySelector(...)`): the call
// returns a live runtime object that has no render-time equivalent. A plain
// scalar property read (`window.innerWidth`) is hoistable into a lazy
// `useState(() => window.innerWidth)` initializer, so it keeps the
// init-in-an-effect smell.
const isMeasurementApiCallReceiver = (identifier: EsTreeNode): boolean => {
  const memberParent = identifier.parent;
  if (!isNodeOfType(memberParent, "MemberExpression") || memberParent.object !== identifier) {
    return false;
  }
  const callGrandparent = memberParent.parent;
  return isNodeOfType(callGrandparent, "CallExpression") && callGrandparent.callee === memberParent;
};

// Does the setter argument derive from a DOM/layout measurement — directly
// (`setShowThumb(viewportRef.current.scrollHeight > 0)`) or through an
// effect-local variable (`const mq = window.matchMedia(...); setMode(mq.matches
// ? "dark" : "light")`)? Such values can't be hoisted into `useState(initial)`
// (the element isn't mounted; the API object has no render-time equivalent),
// so the mount effect is the correct home for them.
const argumentReadsPostMountMeasurement = (
  argument: EsTreeNode,
  effectFn: EsTreeNode,
  visitedLocalNames: Set<string> = new Set(),
): boolean => {
  let found = false;
  walkAst(argument, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (isMeasurementMemberRead(child)) {
      found = true;
      return false;
    }
    if (!isNodeOfType(child, "Identifier")) return;
    if (
      isPostMountGlobalRead(child) &&
      MEASUREMENT_GLOBAL_NAMES.has(child.name) &&
      isMeasurementApiCallReceiver(child)
    ) {
      found = true;
      return false;
    }
    if (visitedLocalNames.has(child.name)) return;
    visitedLocalNames.add(child.name);
    const localInitializer = findEffectLocalInitializer(effectFn, child.name);
    if (
      localInitializer &&
      argumentReadsPostMountMeasurement(localInitializer, effectFn, visitedLocalNames)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// 1:1 port of upstream `src/rules/no-initialize-state.js`.
// Difference vs upstream: upstream uses `context.sourceCode.getText`
// for the diagnostic's "arguments" field; we use
// `stringifyExpressionSnippet` since oxlint plugins don't expose
// source text. Output text matches upstream byte-for-byte on the
// canonical literal / identifier / call shapes; falls back to
// `<expression>` for complex inputs.

export const noInitializeState = defineRule({
  id: "no-initialize-state",
  title: "State initialized from a mount effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the initial value directly to useState() instead of setting it from a mount-only useEffect. For SSR hydration, prefer useSyncExternalStore().",
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

      const isEffectRunOnlyOnMount =
        depsRefs.filter((ref) => !isStateSetter(analysis, ref)).length === 0;
      if (!isEffectRunOnlyOnMount) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
        // A non-deterministic source (`crypto.randomUUID()`, `Math.random()`,
        // `Date.now()`, an id generator, …) can't be a deterministic
        // `useState(initial)` argument and is SSR-unsafe, so deferring it to a
        // mount effect is the correct pattern, not an init smell.
        if (
          callExpr.arguments?.some(
            (argument) => Boolean(argument) && containsNonDeterministicSource(argument),
          )
        ) {
          continue;
        }
        if (
          callExpr.arguments?.some(
            (argument) =>
              Boolean(argument) && argumentReadsPostMountMeasurement(argument, effectFn),
          )
        ) {
          continue;
        }
        const useStateDecl = getUseStateDecl(analysis, ref);
        if (!useStateDecl || !isNodeOfType(useStateDecl, "VariableDeclarator")) continue;
        if (!isNodeOfType(useStateDecl.id, "ArrayPattern")) continue;
        const elements = useStateDecl.id.elements ?? [];
        const stateBinding = elements[0] ?? elements[1];
        const stateName =
          stateBinding && isNodeOfType(stateBinding, "Identifier") ? stateBinding.name : "<state>";
        context.report({
          node: callExpr,
          message: `Your users see an extra render with empty "${stateName}" because a useEffect sets its starting value.`,
        });
      }
    },
  }),
});
