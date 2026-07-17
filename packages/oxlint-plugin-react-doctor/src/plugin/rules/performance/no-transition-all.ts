import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStringFromClassNameAttr } from "../design/utils/get-string-from-class-name-attr.js";

// `transition-all` as a whole Tailwind token (the segment after any
// variant prefixes), so `hover:transition-all` / `md:transition-all` match
// but compound classes like `transition-all-custom` do not. Tailwind's bare
// `transition` maps to a curated property list (color/bg/border/opacity/
// shadow/transform/filter) — NOT `all` — so it is intentionally not flagged.
const hasTransitionAllClass = (classNameValue: string): boolean =>
  getClassNameTokens(classNameValue).some((token) => token === "transition-all");

const TRANSITION_ALL_VALUE_PATTERN = /(?:^|,)\s*all(?:\s|,|$)/i;

const TAILWIND_MESSAGE =
  "Your users see janky animation because `transition-all` animates every property that changes, including expensive layout ones and instant ones like focus rings. Name the properties: `transition-colors`, `transition-opacity`, or `transition-transform`.";

export const noTransitionAll = defineRule({
  id: "no-transition-all",
  title: "transition: all animates everything",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'List the specific properties: `transition: "opacity 200ms, transform 200ms"`. In Tailwind, use `transition-colors`, `transition-opacity`, or `transition-transform`',
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "style") return;
      if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const expression = node.value.expression;
      if (!isNodeOfType(expression, "ObjectExpression")) return;

      for (const property of expression.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const key = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
        if (key !== "transition" && key !== "transitionProperty") continue;

        if (
          isNodeOfType(property.value, "Literal") &&
          typeof property.value.value === "string" &&
          TRANSITION_ALL_VALUE_PATTERN.test(property.value.value.trim())
        ) {
          context.report({
            node: property,
            message:
              'This can stutter because transition: "all" animates every property, even slow layout ones, so list only the properties you actually change',
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      if (hasTransitionAllClass(classNameValue)) {
        context.report({ node, message: TAILWIND_MESSAGE });
      }
    },
  }),
});
