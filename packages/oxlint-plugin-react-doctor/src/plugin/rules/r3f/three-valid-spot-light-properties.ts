import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  SPOT_LIGHT_ANGLE_ARGUMENT_INDEX,
  SPOT_LIGHT_PENUMBRA_ARGUMENT_INDEX,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getInvalidSpotLightProperty } from "./utils/get-invalid-spot-light-property.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const reportInvalidProperty = (
  propertyName: string,
  expression: EsTreeNode | undefined,
  context: RuleContext,
): void => {
  if (!expression || isNodeOfType(expression, "SpreadElement")) return;
  const value = getStaticNumber(expression, context.scopes);
  if (value === null) return;
  const invalidProperty = getInvalidSpotLightProperty(propertyName, value, expression);
  if (invalidProperty)
    context.report({ node: invalidProperty.node, message: invalidProperty.message });
};

export const threeValidSpotLightProperties = defineRule({
  id: "three-valid-spot-light-properties",
  title: "Invalid Three.js spotlight cone",
  category: "Correctness",
  severity: "warn",
  recommendation: "Keep spotlight angle in (0, Math.PI / 2] and penumbra in [0, 1]",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (provenance?.apiName !== "SpotLight" || !isThreeModuleSource(provenance.moduleSource))
        return;
      reportInvalidProperty("angle", node.arguments[SPOT_LIGHT_ANGLE_ARGUMENT_INDEX], context);
      reportInvalidProperty(
        "penumbra",
        node.arguments[SPOT_LIGHT_PENUMBRA_ARGUMENT_INDEX],
        context,
      );
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.constructorName !== "SpotLight" ||
        (assignment.propertyName !== "angle" && assignment.propertyName !== "penumbra")
      ) {
        return;
      }
      reportInvalidProperty(assignment.propertyName, assignment.value, context);
    },
  }),
});
