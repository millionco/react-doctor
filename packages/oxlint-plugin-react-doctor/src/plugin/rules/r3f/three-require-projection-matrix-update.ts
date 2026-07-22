import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getConditionalExecutionRegions } from "../../utils/get-conditional-execution-regions.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface DirectProjectionMutation {
  readonly node: EsTreeNode;
  readonly receiverKey: string;
}

interface DirectProjectionUpdate {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly receiverKey: string;
}

const CAMERA_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "OrthographicCamera",
  "PerspectiveCamera",
]);

const PROJECTION_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "aspect",
  "bottom",
  "far",
  "filmGauge",
  "filmOffset",
  "fov",
  "left",
  "near",
  "right",
  "top",
  "zoom",
]);

const getProjectionMutation = (
  node: EsTreeNode,
  context: RuleContext,
): DirectProjectionMutation | null => {
  const target = isNodeOfType(node, "AssignmentExpression")
    ? stripParenExpression(node.left)
    : isNodeOfType(node, "UpdateExpression")
      ? stripParenExpression(node.argument)
      : null;
  if (
    !target ||
    !isNodeOfType(target, "MemberExpression") ||
    !PROJECTION_PROPERTY_NAMES.has(getStaticPropertyName(target) ?? "") ||
    !CAMERA_CONSTRUCTOR_NAMES.has(getThreeConstructorName(target.object, context.scopes) ?? "")
  ) {
    return null;
  }
  const receiverKey = resolveExpressionKey(target.object, context);
  return receiverKey ? { node, receiverKey } : null;
};

const getProjectionUpdate = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): DirectProjectionUpdate | null => {
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "updateProjectionMatrix" ||
    !CAMERA_CONSTRUCTOR_NAMES.has(getThreeConstructorName(callee.object, context.scopes) ?? "")
  ) {
    return null;
  }
  const receiverKey = resolveExpressionKey(callee.object, context);
  return receiverKey ? { node, receiverKey } : null;
};

const getOpaqueProjectionUpdates = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ReadonlyArray<DirectProjectionUpdate> => {
  if (!isImportedOrStableParameterCall(node, context.scopes)) return [];
  const updates: DirectProjectionUpdate[] = [];
  for (const argument of node.arguments) {
    if (
      isNodeOfType(argument, "SpreadElement") ||
      !CAMERA_CONSTRUCTOR_NAMES.has(getThreeConstructorName(argument, context.scopes) ?? "")
    ) {
      continue;
    }
    const receiverKey = resolveExpressionKey(argument, context);
    if (receiverKey) updates.push({ node, receiverKey });
  }
  return updates;
};

const moduleUpdateCoversMutation = (
  mutation: DirectProjectionMutation,
  update: DirectProjectionUpdate,
  program: EsTreeNode,
): boolean => {
  const mutationStart = getRangeStart(mutation.node);
  const updateStart = getRangeStart(update.node);
  if (mutationStart === null || updateStart === null || updateStart <= mutationStart) return false;
  if (!isNodeConditionallyExecuted(update.node, program)) return true;
  const mutationRegions = getConditionalExecutionRegions(mutation.node, program);
  const updateRegions = getConditionalExecutionRegions(update.node, program);
  return [...updateRegions].every((region) => mutationRegions.has(region));
};

const updateCoversMutation = (
  mutation: DirectProjectionMutation,
  updates: ReadonlyArray<DirectProjectionUpdate>,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(mutation.node);
  const matchingUpdates = updates.filter(
    (update) =>
      update.receiverKey === mutation.receiverKey &&
      context.cfg.enclosingFunction(update.node) === owner,
  );
  if (owner) {
    return doNodesCoverEveryPathAfterNode(
      mutation.node,
      matchingUpdates.map((update) => update.node),
      context,
    );
  }
  return matchingUpdates.some((update) => moduleUpdateCoversMutation(mutation, update, program));
};

export const threeRequireProjectionMatrixUpdate = defineRule({
  id: "three-require-projection-matrix-update",
  title: "Missing Three.js camera projection-matrix update",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Call camera.updateProjectionMatrix() after changing projection properties so Three.js renders the new frustum",
  create: (context: RuleContext) => {
    const mutations: DirectProjectionMutation[] = [];
    const updates: DirectProjectionUpdate[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const mutation = getProjectionMutation(node, context);
        if (mutation) mutations.push(mutation);
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        const mutation = getProjectionMutation(node, context);
        if (mutation) mutations.push(mutation);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const update = getProjectionUpdate(node, context);
        if (update) {
          updates.push(update);
          return;
        }
        updates.push(...getOpaqueProjectionUpdates(node, context));
      },
      "Program:exit"() {
        if (!program) return;
        for (const mutation of mutations) {
          if (updateCoversMutation(mutation, updates, program, context)) continue;
          context.report({
            node: mutation.node,
            message:
              "This camera projection property changes without a later updateProjectionMatrix() call on every path, so Three.js can keep rendering a stale projection matrix",
          });
        }
      },
    };
  },
});
