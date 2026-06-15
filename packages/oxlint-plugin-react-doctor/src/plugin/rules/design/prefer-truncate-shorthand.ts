import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const HAS_OVERFLOW_HIDDEN = /(?:^|\s)overflow-hidden(?:$|\s)/;
const HAS_TEXT_ELLIPSIS = /(?:^|\s)text-ellipsis(?:$|\s)/;
const HAS_WHITESPACE_NOWRAP = /(?:^|\s)whitespace-nowrap(?:$|\s)/;

export const preferTruncateShorthand = defineRule({
  id: "prefer-truncate-shorthand",
  title: "Use truncate shorthand",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Replace `overflow-hidden text-ellipsis whitespace-nowrap` with the single Tailwind `truncate` utility, which sets all three.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (
        HAS_OVERFLOW_HIDDEN.test(classNameValue) &&
        HAS_TEXT_ELLIPSIS.test(classNameValue) &&
        HAS_WHITESPACE_NOWRAP.test(classNameValue)
      ) {
        context.report({
          node,
          message:
            "`overflow-hidden text-ellipsis whitespace-nowrap` is exactly what the `truncate` utility does — collapse the three classes into `truncate`.",
        });
      }
    },
  }),
});
