import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectR3fPositionBufferRefSymbolIds } from "./utils/collect-r3f-position-buffer-ref-symbol-ids.js";
import {
  callbackMarksPositionBufferForUpdate,
  findRepeatedPositionBufferMutations,
} from "./utils/find-repeated-position-buffer-mutations.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

export const r3fRequirePositionBufferUpdate = defineRule({
  id: "r3f-require-position-buffer-update",
  title: "R3F position buffer is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Set the position BufferAttribute needsUpdate flag after changing its values on the CPU",
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
        const mutations = findRepeatedPositionBufferMutations(
          callback,
          context,
          managedPositionBufferRefSymbolIds,
        );
        if (
          mutations.length === 0 ||
          callbackMarksPositionBufferForUpdate(callback, context, managedPositionBufferRefSymbolIds)
        ) {
          return;
        }
        for (const mutation of mutations) {
          context.report({
            node: mutation,
            message:
              "This useFrame callback changes position-buffer data without setting the BufferAttribute needsUpdate flag, so Three.js may keep rendering the previous GPU data",
          });
        }
      },
    };
  },
});
