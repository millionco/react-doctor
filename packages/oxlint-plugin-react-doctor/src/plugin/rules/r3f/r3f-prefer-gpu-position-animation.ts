import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectR3fPositionBufferRefSymbolIds } from "./utils/collect-r3f-position-buffer-ref-symbol-ids.js";
import { findRepeatedPositionBufferMutations } from "./utils/find-repeated-position-buffer-mutations.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

export const r3fPreferGpuPositionAnimation = defineRule({
  id: "r3f-prefer-gpu-position-animation",
  title: "Per-vertex CPU animation in R3F useFrame",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Animate repeated vertex or particle positions in a vertex shader, instanced attribute, or GPU simulation instead of rewriting them on the CPU every frame",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    let managedPositionBufferRefSymbolIds: ReadonlySet<number> = new Set();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        managedPositionBufferRefSymbolIds = collectR3fPositionBufferRefSymbolIds(
          node,
          context.scopes,
        );
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        const firstMutation = findRepeatedPositionBufferMutations(
          callback,
          context,
          managedPositionBufferRefSymbolIds,
          false,
        )[0];
        if (!firstMutation) return;
        context.report({
          node: firstMutation,
          message:
            "This frame loop rewrites position-buffer entries on the CPU. Move repeated vertex or particle motion into a vertex shader, instanced attributes, or a GPU simulation",
        });
      },
    };
  },
});
