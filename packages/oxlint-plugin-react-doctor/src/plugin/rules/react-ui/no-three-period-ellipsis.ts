import {
  ELLIPSIS_EXCLUDED_TAG_NAMES,
  TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOpeningElementTagName } from "./utils/get-opening-element-tag-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isInsideExcludedAncestor = (jsxTextNode: EsTreeNode): boolean => {
  let cursor = jsxTextNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXElement")) {
      const tagName = getOpeningElementTagName(cursor.openingElement);
      if (tagName && ELLIPSIS_EXCLUDED_TAG_NAMES.has(tagName.toLowerCase())) return true;
      const translateAttribute = findJsxAttribute(
        cursor.openingElement?.attributes ?? [],
        "translate",
      );
      if (
        isNodeOfType(translateAttribute?.value, "Literal") &&
        translateAttribute.value.value === "no"
      ) {
        return true;
      }
    }
    cursor = cursor.parent;
  }
  return false;
};

export const noThreePeriodEllipsis = defineRule<Rule>({
  id: "design-no-three-period-ellipsis",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    'Use the typographic ellipsis "…" (or `&hellip;`) instead of three periods — pairs with action-with-followup labels ("Rename…", "Loading…")',
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      if (isInsideExcludedAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message:
          'Three-period ellipsis ("...") in JSX text — use the actual ellipsis character "…" (or `&hellip;`)',
      });
    },
  }),
});
