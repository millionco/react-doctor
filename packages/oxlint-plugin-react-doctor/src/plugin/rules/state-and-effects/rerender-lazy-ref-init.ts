import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Sister rule to `rerender-lazy-state-init`. `useRef` is even less
// forgiving than `useState`: it does NOT accept a lazy initializer
// callback. If you write `useRef(expensiveCall())`, the expensive
// call runs on EVERY render and its result is silently discarded
// after the first one. The fix is the classic lazy-ref pattern:
//
//   const ref = useRef<T | null>(null);
//   if (ref.current === null) ref.current = expensiveCall();
//
// or `useMemo(() => expensiveCall(), [])` when the value can be
// recomputed on remount safely.
//
// Covers two initializer shapes:
//   - `useRef(callee())`         — plain call (the function/method case)
//   - `useRef(new Callee())`     — `new` expression (the class case)
//
// Both allocate fresh per render and lose the allocation immediately
// after the first render. The `new AbortController()` / `new Map()` /
// `new Set()` patterns are the most common production occurrences of
// this bug and are exactly what the rule should catch.
//
// LIMITATIONS:
//   - Doesn't try to follow identifier bindings (`const init = expensiveCall();
//     useRef(init)`) — that's a separate (rare) pattern.
//   - Trivial wrappers (`Number`, `String`, `Array`, `Boolean`,
//     `parseInt`, `parseFloat`) are exempt because they're essentially
//     free — same exemption list as `rerender-lazy-state-init`.
export const rerenderLazyRefInit = defineRule<Rule>({
  id: "rerender-lazy-ref-init",
  title: "Ref initializer runs on every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Initialize the ref lazily so expensive values are not rebuilt and discarded on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useRef") || !node.arguments?.length) return;
      const initializer = node.arguments[0];

      const isPlainCall = isNodeOfType(initializer, "CallExpression");
      const isNewCall = isNodeOfType(initializer, "NewExpression");
      if (!isPlainCall && !isNewCall) return;

      const callee = initializer.callee;
      const memberPropertyName =
        isNodeOfType(callee, "MemberExpression") &&
        (isNodeOfType(callee.property, "Identifier") ||
          isNodeOfType(callee.property, "PrivateIdentifier"))
          ? callee.property.name
          : null;
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : (memberPropertyName ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;

      // `useRef(useId())` / `useRef(useContext(Ctx))` captures another
      // hook's value. The result is already stable per the rules of
      // hooks, and the lazy-init fix this rule suggests
      // (`if (ref.current === null) ref.current = useId()`) would call
      // a hook conditionally — illegal. Skip hook-shaped callees.
      if (isPlainCall && isReactHookName(calleeName)) return;

      const callShape = isNewCall ? `new ${calleeName}()` : `${calleeName}()`;

      context.report({
        node: initializer,
        message: `useRef(${callShape}) rebuilds this value on every render & throws it away.`,
      });
    },
  }),
});
