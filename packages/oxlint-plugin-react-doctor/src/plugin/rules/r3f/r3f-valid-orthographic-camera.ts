import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
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
import { getInvalidOrthographicCameraParameter } from "./utils/get-invalid-orthographic-camera-parameter.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";
import { readStaticJsxBooleanAttribute } from "./utils/read-static-jsx-boolean-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";

interface StaticR3fCameraParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

interface StaticR3fCameraParameters {
  readonly bottom: StaticR3fCameraParameter | null;
  readonly far: StaticR3fCameraParameter | null;
  readonly left: StaticR3fCameraParameter | null;
  readonly near: StaticR3fCameraParameter | null;
  readonly right: StaticR3fCameraParameter | null;
  readonly top: StaticR3fCameraParameter | null;
}

const getStaticParameter = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): StaticR3fCameraParameter | null => {
  if (!expression || isNodeOfType(expression, "SpreadElement")) return null;
  const value = getStaticNumber(expression, context.scopes);
  return value === null ? null : { node: expression, value };
};

const getCameraParameters = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): StaticR3fCameraParameters | null => {
  if (node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    return null;
  if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "orthographicCamera") {
    const argsExpression = getJsxAttributeExpression(node, "args");
    const argumentsList =
      argsExpression && isNodeOfType(argsExpression, "ArrayExpression")
        ? argsExpression.elements
        : [];
    const readParameter = (propertyName: string, argumentIndex: number) => {
      const expression = getJsxAttributeExpression(node, propertyName);
      return getStaticParameter(
        expression === undefined ? argumentsList[argumentIndex] : expression,
        context,
      );
    };
    return {
      left: readParameter("left", ORTHOGRAPHIC_CAMERA_LEFT_ARGUMENT_INDEX),
      right: readParameter("right", ORTHOGRAPHIC_CAMERA_RIGHT_ARGUMENT_INDEX),
      top: readParameter("top", ORTHOGRAPHIC_CAMERA_TOP_ARGUMENT_INDEX),
      bottom: readParameter("bottom", ORTHOGRAPHIC_CAMERA_BOTTOM_ARGUMENT_INDEX),
      near: readParameter("near", ORTHOGRAPHIC_CAMERA_NEAR_ARGUMENT_INDEX),
      far: readParameter("far", ORTHOGRAPHIC_CAMERA_FAR_ARGUMENT_INDEX),
    };
  }
  if (!isR3fCanvas(node, context)) return null;
  const orthographicAttribute = getAuthoritativeJsxAttribute(node.attributes, "orthographic");
  if (!orthographicAttribute || readStaticJsxBooleanAttribute(orthographicAttribute) !== true)
    return null;
  const cameraExpression = getJsxAttributeExpression(node, "camera");
  if (!cameraExpression || !isNodeOfType(cameraExpression, "ObjectExpression")) return null;
  return {
    left: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "left"), context),
    right: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "right"), context),
    top: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "top"), context),
    bottom: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "bottom"), context),
    near: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "near"), context),
    far: getStaticParameter(getStaticObjectPropertyValue(cameraExpression, "far"), context),
  };
};

export const r3fValidOrthographicCamera = defineRule({
  id: "r3f-valid-orthographic-camera",
  title: "Invalid R3F orthographic camera",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use distinct horizontal and vertical frustum planes and a far plane greater than near",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const parameters = getCameraParameters(node, context);
        if (!parameters) return;
        const invalidParameter = getInvalidOrthographicCameraParameter(parameters);
        if (invalidParameter)
          context.report({ node: invalidParameter.node, message: invalidParameter.message });
      },
    };
  },
});
