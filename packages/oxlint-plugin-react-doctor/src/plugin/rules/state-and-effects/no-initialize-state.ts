import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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

// 1:1 port of upstream `src/rules/no-initialize-state.js`.
// Difference vs upstream: upstream uses `context.sourceCode.getText`
// for the diagnostic's "arguments" field; we use
// `stringifyExpressionSnippet` since oxlint plugins don't expose
// source text. Output text matches upstream byte-for-byte on the
// canonical literal / identifier / call shapes; falls back to
// `<expression>` for complex inputs.

// DOM/layout reads + globals that are NOT knowable at render time: a
// `useState` lazy initializer runs during render, before the element is
// mounted, so a value measured from the live DOM (or read off a ref's
// `.current`, still `null` on first render) genuinely cannot be hoisted.
// The rule's premise ("pass the value to useState() directly") only holds
// for render-time-knowable values, so these setter args must not fire.
const POST_MOUNT_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "current",
  "scrollWidth",
  "clientWidth",
  "offsetWidth",
  "scrollHeight",
  "clientHeight",
  "offsetHeight",
  "scrollTop",
  "scrollLeft",
  "offsetTop",
  "offsetLeft",
  "innerWidth",
  "innerHeight",
  "getBoundingClientRect",
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "getElementsByClassName",
  "getElementsByTagName",
  "matchMedia",
]);

// Browser globals that are absent / inconsistent during SSR render, so a
// `useState` initializer reading them would hydrate-mismatch; the value is
// deliberately deferred to a mount effect, which is correct (not hoistable).
const POST_MOUNT_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "document",
  "window",
  "localStorage",
  "sessionStorage",
  "navigator",
]);

// The setter argument is often not the post-mount read itself — the effect
// reads `localStorage` / `matchMedia` / a `ref.current` / a DOM measurement
// into a local variable (or a helper / wrapper function) and then hands that
// derived value to the setter (e.g. `const saved = read(KEY); setStore(saved)`,
// `updateThumb()` measuring `viewportRef.current`, `setMode(scheme())` reading
// `document`). Scanning only the setter's direct arguments misses all of those,
// so we scan the entire mount-effect body: if it touches any post-mount source
// anywhere, the values it sets are not render-time-knowable and cannot be
// hoisted into the useState initializer without an SSR hydration mismatch.
const readsPostMountValue = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      POST_MOUNT_MEMBER_NAMES.has(child.property.name)
    ) {
      found = true;
      return false;
    }
    if (isNodeOfType(child, "Identifier") && POST_MOUNT_GLOBAL_NAMES.has(child.name)) {
      found = true;
      return false;
    }
  });
  return found;
};

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

      if (readsPostMountValue(effectFn)) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
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
