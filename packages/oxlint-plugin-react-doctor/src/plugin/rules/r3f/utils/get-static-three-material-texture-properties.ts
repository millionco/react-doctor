import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL } from "../constants.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export interface StaticThreeMaterialTextureProperties {
  propertyNames: ReadonlySet<string>;
  isComplete: boolean;
}

export const getStaticThreeMaterialTextureProperties = (
  expression: EsTreeNode,
  beforeNode: EsTreeNode,
  context: RuleContext,
): StaticThreeMaterialTextureProperties | null => {
  const constructor = resolveThreeConstructor(expression, context.scopes);
  if (!constructor) return null;
  const texturePropertyNames = UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL.get(
    constructor.constructorName,
  );
  if (!texturePropertyNames) return null;
  const propertyNames = new Set<string>();
  let isComplete = true;
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
      for (const propertyName of texturePropertyNames) {
        const value = getStaticObjectPropertyValue(unwrappedParameters, propertyName);
        if (value && !isNullishExpression(value)) propertyNames.add(propertyName);
      }
    }
  }
  const materialKey = resolveExpressionKey(expression, context);
  if (!materialKey) {
    return { propertyNames, isComplete: isComplete && expression === constructor.node };
  }
  const program = findProgramRoot(expression);
  if (!program) return null;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "CallExpression")) {
      const receiverKey = isNodeOfType(node.callee, "MemberExpression")
        ? resolveExpressionKey(node.callee.object, context)
        : null;
      const touchesMaterial =
        receiverKey === materialKey ||
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
      if (
        isNodeOfType(node.callee, "MemberExpression") &&
        receiverKey === materialKey &&
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
    if (!propertyName || !texturePropertyNames.has(propertyName)) return;
    if (isNullishExpression(node.right)) propertyNames.delete(propertyName);
    else propertyNames.add(propertyName);
  });
  return { propertyNames, isComplete };
};
