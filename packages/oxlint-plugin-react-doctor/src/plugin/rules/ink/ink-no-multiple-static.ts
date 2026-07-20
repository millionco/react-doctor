import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

export const inkNoMultipleStatic = defineRule({
  id: "ink-no-multiple-static",
  title: "Multiple unconditional Static regions in one render root",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Combine unconditional output in one render root into a single `<Static>`.",
  create: (context) => {
    const staticNodesByRenderRoot = new Map<EsTreeNode, EsTreeNodeOfType<"JSXOpeningElement">[]>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveInkJsxElementName(node, context.scopes) !== "Static") return;
        const owner = context.cfg.enclosingFunction(node);
        if (!owner) return;
        let renderRoot = node.parent;
        let ancestorNode = renderRoot?.parent;
        while (ancestorNode && ancestorNode !== owner) {
          if (ancestorNode.type === "JSXAttribute" || /Function/.test(ancestorNode.type)) return;
          if (ancestorNode.type === "JSXElement" || ancestorNode.type === "JSXFragment") {
            renderRoot = ancestorNode;
          }
          ancestorNode = ancestorNode.parent;
        }
        if (!renderRoot) return;
        const previousStaticNodes = staticNodesByRenderRoot.get(renderRoot);
        const didFindUnconditionalStatic = Boolean(
          previousStaticNodes?.some(
            (previousStaticNode) => !isNodeConditionallyExecuted(previousStaticNode, renderRoot),
          ),
        );
        if (previousStaticNodes) previousStaticNodes.push(node);
        else staticNodesByRenderRoot.set(renderRoot, [node]);
        if (isNodeConditionallyExecuted(node, renderRoot)) return;
        if (!didFindUnconditionalStatic) {
          return;
        }
        context.report({
          node,
          message: "Ink tracks one `<Static>` node per root; combine these unconditional regions.",
        });
      },
    };
  },
});
