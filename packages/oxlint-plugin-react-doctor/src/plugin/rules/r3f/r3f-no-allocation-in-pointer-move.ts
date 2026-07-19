import { defineRule } from "../../utils/define-rule.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fJsxEventHandler } from "./utils/resolve-r3f-jsx-event-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const ALLOCATABLE_EVENT_PROPERTIES: ReadonlySet<string> = new Set([
  "eventObject",
  "normal",
  "object",
  "point",
  "ray",
  "uv",
]);

const hasR3fEventObjectProvenance = (
  expression: EsTreeNode,
  handler: EsTreeNode,
  context: RuleContext,
): boolean => {
  let candidate = stripParenExpression(expression);
  while (true) {
    for (const propertyName of ALLOCATABLE_EVENT_PROPERTIES) {
      if (isR3fCallbackStateProperty(candidate, handler, propertyName, context.scopes)) return true;
    }
    if (!isNodeOfType(candidate, "MemberExpression")) return false;
    candidate = stripParenExpression(candidate.object);
  }
};

export const r3fNoAllocationInPointerMove = defineRule({
  id: "r3f-no-allocation-in-pointer-move",
  title: "Allocation inside an R3F pointer-move handler",
  severity: "warn",
  recommendation:
    "Reuse component-owned vectors and Three.js objects while handling pointer movement",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const handler = resolveR3fJsxEventHandler(node, "onPointerMove", context);
        if (!handler) return;
        walkFunctionExecution(handler, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted) return;
          if (isNodeOfType(candidate, "NewExpression")) {
            context.report({
              node: candidate,
              message:
                "This constructor allocates on every pointer movement. Reuse an object created outside the handler",
            });
            return;
          }
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            getStaticPropertyName(candidate.callee) !== "clone" ||
            !hasR3fEventObjectProvenance(candidate.callee.object, handler, context)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This clone allocates a Three.js object on every pointer movement. Copy into a reusable object instead",
          });
        });
      },
    };
  },
});
