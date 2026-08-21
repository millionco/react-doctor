import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const THREE_COMPILE_METHOD_NAMES: ReadonlySet<string> = new Set(["compile", "compileAsync"]);

export const r3fNoCompileInUseFrame = defineRule({
  id: "r3f-no-compile-in-use-frame",
  title: "R3F shader precompilation inside useFrame",
  category: "Performance",
  severity: "error",
  recommendation: "Precompile scene materials outside useFrame before they are first displayed",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            !THREE_COMPILE_METHOD_NAMES.has(getStaticPropertyName(candidate.callee) ?? "") ||
            (!isR3fCallbackStateProperty(candidate.callee.object, callback, "gl", context.scopes) &&
              !isR3fCallbackStateProperty(
                candidate.callee.object,
                callback,
                "renderer",
                context.scopes,
              ))
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "Renderer shader precompilation runs inside useFrame. Compile once before display instead of rechecking the scene every frame",
          });
        });
      },
    };
  },
});
