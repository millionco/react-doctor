import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { MAXIMUM_MATERIAL_OPACITY, MINIMUM_MATERIAL_OPACITY } from "./constants.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

export const r3fValidMaterialOpacity = defineRule({
  id: "r3f-valid-material-opacity",
  title: "R3F material opacity outside its normalized range",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Keep material opacity in the normalized [0, 1] range",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementType = resolveJsxElementType(node);
        if (
          !importsReactThreeFiber ||
          !isR3fHostIntrinsic(node) ||
          !elementType?.endsWith("Material") ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const opacityAttribute = getAuthoritativeJsxAttribute(node.attributes, "opacity");
        if (
          !opacityAttribute?.value ||
          !isNodeOfType(opacityAttribute.value, "JSXExpressionContainer") ||
          isNodeOfType(opacityAttribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const opacity = getStaticNumber(opacityAttribute.value.expression, context.scopes);
        if (
          opacity === null ||
          (opacity >= MINIMUM_MATERIAL_OPACITY && opacity <= MAXIMUM_MATERIAL_OPACITY)
        ) {
          return;
        }
        context.report({
          node: opacityAttribute,
          message: `Material opacity is ${String(opacity)}, but Three.js opacity uses the normalized [0, 1] range`,
        });
      },
    };
  },
});
