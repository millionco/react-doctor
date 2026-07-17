import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isGlobalNanValue } from "../../utils/is-global-nan-value.js";

// Hooks whose tail (or trailing) argument is an explicit dependency array.
// Notably excludes `@preact/signals`'s `useSignalEffect(callback)` — it
// auto-tracks signal reads inside the callback and accepts no second
// argument. Including it here would have us linting a non-existent
// position; users writing `useSignalEffect(fn, [NaN])` are passing an
// argument the hook silently ignores.
const HOOKS_WITH_DEP_ARRAY = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
]);

const NAN_MESSAGE =
  "`NaN` in a dependency array never compares as changed with `Object.is`, so normalize the value before passing it as a dependency.";

// Mirrors the runtime check in `preact/debug/src/debug.js`:
//   if (isNaN(arg)) {
//     console.warn(`Invalid argument passed to hook. Hooks should not be
//                  called with NaN in the dependency array. ...`);
//   }
// Lifts the warning to authoring time on the literal `NaN` and
// `Number.NaN` shapes (the dynamic `Number(input) === NaN` case still
// needs runtime support — but those cases are exactly what motivate
// guarding the static-literal pattern: if you've typed `NaN` directly,
// it's nearly always a stand-in placeholder that should never have
// landed there).
//
// Covers every standard hook whose tail argument is a dep array:
// `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useCallback`,
// `useMemo`, and `useImperativeHandle` (deps at index 2 — its signature
// is `useImperativeHandle(ref, factory, deps)`). Preact's
// `useSignalEffect` is intentionally excluded: its signature is
// `useSignalEffect(callback)` with no deps argument; signal reads
// inside the callback auto-track, so there's no array to inspect.
export const hooksNoNanInDeps = defineRule({
  id: "hooks-no-nan-in-deps",
  title: "NaN in a hook dependency array",
  severity: "warn",
  recommendation:
    "Remove `NaN` (or `Number.NaN`) from the dependency array. If a value can be NaN at runtime, normalise it (`Number.isNaN(x) ? 0 : x`) before passing it.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, HOOKS_WITH_DEP_ARRAY, context.scopes)) return;
      const depsIndex = isReactHookCall(node, "useImperativeHandle", context.scopes) ? 2 : 1;
      const depsArgument = node.arguments[depsIndex];
      if (!depsArgument || !isNodeOfType(depsArgument, "ArrayExpression")) return;
      for (const element of depsArgument.elements) {
        if (!element) continue;
        if (isGlobalNanValue(element, context.scopes)) {
          context.report({ node: element, message: NAN_MESSAGE });
        }
      }
    },
  }),
});
