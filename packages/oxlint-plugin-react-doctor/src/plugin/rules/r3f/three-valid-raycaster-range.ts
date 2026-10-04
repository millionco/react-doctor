import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { RAYCASTER_FAR_ARGUMENT_INDEX, RAYCASTER_NEAR_ARGUMENT_INDEX } from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getInvalidRaycasterParameter } from "./utils/get-invalid-raycaster-parameter.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

interface StaticRaycasterParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

const getStaticParameter = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
): StaticRaycasterParameter | null => {
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  const value = getStaticNumber(argument, context.scopes);
  return value === null ? null : { node: argument, value };
};

export const threeValidRaycasterRange = defineRule({
  id: "three-valid-raycaster-range",
  title: "Invalid Three.js raycaster distance range",
  category: "Correctness",
  severity: "error",
  recommendation: "Keep raycaster near nonnegative and far greater than or equal to near",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (provenance?.apiName !== "Raycaster" || !isThreeModuleSource(provenance.moduleSource)) {
        return;
      }
      const invalidParameter = getInvalidRaycasterParameter(
        getStaticParameter(node.arguments[RAYCASTER_NEAR_ARGUMENT_INDEX], context),
        getStaticParameter(node.arguments[RAYCASTER_FAR_ARGUMENT_INDEX], context),
      );
      if (invalidParameter)
        context.report({ node: invalidParameter.node, message: invalidParameter.message });
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (assignment?.constructorName !== "Raycaster" || assignment.propertyName !== "near") return;
      const value = getStaticNumber(assignment.value, context.scopes);
      if (value === null) return;
      const invalidParameter = getInvalidRaycasterParameter(
        { node: assignment.value, value },
        null,
      );
      if (invalidParameter)
        context.report({ node: invalidParameter.node, message: invalidParameter.message });
    },
  }),
});
