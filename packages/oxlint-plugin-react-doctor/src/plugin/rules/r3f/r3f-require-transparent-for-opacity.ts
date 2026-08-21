import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isMaterialOpacityIgnored } from "./utils/is-material-opacity-ignored.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { isThreeMaterialTransparentByDefault } from "./utils/is-three-material-transparent-by-default.js";
import { readStaticJsxBooleanAttribute } from "./utils/read-static-jsx-boolean-attribute.js";

const readStaticJsxNumberAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  context: RuleContext,
): number | null | undefined => {
  if (!attribute) return undefined;
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return getStaticNumber(attribute.value.expression, context.scopes);
};

const readOptionalStaticJsxBooleanAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): boolean | null | undefined => (attribute ? readStaticJsxBooleanAttribute(attribute) : undefined);

export const r3fRequireTransparentForOpacity = defineRule({
  id: "r3f-require-transparent-for-opacity",
  title: "R3F material opacity is ignored",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Enable transparent, alphaHash, or alphaTest when a material opacity below 1 should affect rendering",
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
          isThreeMaterialTransparentByDefault(elementType) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const opacityAttribute = getAuthoritativeJsxAttribute(node.attributes, "opacity");
        if (!opacityAttribute) return;
        if (
          !isMaterialOpacityIgnored({
            alphaHash: readOptionalStaticJsxBooleanAttribute(
              getAuthoritativeJsxAttribute(node.attributes, "alphaHash"),
            ),
            alphaTest: readStaticJsxNumberAttribute(
              getAuthoritativeJsxAttribute(node.attributes, "alphaTest"),
              context,
            ),
            opacity: readStaticJsxNumberAttribute(opacityAttribute, context),
            transparent: readOptionalStaticJsxBooleanAttribute(
              getAuthoritativeJsxAttribute(node.attributes, "transparent"),
            ),
          })
        ) {
          return;
        }
        context.report({
          node: opacityAttribute,
          message:
            "This material sets opacity below 1 without transparent, alphaHash, or alphaTest, so the opacity does not make the surface translucent",
        });
      },
    };
  },
});
