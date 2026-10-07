import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES } from "./constants.js";
import { getNeedsUpdateReceiver } from "./utils/get-needs-update-receiver.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isDynamicBufferUsageExpression } from "./utils/is-dynamic-buffer-usage-expression.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

interface BufferUsageConfiguration {
  readonly attributeKey: string;
  readonly isDynamic: boolean;
  readonly node: EsTreeNodeOfType<"CallExpression">;
}

export const threeRequireDynamicBufferUsage = defineRule({
  id: "three-require-dynamic-buffer-usage",
  title: "Per-frame buffer upload keeps static usage",
  category: "Performance",
  severity: "warn",
  recommendation: "Call attribute.setUsage(DynamicDrawUsage) before its first render",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    const usageConfigurations: BufferUsageConfiguration[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          isNodeOfType(node.callee, "MemberExpression") &&
          getStaticPropertyName(node.callee) === "setUsage" &&
          THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES.has(
            getThreeConstructorName(node.callee.object, context.scopes) ?? "",
          )
        ) {
          const usage = node.arguments[0];
          const attributeKey = resolveExpressionKey(node.callee.object, context);
          if (usage && !isNodeOfType(usage, "SpreadElement") && attributeKey) {
            usageConfigurations.push({
              attributeKey,
              isDynamic: isDynamicBufferUsageExpression(usage, context.scopes),
              node,
            });
          }
        }
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (isConditionallyExecuted || !isNodeOfType(candidate, "AssignmentExpression")) return;
          const receiver = getNeedsUpdateReceiver(candidate);
          if (
            !receiver ||
            !THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES.has(
              getThreeConstructorName(receiver, context.scopes) ?? "",
            )
          ) {
            return;
          }
          const attributeKey = resolveExpressionKey(receiver, context);
          const animationStart = getRangeStart(node);
          const hasDynamicUsage = usageConfigurations.some((configuration) => {
            const configurationStart = getRangeStart(configuration.node);
            return (
              configuration.attributeKey === attributeKey &&
              configuration.isDynamic &&
              configurationStart !== null &&
              animationStart !== null &&
              configurationStart < animationStart
            );
          });
          if (hasDynamicUsage) return;
          context.report({
            node: candidate,
            message:
              "This BufferAttribute uploads every animation frame without a prior dynamic or stream usage hint, so Three.js keeps the default StaticDrawUsage allocation strategy",
          });
        });
      },
    };
  },
});
