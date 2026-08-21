import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRequiredAncestorPlacement } from "../../utils/find-required-ancestor-placement.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TABS_MODULE_PATTERN = /(?:^|\/)ui\/(?:.*\/)?tabs$|^\.\.?\/(?:.*\/)?tabs$/;

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
      if (resolveShadcnUiComponentName(node.name, TABS_MODULE_PATTERN, context) !== "TabsTrigger") {
        return;
      }
      const placement = findRequiredAncestorPlacement(node, (ancestorName) => {
        const resolvedName = resolveShadcnUiComponentName(
          ancestorName,
          TABS_MODULE_PATTERN,
          context,
        );
        if (resolvedName === "TabsList") return "required";
        return resolvedName === "Tabs" ? "root" : null;
      });
      if (placement !== "inside-root-without-required") return;
      context.report({
        node,
        message:
          "This TabsTrigger is outside TabsList, so the library cannot provide the expected tablist grouping and keyboard behavior. Nest it inside TabsList.",
      });
    },
  }),
});
