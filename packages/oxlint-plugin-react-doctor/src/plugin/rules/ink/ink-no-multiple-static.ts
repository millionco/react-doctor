import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

export const inkNoMultipleStatic = defineRule({
  id: "ink-no-multiple-static",
  title: "Multiple Static regions in one Ink tree",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Consolidate permanent output into one `<Static>` region when possible.",
  create: (context) => {
    const staticCountByOwner = new Map<EsTreeNode, number>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveInkJsxElementName(node, context.scopes) !== "Static") return;
        const owner = context.cfg.enclosingFunction(node);
        if (!owner) return;
        const staticCount = (staticCountByOwner.get(owner) ?? 0) + 1;
        staticCountByOwner.set(owner, staticCount);
        if (staticCount < 2) return;
        context.report({
          node,
          message:
            "Multiple `<Static>` regions make permanent output ordering difficult to reason about.",
        });
      },
    };
  },
});
