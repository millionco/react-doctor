import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  THREE_MESH_GEOMETRY_ARGUMENT_INDEX,
  THREE_MESH_MATERIAL_ARGUMENT_INDEX,
} from "./constants.js";
import { findProvablyRepeatedMapCallsForCallback } from "./utils/find-provably-repeated-map-calls-for-callback.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isReferenceStableAcrossFunctionExecutions } from "./utils/is-reference-stable-across-function-executions.js";

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
      if (
        !callback ||
        !geometry ||
        !material ||
        isNodeConditionallyExecuted(node, callback) ||
        !isReferenceStableAcrossFunctionExecutions(geometry, callback, context) ||
        !isReferenceStableAcrossFunctionExecutions(material, callback, context) ||
        findProvablyRepeatedMapCallsForCallback(callback, context).length === 0
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This map constructs multiple Mesh objects with the same geometry and material, creating a draw call for each item. Use one InstancedMesh and set each instance transform",
      });
    },
  }),
});
