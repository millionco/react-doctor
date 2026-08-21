import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectR3fDataTextureRefSymbolIds } from "./utils/collect-r3f-data-texture-ref-symbol-ids.js";
import { findDataTextureMutationsWithoutUpdate } from "./utils/find-data-texture-mutations-without-update.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

export const r3fRequireDataTextureUpdate = defineRule({
  id: "r3f-require-data-texture-update",
  title: "R3F changed data texture is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation: "Set texture.needsUpdate to true after changing data-texture pixels",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    let managedDataTextureRefSymbolIds: ReadonlySet<number> = new Set();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        managedDataTextureRefSymbolIds = collectR3fDataTextureRefSymbolIds(node, context.scopes);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        for (const mutation of findDataTextureMutationsWithoutUpdate(
          callback,
          context,
          managedDataTextureRefSymbolIds,
        )) {
          context.report({
            node: mutation,
            message:
              "This useFrame callback changes data-texture pixels without setting texture.needsUpdate on every path, so the GPU can keep rendering stale texels",
          });
        }
      },
    };
  },
});
