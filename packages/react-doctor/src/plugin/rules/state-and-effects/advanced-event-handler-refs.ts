import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `useEffect(() => { window.addEventListener(name, handler);
// return () => window.removeEventListener(name, handler); }, [handler])`
// is the canonical "I want the latest handler" anti-pattern: every time
// the parent re-renders with a new `handler` prop, the effect tears
// down and re-subscribes. This thrashes the listener for no reason —
// the subscription itself doesn't change, only the function it points
// to. Store the handler in a ref (`handlerRef.current = handler` in a
// separate effect or a layout effect) and have the registered listener
// read `handlerRef.current()`, then take `handler` out of the deps.
//
// Heuristic: useEffect whose dep array contains an identifier (must be
// a function-typed prop or local in practice — we approximate by
// requiring it to also appear as the second argument to
// `addEventListener`/`subscribe`-shaped calls inside the effect body).
// The shared `SUBSCRIPTION_METHOD_NAMES` set comes from `constants.ts`
// so this rule and `prefer-use-sync-external-store` agree on what
// counts as a subscription-shaped call (zustand/Redux `subscribe`,
// browser `addEventListener`, EventEmitter `on`, etc.).
export const advancedEventHandlerRefs = defineRule<Rule>({
  id: "advanced-event-handler-refs",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Store the handler in a ref and have the listener read `handlerRef.current()` — the subscription stays put while the latest handler is always called",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      if ((node.arguments?.length ?? 0) < 2) return;
      const callback = getEffectCallback(node);
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      )
        return;
      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

      const depIdentifierNames = new Set<string>();
      for (const element of depsNode.elements) {
        if (isNodeOfType(element, "Identifier")) depIdentifierNames.add(element.name);
      }
      if (depIdentifierNames.size === 0) return;

      // Look for an addEventListener (etc.) call inside the body whose
      // second argument is one of our deps.
      let registeredHandlerName: string | null = null;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (registeredHandlerName) return;
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isNodeOfType(child.callee, "MemberExpression")) return;
        if (!isNodeOfType(child.callee.property, "Identifier")) return;
        if (!SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)) return;
        const handlerArg = child.arguments?.[1];
        if (!isNodeOfType(handlerArg, "Identifier")) return;
        if (depIdentifierNames.has(handlerArg.name)) {
          registeredHandlerName = handlerArg.name;
        }
      });

      if (registeredHandlerName) {
        context.report({
          node,
          message: `useEffect re-subscribes a "${registeredHandlerName}" listener every time the handler identity changes — store the handler in a ref and have the listener read \`handlerRef.current()\`, then drop it from the deps`,
        });
      }
    },
  }),
});
