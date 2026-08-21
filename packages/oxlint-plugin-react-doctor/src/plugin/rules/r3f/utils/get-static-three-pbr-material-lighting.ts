import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { PBR_MATERIAL_CONSTRUCTOR_NAMES } from "../constants.js";
import { getStaticNumber } from "./get-static-number.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export interface StaticThreePbrMaterialLighting {
  constructorName: string;
  hasEmissiveSource: boolean;
  hasEnvironmentMap: boolean;
  hasLightMap: boolean;
  isComplete: boolean;
  isVisible: boolean;
  metalness: number | null;
  node: EsTreeNode;
}

const isPresentValue = (value: EsTreeNode | null | undefined): boolean =>
  Boolean(value && !isNullishExpression(value));

export const getStaticThreePbrMaterialLighting = (
  expression: EsTreeNode,
  beforeNode: EsTreeNode,
  context: RuleContext,
): StaticThreePbrMaterialLighting | null => {
  const constructor = resolveThreeConstructor(expression, context.scopes);
  if (!constructor || !PBR_MATERIAL_CONSTRUCTOR_NAMES.has(constructor.constructorName)) return null;
  let hasEmissiveSource = false;
  let hasEnvironmentMap = false;
  let hasLightMap = false;
  let isComplete = true;
  let isVisible = true;
  let metalness: number | null = null;
  let opacity: number | null = null;
  let isTransparent = false;
  const parameters = constructor.node.arguments[0];
  if (parameters) {
    const unwrappedParameters = isNodeOfType(parameters, "SpreadElement")
      ? null
      : stripParenExpression(parameters);
    if (
      !unwrappedParameters ||
      !isNodeOfType(unwrappedParameters, "ObjectExpression") ||
      unwrappedParameters.properties.some((property) => isNodeOfType(property, "SpreadElement"))
    ) {
      isComplete = false;
    } else {
      hasEmissiveSource = isPresentValue(
        getStaticObjectPropertyValue(unwrappedParameters, "emissive"),
      );
      hasEnvironmentMap = isPresentValue(
        getStaticObjectPropertyValue(unwrappedParameters, "envMap"),
      );
      hasLightMap = isPresentValue(getStaticObjectPropertyValue(unwrappedParameters, "lightMap"));
      const metalnessExpression = getStaticObjectPropertyValue(unwrappedParameters, "metalness");
      metalness = metalnessExpression ? getStaticNumber(metalnessExpression, context.scopes) : null;
      const opacityExpression = getStaticObjectPropertyValue(unwrappedParameters, "opacity");
      opacity = opacityExpression ? getStaticNumber(opacityExpression, context.scopes) : null;
      const transparentExpression = getStaticObjectPropertyValue(
        unwrappedParameters,
        "transparent",
      );
      if (transparentExpression) {
        const transparent = readStaticBoolean(transparentExpression);
        if (transparent === null) isComplete = false;
        else isTransparent = transparent;
      }
      const visibleExpression = getStaticObjectPropertyValue(unwrappedParameters, "visible");
      if (visibleExpression) {
        const visible = readStaticBoolean(visibleExpression);
        if (visible === null) isComplete = false;
        else isVisible = visible;
      }
    }
  }
  const materialKey = resolveExpressionKey(expression, context);
  if (!materialKey) {
    return {
      constructorName: constructor.constructorName,
      hasEmissiveSource,
      hasEnvironmentMap,
      hasLightMap,
      isComplete: isComplete && expression === constructor.node,
      isVisible: isVisible && !(isTransparent && opacity !== null && opacity <= 0),
      metalness,
      node: constructor.node,
    };
  }
  const program = findProgramRoot(expression);
  if (!program) return null;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "CallExpression")) {
      const receiver = isNodeOfType(node.callee, "MemberExpression")
        ? resolveExpressionKey(node.callee.object, context)
        : null;
      const touchesMaterial =
        receiver === materialKey ||
        receiver === `${materialKey}.emissive` ||
        node.arguments.some(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") &&
            resolveExpressionKey(argument, context) === materialKey,
        );
      if (touchesMaterial && !nodeDominatesNode(node, beforeNode, context)) {
        isComplete = false;
        return;
      }
      for (const argument of node.arguments) {
        if (
          !isNodeOfType(argument, "SpreadElement") &&
          resolveExpressionKey(argument, context) === materialKey
        ) {
          isComplete = false;
          return;
        }
      }
      if (receiver === `${materialKey}.emissive`) {
        hasEmissiveSource = true;
        return;
      }
      if (
        receiver === materialKey &&
        isNodeOfType(node.callee, "MemberExpression") &&
        getStaticPropertyName(node.callee) !== "dispose"
      ) {
        isComplete = false;
      }
      return;
    }
    if (!isNodeOfType(node, "AssignmentExpression") || node.operator !== "=") return;
    const target = stripParenExpression(node.left);
    if (!isNodeOfType(target, "MemberExpression")) return;
    if (resolveExpressionKey(target.object, context) !== materialKey) return;
    if (!nodeDominatesNode(node, beforeNode, context)) {
      isComplete = false;
      return;
    }
    const propertyName = getStaticPropertyName(target);
    if (propertyName === "emissive") {
      hasEmissiveSource = !isNullishExpression(node.right);
      return;
    }
    if (propertyName === "envMap") {
      hasEnvironmentMap = !isNullishExpression(node.right);
      return;
    }
    if (propertyName === "lightMap") {
      hasLightMap = !isNullishExpression(node.right);
      return;
    }
    if (propertyName === "metalness") {
      metalness = getStaticNumber(node.right, context.scopes);
      return;
    }
    if (propertyName === "opacity") {
      opacity = getStaticNumber(node.right, context.scopes);
      return;
    }
    if (propertyName === "transparent") {
      const transparent = readStaticBoolean(node.right);
      if (transparent === null) isComplete = false;
      else isTransparent = transparent;
      return;
    }
    if (propertyName === "visible") {
      const visible = readStaticBoolean(node.right);
      if (visible === null) isComplete = false;
      else isVisible = visible;
    }
  });
  return {
    constructorName: constructor.constructorName,
    hasEmissiveSource,
    hasEnvironmentMap,
    hasLightMap,
    isComplete,
    isVisible: isVisible && !(isTransparent && opacity !== null && opacity <= 0),
    metalness,
    node: constructor.node,
  };
};
