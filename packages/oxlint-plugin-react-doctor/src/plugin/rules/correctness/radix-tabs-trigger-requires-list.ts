import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRequiredAncestorPlacement } from "../../utils/find-required-ancestor-placement.js";
import { resolveNamespacedPartName } from "../../utils/resolve-namespaced-part-name.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const RADIX_TABS_PRIMITIVE_MODULE_PATTERN = /^@radix-ui\/react-tabs$/;
const RADIX_UNIFIED_MODULE_PATTERN = /^radix-ui$/;

const resolveRadixTabsPartName = (elementName: EsTreeNode, context: RuleContext): string | null =>
  resolveShadcnUiComponentName(elementName, RADIX_TABS_PRIMITIVE_MODULE_PATTERN, context) ??
  resolveNamespacedPartName(elementName, RADIX_UNIFIED_MODULE_PATTERN, "Tabs", context);

export const radixTabsTriggerRequiresList = defineRule({
  id: "radix-tabs-trigger-requires-list",
  title: "Radix tabs trigger is outside Tabs.List",
  severity: "warn",
  category: "Correctness",
  requires: ["radix-ui"],
  matchByOccurrence: true,
  recommendation:
    "Render each Radix Tabs.Trigger inside Tabs.List so the tablist role and roving keyboard focus cover every trigger.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveRadixTabsPartName(node.name, context) !== "Trigger") return;
      const placement = findRequiredAncestorPlacement(node, (ancestorName) => {
        const resolvedName = resolveRadixTabsPartName(ancestorName, context);
        if (resolvedName === "List") return "required";
        return resolvedName === "Root" ? "root" : null;
      });
      if (placement !== "inside-root-without-required") return;
      context.report({
        node,
        message:
          "This Tabs.Trigger is outside Tabs.List, so it misses the tablist grouping and roving keyboard focus Radix provides through the list. Nest it inside Tabs.List.",
      });
    },
  }),
});
