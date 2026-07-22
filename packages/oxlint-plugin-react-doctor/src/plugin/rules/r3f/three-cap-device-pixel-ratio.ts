import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isThreeRendererReference } from "./utils/is-three-renderer-reference.js";
import { resolveRawDevicePixelRatio } from "./utils/resolve-raw-device-pixel-ratio.js";

export const threeCapDevicePixelRatio = defineRule({
  id: "three-cap-device-pixel-ratio",
  title: "Unbounded Three.js device pixel ratio",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Cap renderer pixel ratio, commonly at 2, so high-density displays do not multiply GPU work without a bound",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "setPixelRatio" ||
        !isThreeRendererReference(node.callee.object, context.scopes)
      ) {
        return;
      }
      const pixelRatio = node.arguments[0];
      if (!pixelRatio || isNodeOfType(pixelRatio, "SpreadElement")) return;
      const rawPixelRatio = resolveRawDevicePixelRatio(pixelRatio, context.scopes);
      if (!rawPixelRatio) return;
      context.report({
        node: rawPixelRatio,
        message:
          "This renderer uses the device's raw pixel ratio without a cap. Bound the ratio to limit the rendered pixel count on high-density displays",
      });
    },
  }),
});
