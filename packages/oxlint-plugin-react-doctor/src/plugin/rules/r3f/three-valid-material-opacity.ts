import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { MAXIMUM_MATERIAL_OPACITY, MINIMUM_MATERIAL_OPACITY } from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const reportInvalidOpacity = (expression: EsTreeNode, context: RuleContext): void => {
  const opacity = getStaticNumber(expression, context.scopes);
  if (
    opacity === null ||
    (opacity >= MINIMUM_MATERIAL_OPACITY && opacity <= MAXIMUM_MATERIAL_OPACITY)
  ) {
    return;
  }
  context.report({
    node: expression,
    message: `Material opacity is ${String(opacity)}, but Three.js opacity uses the normalized [0, 1] range`,
  });
};

export const threeValidMaterialOpacity = defineRule({
  id: "three-valid-material-opacity",
  title: "Three.js material opacity outside its normalized range",
  category: "Correctness",
  severity: "warn",
  recommendation: "Keep material opacity in the normalized [0, 1] range",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        !provenance?.apiName.endsWith("Material") ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !parameters ||
        !isNodeOfType(parameters, "ObjectExpression") ||
        parameters.properties.some((property) => isNodeOfType(property, "SpreadElement"))
      ) {
        return;
      }
      const opacityExpression = getStaticObjectPropertyValue(parameters, "opacity");
      if (!opacityExpression) return;
      reportInvalidOpacity(opacityExpression, context);
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.propertyName !== "opacity" ||
        !assignment.constructorName.endsWith("Material")
      ) {
        return;
      }
      reportInvalidOpacity(assignment.value, context);
    },
  }),
});
