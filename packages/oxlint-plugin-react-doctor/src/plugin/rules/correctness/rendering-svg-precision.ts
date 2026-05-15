import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SVG_PATH_HIGH_PRECISION_PATTERN = /\d+\.\d{4,}/;

const SVG_PATH_ATTRIBUTES = new Set(["d", "points", "transform"]);

// HACK: SVG path strings with 4+ decimals (e.g. `M 10.293847 20.847362`)
// add bytes for sub-pixel precision the user can't see. Most editors
// emit these by default; truncating to 1–2 decimals trims 30–50% off
// markup with no visible difference.
export const renderingSvgPrecision = defineRule<Rule>({
  id: "rendering-svg-precision",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Truncate path/points/transform decimals to 1–2 digits — sub-pixel precision adds bytes with no visible difference",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (!SVG_PATH_ATTRIBUTES.has(node.name.name)) return;
      if (!isNodeOfType(node.value, "Literal")) return;
      const value = node.value.value;
      if (typeof value !== "string") return;
      if (!SVG_PATH_HIGH_PRECISION_PATTERN.test(value)) return;

      context.report({
        node,
        message: `SVG ${node.name.name} attribute uses 4+ decimal precision — truncate to 1–2 decimals to shrink markup with no visible difference`,
      });
    },
  }),
});
