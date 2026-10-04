import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  PERSPECTIVE_CAMERA_ASPECT_ARGUMENT_INDEX,
  PERSPECTIVE_CAMERA_FAR_ARGUMENT_INDEX,
  PERSPECTIVE_CAMERA_NEAR_ARGUMENT_INDEX,
} from "./constants.js";
import { getInvalidPerspectiveCameraParameter } from "./utils/get-invalid-perspective-camera-parameter.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";

interface StaticR3fCameraParameter {
  node: EsTreeNode;
  value: number;
}

interface StaticR3fCameraParameters {
  aspect: StaticR3fCameraParameter | null;
  far: StaticR3fCameraParameter | null;
  near: StaticR3fCameraParameter | null;
}

const getStaticParameter = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): StaticR3fCameraParameter | null => {
  if (!expression || isNodeOfType(expression, "SpreadElement")) return null;
  const value = getStaticNumber(expression, context.scopes);
  return value === null ? null : { node: expression, value };
};

const getJsxAttributeExpression = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): EsTreeNode | null | undefined => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
  if (!attribute) return undefined;
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return attribute.value.expression;
};

const getPerspectiveCameraParameters = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): StaticR3fCameraParameters | null => {
  if (
    !isNodeOfType(node.name, "JSXIdentifier") ||
    node.name.name !== "perspectiveCamera" ||
    node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
  ) {
    return null;
  }
  const argsExpression = getJsxAttributeExpression(node, "args");
  const args =
    argsExpression && isNodeOfType(argsExpression, "ArrayExpression")
      ? argsExpression.elements
      : [];
  const explicitAspect = getJsxAttributeExpression(node, "aspect");
  const explicitNear = getJsxAttributeExpression(node, "near");
  const explicitFar = getJsxAttributeExpression(node, "far");
  return {
    aspect: getStaticParameter(
      explicitAspect === undefined
        ? args[PERSPECTIVE_CAMERA_ASPECT_ARGUMENT_INDEX]
        : explicitAspect,
      context,
    ),
    near: getStaticParameter(
      explicitNear === undefined ? args[PERSPECTIVE_CAMERA_NEAR_ARGUMENT_INDEX] : explicitNear,
      context,
    ),
    far: getStaticParameter(
      explicitFar === undefined ? args[PERSPECTIVE_CAMERA_FAR_ARGUMENT_INDEX] : explicitFar,
      context,
    ),
  };
};

const getCanvasCameraParameters = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): StaticR3fCameraParameters | null => {
  if (
    !isR3fCanvas(node, context) ||
    getAuthoritativeJsxAttribute(node.attributes, "orthographic")
  ) {
    return null;
  }
  const cameraExpression = getJsxAttributeExpression(node, "camera");
  if (!cameraExpression || !isNodeOfType(cameraExpression, "ObjectExpression")) return null;
  return {
    aspect: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "aspect"), context),
    near: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "near"), context),
    far: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "far"), context),
  };
};

export const r3fValidPerspectiveCamera = defineRule({
  id: "r3f-valid-perspective-camera",
  title: "Invalid R3F perspective camera",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use a positive aspect ratio and near plane, and keep the far plane greater than the near plane",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const parameters =
          getPerspectiveCameraParameters(node, context) ?? getCanvasCameraParameters(node, context);
        if (!parameters) return;
        const invalidParameter = getInvalidPerspectiveCameraParameter(parameters);
        if (!invalidParameter) return;
        context.report({
          node: invalidParameter.node,
          message: invalidParameter.message,
        });
      },
    };
  },
});
