import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

export const r3fNoAsyncUseFrame = defineRule({
  id: "r3f-no-async-use-frame",
  title: "Async useFrame callback",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Keep useFrame synchronous; start asynchronous work outside the render loop and consume its completed state from the callback",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!isFunctionLike(callback) || !callback.async) return;
      context.report({
        node: callback,
        message:
          "useFrame receives an ignored Promise from this callback, so thrown errors become unhandled rejections and awaited work can overlap across frames. Keep the frame callback synchronous",
      });
    },
  }),
});
