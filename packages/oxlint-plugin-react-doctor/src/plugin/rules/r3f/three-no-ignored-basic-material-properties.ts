import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES } from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";

export const threeNoIgnoredBasicMaterialProperties = defineRule({
  id: "three-no-ignored-basic-material-properties",
  title: "PBR property ignored by Three.js MeshBasicMaterial",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use MeshStandardMaterial or MeshPhysicalMaterial when a mesh needs roughness or metalness",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        provenance?.apiName !== "MeshBasicMaterial" ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !parameters
      ) {
        return;
      }
      for (const propertyName of MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES) {
        const propertyValue = getStaticObjectPropertyValue(parameters, propertyName);
        if (!propertyValue) continue;
        context.report({
          node: propertyValue,
          message: `MeshBasicMaterial ignores ${propertyName} because it is not a PBR material. Use MeshStandardMaterial or MeshPhysicalMaterial for this property`,
        });
      }
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.constructorName !== "MeshBasicMaterial" ||
        !MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES.has(assignment.propertyName)
      ) {
        return;
      }
      context.report({
        node: assignment.value,
        message: `MeshBasicMaterial ignores ${assignment.propertyName} because it is not a PBR material. Use MeshStandardMaterial or MeshPhysicalMaterial for this property`,
      });
    },
  }),
});
