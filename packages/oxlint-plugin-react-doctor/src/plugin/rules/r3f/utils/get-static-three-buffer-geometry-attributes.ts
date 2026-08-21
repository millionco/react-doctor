import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export interface StaticThreeBufferGeometryAttributes {
  attributeNames: ReadonlySet<string>;
  isComplete: boolean;
}

const ATTRIBUTE_PRESERVING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "addGroup",
  "center",
  "clearGroups",
  "computeBoundingBox",
  "computeBoundingSphere",
  "computeTangents",
  "lookAt",
  "normalizeNormals",
  "rotateX",
  "rotateY",
  "rotateZ",
  "scale",
  "setDrawRange",
  "setIndex",
  "translate",
]);

export const getStaticThreeBufferGeometryAttributes = (
  expression: EsTreeNode,
  beforeNode: EsTreeNode,
  context: RuleContext,
): StaticThreeBufferGeometryAttributes | null => {
  const constructor = resolveThreeConstructor(expression, context.scopes);
  if (constructor?.constructorName !== "BufferGeometry") return null;
  const geometryKey = resolveExpressionKey(expression, context);
  if (!geometryKey)
    return { attributeNames: new Set(), isComplete: expression === constructor.node };
  const program = findProgramRoot(expression);
  if (!program) return null;
  const attributeNames = new Set<string>();
  let isComplete = true;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "CallExpression")) {
      const receiverKey = isNodeOfType(node.callee, "MemberExpression")
        ? resolveExpressionKey(node.callee.object, context)
        : null;
      const touchesGeometry =
        receiverKey === geometryKey ||
        node.arguments.some(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") &&
            resolveExpressionKey(argument, context) === geometryKey,
        );
      if (touchesGeometry && !nodeDominatesNode(node, beforeNode, context)) {
        isComplete = false;
        return;
      }
      for (const argument of node.arguments) {
        if (
          !isNodeOfType(argument, "SpreadElement") &&
          resolveExpressionKey(argument, context) === geometryKey
        ) {
          isComplete = false;
          return;
        }
      }
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (receiverKey !== geometryKey) return;
      const methodName = getStaticPropertyName(node.callee);
      if (methodName === "computeVertexNormals") {
        attributeNames.add("normal");
        return;
      }
      if (methodName === "setAttribute" || methodName === "addAttribute") {
        const attributeName = getStaticStringExpression(node.arguments[0]);
        if (attributeName) attributeNames.add(attributeName);
        else isComplete = false;
        return;
      }
      if (!methodName || !ATTRIBUTE_PRESERVING_METHOD_NAMES.has(methodName)) isComplete = false;
      return;
    }
    if (!isNodeOfType(node, "AssignmentExpression")) return;
    const target = stripParenExpression(node.left);
    if (
      isNodeOfType(target, "Identifier") &&
      resolveExpressionKey(target, context) === geometryKey
    ) {
      isComplete = false;
      return;
    }
    if (!isNodeOfType(target, "MemberExpression")) return;
    const targetKey = resolveExpressionKey(target, context);
    if (targetKey === `${geometryKey}.attributes`) {
      if (!nodeDominatesNode(node, beforeNode, context)) {
        isComplete = false;
        return;
      }
      isComplete = false;
      return;
    }
    const attributes = stripParenExpression(target.object);
    if (
      isNodeOfType(attributes, "MemberExpression") &&
      getStaticPropertyName(attributes) === "attributes" &&
      resolveExpressionKey(attributes.object, context) === geometryKey
    ) {
      isComplete = false;
    }
  });
  return { attributeNames, isComplete };
};
