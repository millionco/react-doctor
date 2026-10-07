import { defineRule } from "../../utils/define-rule.js";
import { collectLocalValueReferences } from "../../utils/collect-local-value-references.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import {
  THREE_MESH_GEOMETRY_ARGUMENT_INDEX,
  THREE_MESH_MATERIAL_ARGUMENT_INDEX,
} from "./constants.js";
import { findProvablyRepeatedMapCallsForCallback } from "./utils/find-provably-repeated-map-calls-for-callback.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isReferenceStableAcrossFunctionExecutions } from "./utils/is-reference-stable-across-function-executions.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const THREE_OBJECT_CONTAINER_CONSTRUCTOR_NAMES = new Set(["Group", "Mesh", "Object3D", "Scene"]);

const isThreeObjectAddCall = (
  node: EsTreeNode,
  context: RuleContext,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== "add"
  ) {
    return false;
  }
  const constructorName = getThreeConstructorName(node.callee.object, context.scopes);
  return constructorName !== null && THREE_OBJECT_CONTAINER_CONSTRUCTOR_NAMES.has(constructorName);
};

const isUnconditionallyAddedToThreeObject = (
  node: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): boolean =>
  collectLocalValueReferences(node, context).some((reference) => {
    const expressionRoot = findTransparentExpressionRoot(reference);
    const call = expressionRoot.parent;
    return Boolean(
      call &&
      isThreeObjectAddCall(call, context) &&
      call.arguments.some((argument) => argument === expressionRoot) &&
      !isNodeConditionallyExecuted(expressionRoot, callback),
    );
  });

const hasIncompatibleMeshMutation = (
  node: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): boolean => {
  const meshKeys = new Set(
    collectLocalValueReferences(node, context).flatMap((reference) => {
      const referenceKey = resolveExpressionKey(reference, context);
      return referenceKey ? [referenceKey] : [];
    }),
  );
  if (meshKeys.size === 0) return false;
  const incompatibleResourceKeys = new Set(
    [...meshKeys].flatMap((meshKey) => [`${meshKey}.geometry`, `${meshKey}.material`]),
  );
  let hasIncompatibleMutation = false;
  walkFunctionExecution(callback, context.scopes, (descendant) => {
    if (hasIncompatibleMutation) return;
    if (isNodeOfType(descendant, "AssignmentExpression")) {
      const assignmentKey = resolveExpressionKey(descendant.left, context);
      if (assignmentKey && incompatibleResourceKeys.has(assignmentKey)) {
        hasIncompatibleMutation = true;
        return;
      }
    }
    if (
      isNodeOfType(descendant, "CallExpression") &&
      isNodeOfType(descendant.callee, "MemberExpression")
    ) {
      const methodName = getStaticPropertyName(descendant.callee);
      const receiverKey = resolveExpressionKey(descendant.callee.object, context);
      if (
        receiverKey &&
        meshKeys.has(receiverKey) &&
        (methodName === "add" || methodName === "attach" || methodName === "copy")
      ) {
        hasIncompatibleMutation = true;
      }
    }
  });
  return hasIncompatibleMutation;
};

const isSpreadIntoThreeObjectAdd = (node: EsTreeNode, context: RuleContext): boolean => {
  return collectLocalValueReferences(node, context).some((reference) => {
    const expressionRoot = findTransparentExpressionRoot(reference);
    const spread = expressionRoot.parent;
    const call = spread?.parent;
    return Boolean(
      spread &&
      isNodeOfType(spread, "SpreadElement") &&
      spread.argument === expressionRoot &&
      call &&
      isThreeObjectAddCall(call, context) &&
      call.arguments.some((argument) => argument === spread),
    );
  });
};

export const threePreferInstancedMesh = defineRule({
  id: "three-prefer-instanced-mesh",
  title: "Repeated Three.js meshes use separate draw calls",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Replace repeated Mesh objects that share geometry and material with one InstancedMesh and per-instance transforms",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (getThreeConstructorName(node, context.scopes) !== "Mesh") return;
      const callback = findEnclosingFunction(node);
      const geometry = node.arguments[THREE_MESH_GEOMETRY_ARGUMENT_INDEX];
      const material = node.arguments[THREE_MESH_MATERIAL_ARGUMENT_INDEX];
      if (!callback || !geometry || !material) return;
      const repeatedMapCalls = findProvablyRepeatedMapCallsForCallback(callback, context);
      const doesCallbackReturnMesh = functionReturnsMatchingExpression(
        callback,
        context.scopes,
        (returnedExpression) => stripParenExpression(returnedExpression) === node,
        context.cfg,
        "every",
      );
      const isAddedToThreeObject =
        isUnconditionallyAddedToThreeObject(node, callback, context) ||
        (doesCallbackReturnMesh &&
          repeatedMapCalls.some((mapCall) => isSpreadIntoThreeObjectAdd(mapCall, context)));
      if (
        isNodeConditionallyExecuted(node, callback) ||
        hasIncompatibleMeshMutation(node, callback, context) ||
        !isReferenceStableAcrossFunctionExecutions(geometry, callback, context) ||
        !isReferenceStableAcrossFunctionExecutions(material, callback, context) ||
        repeatedMapCalls.length === 0 ||
        !isAddedToThreeObject
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This map adds multiple Mesh objects with the same geometry and material, creating a draw call for each item. Use one InstancedMesh and set each instance transform",
      });
    },
  }),
});
