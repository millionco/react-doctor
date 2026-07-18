import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const r3fNoNewInUseFrame = defineRule({
  id: "r3f-no-new-in-use-frame",
  title: "Allocation inside useFrame",
  severity: "warn",
  recommendation:
    "Allocate Three.js objects once in module scope, useMemo, or useRef and mutate the reusable instance inside useFrame",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!callback) return;
      walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
        if (candidate.type !== "NewExpression" || isConditionallyExecuted) return;
        context.report({
          node: candidate,
          message:
            "This constructor allocates a new object every executed frame. Reuse an object allocated outside useFrame and mutate it in place",
        });
      });
    },
  }),
});
