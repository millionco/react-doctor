import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { GPU_LINE_WIDTH_PX } from "./constants.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const R3F_GPU_LINE_MATERIAL_NAMES: ReadonlySet<string> = new Set([
  "lineBasicMaterial",
  "lineDashedMaterial",
]);

export const r3fNoIgnoredLinewidth = defineRule({
  id: "r3f-no-ignored-linewidth",
  title: "R3F GPU renderer ignores line width",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Use Drei Line for wide GPU-rendered lines, or leave linewidth at one pixel",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          !R3F_GPU_LINE_MATERIAL_NAMES.has(node.name.name) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const attribute = getAuthoritativeJsxAttribute(node.attributes, "linewidth");
        if (
          !attribute?.value ||
          !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
          isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const value = getStaticNumber(attribute.value.expression, context.scopes);
        if (value === null || value === GPU_LINE_WIDTH_PX) return;
        context.report({
          node: attribute,
          message: `linewidth ${String(value)} is ignored by Three.js WebGL and WebGPU renderers, which render line primitives one pixel wide`,
        });
      },
    };
  },
});
