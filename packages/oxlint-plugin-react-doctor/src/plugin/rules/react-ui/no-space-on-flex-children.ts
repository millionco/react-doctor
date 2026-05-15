import { FLEX_OR_GRID_DISPLAY_TOKENS, SPACE_AXIS_PATTERN } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getClassNameLiteral } from "./utils/get-class-name-literal.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const tokenizeClassName = (classNameValue: string): string[] =>
  classNameValue.split(/\s+/).filter(Boolean);

export const noSpaceOnFlexChildren = defineRule<Rule>({
  id: "design-no-space-on-flex-children",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Use `gap-*` on the flex/grid parent. `space-x-*` / `space-y-*` produce phantom gaps when a sibling is conditionally rendered, lose vertical spacing on wrapped lines, and don't mirror in RTL",
  create: (context: RuleContext) => ({
    JSXAttribute(jsxAttribute: EsTreeNodeOfType<"JSXAttribute">) {
      if (
        !isNodeOfType(jsxAttribute.name, "JSXIdentifier") ||
        jsxAttribute.name.name !== "className"
      ) {
        return;
      }
      const classNameLiteral = getClassNameLiteral(jsxAttribute);
      if (!classNameLiteral) return;
      const tokens = tokenizeClassName(classNameLiteral);
      let hasFlexOrGridLayout = false;
      for (const token of tokens) {
        // Strip Tailwind variant prefixes (`md:flex`, `dark:hover:grid`).
        const lastSegment = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
        if (FLEX_OR_GRID_DISPLAY_TOKENS.has(lastSegment)) {
          hasFlexOrGridLayout = true;
          break;
        }
      }
      if (!hasFlexOrGridLayout) return;
      const spaceMatch = classNameLiteral.match(SPACE_AXIS_PATTERN);
      if (!spaceMatch) return;
      // HACK: preserve the axis in the suggestion — `space-x-4` maps
      // to `gap-x-4` (horizontal only). A bare `gap-4` would also add
      // vertical gap, silently changing layout for the developer who
      // followed the hint.
      const spaceAxis = spaceMatch[1];
      const spaceValue = spaceMatch[2];
      context.report({
        node: jsxAttribute,
        message: `space-${spaceAxis}-${spaceValue} on a flex/grid parent — use gap-${spaceAxis}-${spaceValue} instead. Per-sibling margins phantom-gap on conditional render and don't mirror in RTL`,
      });
    },
  }),
});
