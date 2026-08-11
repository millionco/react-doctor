import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { RAYCASTER_FAR_ARGUMENT_INDEX, RAYCASTER_NEAR_ARGUMENT_INDEX } from "./constants.js";
import { getInvalidRaycasterParameter } from "./utils/get-invalid-raycaster-parameter.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";

interface StaticR3fRaycasterParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

const getStaticParameter = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): StaticR3fRaycasterParameter | null => {
  if (!expression || isNodeOfType(expression, "SpreadElement")) return null;
  const value = getStaticNumber(expression, context.scopes);
  return value === null ? null : { node: expression, value };
};

export const r3fValidRaycasterRange = defineRule({
  id: "r3f-valid-raycaster-range",
  title: "Invalid R3F raycaster distance range",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Keep raycaster near nonnegative and far greater than or equal to near",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        let nearExpression: EsTreeNode | null | undefined;
        let farExpression: EsTreeNode | null | undefined;
        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "raycaster") {
          const argsExpression = getJsxAttributeExpression(node, "args");
          const argumentsList =
            argsExpression && isNodeOfType(argsExpression, "ArrayExpression")
              ? argsExpression.elements
              : [];
          nearExpression = getJsxAttributeExpression(node, "near");
          farExpression = getJsxAttributeExpression(node, "far");
          if (nearExpression === undefined)
            nearExpression = argumentsList[RAYCASTER_NEAR_ARGUMENT_INDEX];
          if (farExpression === undefined)
            farExpression = argumentsList[RAYCASTER_FAR_ARGUMENT_INDEX];
        } else if (isR3fCanvas(node, context)) {
          const raycasterExpression = getJsxAttributeExpression(node, "raycaster");
          if (!raycasterExpression || !isNodeOfType(raycasterExpression, "ObjectExpression"))
            return;
          nearExpression = getStaticObjectPropertyValue(raycasterExpression, "near");
          farExpression = getStaticObjectPropertyValue(raycasterExpression, "far");
        } else {
          return;
        }
        const invalidParameter = getInvalidRaycasterParameter(
          getStaticParameter(nearExpression, context),
          getStaticParameter(farExpression, context),
        );
        if (invalidParameter)
          context.report({ node: invalidParameter.node, message: invalidParameter.message });
      },
    };
  },
});
