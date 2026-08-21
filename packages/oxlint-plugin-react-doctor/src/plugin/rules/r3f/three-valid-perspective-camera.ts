import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  PERSPECTIVE_CAMERA_ASPECT_ARGUMENT_INDEX,
  PERSPECTIVE_CAMERA_FAR_ARGUMENT_INDEX,
  PERSPECTIVE_CAMERA_NEAR_ARGUMENT_INDEX,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getInvalidPerspectiveCameraParameter } from "./utils/get-invalid-perspective-camera-parameter.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

interface StaticCameraParameter {
  node: EsTreeNode;
  value: number;
}

const getStaticCameraParameter = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
): StaticCameraParameter | null => {
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  const value = getStaticNumber(argument, context.scopes);
  return value === null ? null : { node: argument, value };
};

export const threeValidPerspectiveCamera = defineRule({
  id: "three-valid-perspective-camera",
  title: "Invalid Three.js perspective camera",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use a positive aspect ratio and near plane, and keep the far plane greater than the near plane",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        provenance?.apiName !== "PerspectiveCamera" ||
        !isThreeModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const invalidParameter = getInvalidPerspectiveCameraParameter({
        aspect: getStaticCameraParameter(
          node.arguments[PERSPECTIVE_CAMERA_ASPECT_ARGUMENT_INDEX],
          context,
        ),
        near: getStaticCameraParameter(
          node.arguments[PERSPECTIVE_CAMERA_NEAR_ARGUMENT_INDEX],
          context,
        ),
        far: getStaticCameraParameter(
          node.arguments[PERSPECTIVE_CAMERA_FAR_ARGUMENT_INDEX],
          context,
        ),
      });
      if (!invalidParameter) return;
      context.report({
        node: invalidParameter.node,
        message: invalidParameter.message,
      });
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (assignment?.constructorName !== "PerspectiveCamera") return;
      const value = getStaticNumber(assignment.value, context.scopes);
      if (value === null) return;
      const parameter = { node: assignment.value, value };
      const invalidParameter = getInvalidPerspectiveCameraParameter({
        aspect: assignment.propertyName === "aspect" ? parameter : null,
        far: assignment.propertyName === "far" ? parameter : null,
        near: assignment.propertyName === "near" ? parameter : null,
      });
      if (!invalidParameter) return;
      context.report({ node: invalidParameter.node, message: invalidParameter.message });
    },
  }),
});
