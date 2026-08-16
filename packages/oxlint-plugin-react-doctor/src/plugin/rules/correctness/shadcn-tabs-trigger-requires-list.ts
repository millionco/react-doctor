import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TABS_MODULE_PATTERN = /(?:^|\/)tabs$/;

const hasTabsListAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      resolveShadcnUiComponentName(ancestor.openingElement.name, TABS_MODULE_PATTERN, context) ===
        "TabsList"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const shadcnTabsTriggerRequiresList = defineRule({
  id: "shadcn-tabs-trigger-requires-list",
  title: "Tabs trigger is outside TabsList",
  severity: "warn",
  category: "Correctness",
  requires: ["shadcn"],
  matchByOccurrence: true,
  recommendation:
    "Render each imported TabsTrigger inside its library TabsList so keyboard navigation and tablist semantics share one scope.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        resolveShadcnUiComponentName(node.name, TABS_MODULE_PATTERN, context) !== "TabsTrigger" ||
        hasTabsListAncestor(node, context)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This TabsTrigger is outside TabsList, so the library cannot provide the expected tablist grouping and keyboard behavior. Nest it inside TabsList.",
      });
    },
  }),
});
