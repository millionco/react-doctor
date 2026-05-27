import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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
// Detection mirrors `rerender-lazy-state-init`:
//   - The first argument to `useRef` is a `CallExpression`.
//   - The callee isn't a trivial wrapper (`Number`, `String`, `Array`,
//     `Boolean`, `parseInt`, …) — those are essentially free.
//
// LIMITATIONS:
//   - Doesn't try to follow identifier bindings (`const init = expensiveCall();
//     useRef(init)`) — that's a separate (rare) pattern.
//   - Doesn't model `new MyClass()` because `useRef(new Foo())` is sometimes
//     intentional (the class instance is the ref's stable target). Allocation
//     detection lives in `jsx-no-new-*-as-prop`-family rules.
export const rerenderLazyRefInit = defineRule<Rule>({
  id: "rerender-lazy-ref-init",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Initialize lazily: `const ref = useRef<T | null>(null); if (ref.current === null) ref.current = expensiveCall();`",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useRef") || !node.arguments?.length) return;
      const initializer = node.arguments[0];
      if (!isNodeOfType(initializer, "CallExpression")) return;

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

      context.report({
        node: initializer,
        message: `useRef(${calleeName}()) calls the initializer on every render — useRef has no lazy-init form. Use \`const ref = useRef(null); if (ref.current === null) ref.current = ${calleeName}();\` or \`useMemo\` instead.`,
      });
    },
  }),
});
