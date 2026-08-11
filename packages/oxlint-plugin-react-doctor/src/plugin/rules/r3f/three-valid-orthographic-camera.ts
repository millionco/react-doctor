import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  ORTHOGRAPHIC_CAMERA_BOTTOM_ARGUMENT_INDEX,
  ORTHOGRAPHIC_CAMERA_FAR_ARGUMENT_INDEX,
  ORTHOGRAPHIC_CAMERA_LEFT_ARGUMENT_INDEX,
  ORTHOGRAPHIC_CAMERA_NEAR_ARGUMENT_INDEX,
  ORTHOGRAPHIC_CAMERA_RIGHT_ARGUMENT_INDEX,
  ORTHOGRAPHIC_CAMERA_TOP_ARGUMENT_INDEX,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getInvalidOrthographicCameraParameter } from "./utils/get-invalid-orthographic-camera-parameter.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

interface StaticCameraParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

const getStaticCameraParameter = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
): StaticCameraParameter | null => {
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  const value = getStaticNumber(argument, context.scopes);
  return value === null ? null : { node: argument, value };
};

export const threeValidOrthographicCamera = defineRule({
  id: "three-valid-orthographic-camera",
  title: "Invalid Three.js orthographic camera",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use distinct horizontal and vertical frustum planes, a nonnegative near plane, and a far plane greater than near",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        provenance?.apiName !== "OrthographicCamera" ||
        !isThreeModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const invalidParameter = getInvalidOrthographicCameraParameter({
        left: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_LEFT_ARGUMENT_INDEX],
          context,
        ),
        right: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_RIGHT_ARGUMENT_INDEX],
          context,
        ),
        top: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_TOP_ARGUMENT_INDEX],
          context,
        ),
        bottom: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_BOTTOM_ARGUMENT_INDEX],
          context,
        ),
        near: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_NEAR_ARGUMENT_INDEX],
          context,
        ),
        far: getStaticCameraParameter(
          node.arguments[ORTHOGRAPHIC_CAMERA_FAR_ARGUMENT_INDEX],
          context,
        ),
      });
      if (invalidParameter)
        context.report({ node: invalidParameter.node, message: invalidParameter.message });
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.constructorName !== "OrthographicCamera" ||
        assignment.propertyName !== "near"
      ) {
        return;
      }
      const value = getStaticNumber(assignment.value, context.scopes);
      if (value === null) return;
      const invalidParameter = getInvalidOrthographicCameraParameter({
        bottom: null,
        far: null,
        left: null,
        near: { node: assignment.value, value },
        right: null,
        top: null,
      });
      if (invalidParameter)
        context.report({ node: invalidParameter.node, message: invalidParameter.message });
    },
  }),
});
