import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TABS_MODULE_PATTERN = /(?:^|\/)tabs$/;

type TriggerPlacement = "inside-list" | "inside-tabs-without-list" | "unprovable";

// Only a trigger that provably sits inside `Tabs` without crossing a
// `TabsList` is reportable. An extracted subcomponent rendering a lone
// trigger (mounted inside TabsList by its parent) and any unresolved custom
// ancestor (which may be a TabsList wrapper) are unprovable, not violations.
const getTriggerPlacement = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): TriggerPlacement => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorName = ancestor.openingElement.name;
      const resolvedName = resolveShadcnUiComponentName(ancestorName, TABS_MODULE_PATTERN, context);
      if (resolvedName === "TabsList") return "inside-list";
      if (resolvedName === "Tabs") return "inside-tabs-without-list";
      if (resolvedName === null) {
        const trailingSegment = getTrailingJsxNameSegment(ancestorName);
        if (
          trailingSegment !== null &&
          /^[A-Z]/.test(trailingSegment) &&
          trailingSegment !== "Fragment"
        ) {
          return "unprovable";
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return "unprovable";
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
        getTriggerPlacement(node, context) !== "inside-tabs-without-list"
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
