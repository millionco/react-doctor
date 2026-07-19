import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { resolveR3fJsxEventHandler } from "./utils/resolve-r3f-jsx-event-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";
import {
  isGuardedStateTransition,
  resolveStateSetterBinding,
} from "./r3f-no-state-in-use-frame.js";

export const r3fNoStateInPointerMove = defineRule({
  id: "r3f-no-state-in-pointer-move",
  title: "React state update inside an R3F pointer-move handler",
  severity: "warn",
  recommendation:
    "Keep pointer-move previews in Three.js refs or transient state and publish one semantic React update when the interaction commits",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const callback = resolveR3fJsxEventHandler(node, "onPointerMove", context);
        if (!callback) return;
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !resolveStateSetterBinding(candidate.callee, context.scopes) ||
            isGuardedStateTransition(candidate, callback, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This React state update can render on every pointer movement. Keep the preview in a ref or transient store and publish one semantic update on pointer-up",
          });
        });
      },
    };
  },
});
