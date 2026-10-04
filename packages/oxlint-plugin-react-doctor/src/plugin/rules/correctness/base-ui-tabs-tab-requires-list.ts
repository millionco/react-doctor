import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRequiredAncestorPlacement } from "../../utils/find-required-ancestor-placement.js";
import { resolveNamespacedPartName } from "../../utils/resolve-namespaced-part-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const BASE_UI_TABS_MODULE_PATTERN = /^@base-ui(?:-components)?\/react(?:\/tabs)?$/;

const resolveBaseUiTabsPartName = (elementName: EsTreeNode, context: RuleContext): string | null =>
  resolveNamespacedPartName(elementName, BASE_UI_TABS_MODULE_PATTERN, "Tabs", context);

export const baseUiTabsTabRequiresList = defineRule({
  id: "base-ui-tabs-tab-requires-list",
  title: "Base UI tab is outside Tabs.List",
  severity: "warn",
  category: "Correctness",
  requires: ["base-ui"],
  matchByOccurrence: true,
  recommendation:
    "Render each Base UI Tabs.Tab inside Tabs.List so the tablist role and arrow-key focus handling cover every tab.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveBaseUiTabsPartName(node.name, context) !== "Tab") return;
      const placement = findRequiredAncestorPlacement(node, (ancestorName) => {
        const resolvedName = resolveBaseUiTabsPartName(ancestorName, context);
        if (resolvedName === "List") return "required";
        return resolvedName === "Root" ? "root" : null;
      });
      if (placement !== "inside-root-without-required") return;
      context.report({
        node,
        message:
          "This Tabs.Tab is outside Tabs.List, so it misses the tablist grouping and arrow-key focus handling Base UI provides through the list. Nest it inside Tabs.List.",
      });
    },
  }),
});
