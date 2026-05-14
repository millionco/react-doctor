import { TANSTACK_ROOT_ROUTE_FILE_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const tanstackStartMissingHeadContent = defineRule<Rule>({
  framework: "tanstack-start",
  severity: "warn",
  category: "TanStack Start",
  recommendation:
    "Add `<HeadContent />` inside `<head>` in your __root route — without it, route `head()` meta tags are silently dropped",
  create: (context: RuleContext) => {
    let hasHeadContentElement = false;

    return {
      JSXOpeningElement(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "HeadContent") {
          hasHeadContentElement = true;
        }
      },
      "Program:exit"(programNode: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (!hasHeadContentElement) {
          context.report({
            node: programNode,
            message:
              "Root route (__root) without <HeadContent /> — route head() meta tags won't render",
          });
        }
      },
    };
  },
});
