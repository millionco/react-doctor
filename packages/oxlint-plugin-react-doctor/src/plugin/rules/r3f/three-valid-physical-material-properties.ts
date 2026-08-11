import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES,
  PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getInvalidPhysicalMaterialProperty } from "./utils/get-invalid-physical-material-property.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const PHYSICAL_MATERIAL_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  ...PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES,
  ...PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES,
]);

const reportInvalidProperty = (
  propertyName: string,
  expression: EsTreeNode,
  context: RuleContext,
): void => {
  const value = getStaticNumber(expression, context.scopes);
  if (value === null) return;
  const invalidProperty = getInvalidPhysicalMaterialProperty(propertyName, value, expression);
  if (!invalidProperty) return;
  context.report({
    node: expression,
    message: `${propertyName} is ${String(value)}, but MeshPhysicalMaterial requires ${propertyName} in [${String(invalidProperty.minimum)}, ${String(invalidProperty.maximum)}]`,
  });
};

export const threeValidPhysicalMaterialProperties = defineRule({
  id: "three-valid-physical-material-properties",
  title: "Invalid Three.js physical material property",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Keep MeshPhysicalMaterial layer strengths and indices of refraction in their documented ranges",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        provenance?.apiName !== "MeshPhysicalMaterial" ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !parameters
      ) {
        return;
      }
      for (const propertyName of PHYSICAL_MATERIAL_PROPERTY_NAMES) {
        const expression = getStaticObjectPropertyValue(parameters, propertyName);
        if (expression) reportInvalidProperty(propertyName, expression, context);
      }
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.constructorName !== "MeshPhysicalMaterial" ||
        !PHYSICAL_MATERIAL_PROPERTY_NAMES.has(assignment.propertyName)
      ) {
        return;
      }
      reportInvalidProperty(assignment.propertyName, assignment.value, context);
    },
  }),
});
