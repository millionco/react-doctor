import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isThreeRendererReference } from "./utils/is-three-renderer-reference.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const callbackMayRender = (callback: EsTreeNode, context: RuleContext): boolean => {
  let mayRender = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (mayRender || !isNodeOfType(candidate, "CallExpression")) return;
    if (
      isNodeOfType(candidate.callee, "MemberExpression") &&
      getStaticPropertyName(candidate.callee) === "render"
    ) {
      mayRender = true;
      return;
    }
    if (isImportedOrStableParameterCall(candidate, context.scopes)) mayRender = true;
    if (
      isNodeOfType(candidate.callee, "Identifier") &&
      context.scopes.isGlobalReference(candidate.callee)
    ) {
      mayRender = true;
    }
  });
  return mayRender;
};

export const threeRequireRenderInAnimationLoop = defineRule({
  id: "three-require-render-in-animation-loop",
  title: "Three.js animation loop never renders",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Render the scene or a postprocessing composer from each WebGLRenderer animation loop",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "setAnimationLoop" ||
        !isThreeRendererReference(node.callee.object, context.scopes)
      ) {
        return;
      }
      const callbackArgument = node.arguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
      const callback = resolveLocalReactCallback(callbackArgument, context.scopes);
      if (!callback || callbackMayRender(callback, context)) return;
      context.report({
        node,
        message:
          "This Three.js setAnimationLoop callback has no reachable render call, so its updates are never presented. Render the scene or a composer from the loop",
      });
    },
  }),
});
