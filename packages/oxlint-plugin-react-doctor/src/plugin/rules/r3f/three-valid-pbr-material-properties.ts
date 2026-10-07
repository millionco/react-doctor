import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  MAXIMUM_NORMALIZED_MATERIAL_FACTOR,
  MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES,
  MINIMUM_NORMALIZED_MATERIAL_FACTOR,
  PBR_MATERIAL_CONSTRUCTOR_NAMES,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";

const reportInvalidPbrFactor = (
  propertyName: string,
  expression: EsTreeNode,
  context: RuleContext,
): void => {
  const value = getStaticNumber(expression, context.scopes);
  if (
    value === null ||
    (value >= MINIMUM_NORMALIZED_MATERIAL_FACTOR && value <= MAXIMUM_NORMALIZED_MATERIAL_FACTOR)
  ) {
    return;
  }
  context.report({
    node: expression,
    message: `${propertyName} is ${String(value)}, but Three.js PBR material factors use the normalized [0, 1] range`,
  });
};

export const threeValidPbrMaterialProperties = defineRule({
  id: "three-valid-pbr-material-properties",
  title: "Three.js PBR material factor outside its normalized range",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Keep MeshStandardMaterial and MeshPhysicalMaterial roughness and metalness in [0, 1]",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        !provenance ||
        !PBR_MATERIAL_CONSTRUCTOR_NAMES.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !parameters
      ) {
        return;
      }
      for (const propertyName of MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES) {
        const propertyValue = getStaticObjectPropertyValue(parameters, propertyName);
        if (!propertyValue) continue;
        reportInvalidPbrFactor(propertyName, propertyValue, context);
      }
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        !assignment ||
        !PBR_MATERIAL_CONSTRUCTOR_NAMES.has(assignment.constructorName) ||
        !MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES.has(assignment.propertyName)
      ) {
        return;
      }
      reportInvalidPbrFactor(assignment.propertyName, assignment.value, context);
    },
  }),
});
