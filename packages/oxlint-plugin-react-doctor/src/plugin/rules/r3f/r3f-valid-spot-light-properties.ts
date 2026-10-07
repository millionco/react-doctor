import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  SPOT_LIGHT_ANGLE_ARGUMENT_INDEX,
  SPOT_LIGHT_PENUMBRA_ARGUMENT_INDEX,
} from "./constants.js";
import { getInvalidSpotLightProperty } from "./utils/get-invalid-spot-light-property.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const reportInvalidProperty = (
  propertyName: string,
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): void => {
  if (!expression) return;
  const value = getStaticNumber(expression, context.scopes);
  if (value === null) return;
  const invalidProperty = getInvalidSpotLightProperty(propertyName, value, expression);
  if (invalidProperty)
    context.report({ node: invalidProperty.node, message: invalidProperty.message });
};

export const r3fValidSpotLightProperties = defineRule({
  id: "r3f-valid-spot-light-properties",
  title: "Invalid R3F spotlight cone",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Keep spotlight angle in (0, Math.PI / 2] and penumbra in [0, 1]",
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
          node.name.name !== "spotLight" ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const argsExpression = getJsxAttributeExpression(node, "args");
        const argumentsList =
          argsExpression && isNodeOfType(argsExpression, "ArrayExpression")
            ? argsExpression.elements
            : [];
        const angleExpression = getJsxAttributeExpression(node, "angle");
        const penumbraExpression = getJsxAttributeExpression(node, "penumbra");
        reportInvalidProperty(
          "angle",
          angleExpression === undefined
            ? argumentsList[SPOT_LIGHT_ANGLE_ARGUMENT_INDEX]
            : angleExpression,
          context,
        );
        reportInvalidProperty(
          "penumbra",
          penumbraExpression === undefined
            ? argumentsList[SPOT_LIGHT_PENUMBRA_ARGUMENT_INDEX]
            : penumbraExpression,
          context,
        );
      },
    };
  },
});
