import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const CLOCK_METHODS = new Set(["getDelta", "getElapsedTime"]);

export const r3fNoAdvancingClockInUseFrame = defineRule({
  id: "r3f-no-advancing-clock-in-use-frame",
  title: "Clock advanced inside useFrame",
  category: "Correctness",
  disabledWhen: ["r3f:10"],
  severity: "warn",
  recommendation:
    "Use the delta argument supplied to useFrame or read clock.elapsedTime without advancing the shared clock",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = resolveR3fCallback(node, "useFrame", context.scopes);
      if (!callback) return;
      walkFunctionExecution(callback, context.scopes, (candidate) => {
        if (
          !isNodeOfType(candidate, "CallExpression") ||
          !isNodeOfType(candidate.callee, "MemberExpression") ||
          !CLOCK_METHODS.has(getStaticPropertyName(candidate.callee) ?? "") ||
          !isR3fCallbackStateProperty(candidate.callee.object, callback, "clock", context.scopes)
        ) {
          return;
        }
        context.report({
          node: candidate,
          message:
            "Calling this method advances the shared R3F clock and makes timing depend on callback order. Use the supplied delta argument or clock.elapsedTime",
        });
      });
    },
  }),
});
