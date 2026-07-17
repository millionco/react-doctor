import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticJsxTreeRoot } from "../../utils/get-static-jsx-tree-root.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noMultipleMainLandmarks = defineRule({
  id: "no-multiple-main-landmarks",
  title: "View contains multiple main landmarks",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Keep one visible main landmark per rendered view so assistive-technology users can jump to the primary content unambiguously.",
  create: (context: RuleContext) => {
    const mainElementsByRoot = new Map<EsTreeNode, Array<EsTreeNodeOfType<"JSXOpeningElement">>>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveJsxElementType(node) !== "main") return;
        const root = getStaticJsxTreeRoot(node);
        if (!root) return;
        const mainElements = mainElementsByRoot.get(root) ?? [];
        mainElements.push(node);
        mainElementsByRoot.set(root, mainElements);
      },
      "Program:exit"() {
        for (const mainElements of mainElementsByRoot.values()) {
          for (const duplicateMain of mainElements.slice(1)) {
            context.report({
              node: duplicateMain,
              message:
                "This static view contains more than one main landmark. Keep a single main region and use sectioning elements for subordinate content.",
            });
          }
        }
      },
    };
  },
});
