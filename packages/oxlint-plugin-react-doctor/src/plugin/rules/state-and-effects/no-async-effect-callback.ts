import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  "The `useEffect` callback is `async`, so it returns a Promise instead of a cleanup function. React calls that Promise as cleanup (a no-op) and the effect can race on unmount. Put the async work in an inner function and call it.";

// An async effect callback returns a Promise. React expects the effect's
// return value to be either `undefined` or a cleanup function, so the Promise
// is silently ignored — the real cleanup never runs and state can be set after
// unmount. The fix is to declare an inner async function and invoke it.
export const noAsyncEffectCallback = defineRule({
  id: "no-async-effect-callback",
  title: "Async effect callback",
  severity: "warn",
  recommendation:
    "Don't make the effect callback `async`. Define an async function inside the effect and call it, then return a real cleanup function if you need one.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      ) {
        return;
      }
      if (!callback.async) return;
      context.report({ node: callback, message: MESSAGE });
    },
  }),
});
