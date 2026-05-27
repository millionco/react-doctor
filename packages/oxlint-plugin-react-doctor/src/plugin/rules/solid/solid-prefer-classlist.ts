import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { readSolidRuleSettings } from "../../utils/read-solid-rule-settings.js";

const DEFAULT_CLASSNAMES: ReadonlyArray<string> = ["cn", "clsx", "classnames"];

interface SolidPreferClasslistSettings {
  classnames?: ReadonlyArray<string>;
}

const hasClasslistAttribute = (attributes: ReadonlyArray<EsTreeNode>): boolean => {
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (getJsxAttributeName(attribute.name) === "classlist") return true;
  }
  return false;
};

// Port of `solid/prefer-classlist`. DEPRECATED upstream (classlist is
// itself being phased out in favour of native `class={cn(...)}` calls
// now that Solid 1.7+ handles object-valued `class` props). Off by
// default — opt in via severityControls if you still use classlist.
export const solidPreferClasslist = defineRule<Rule>({
  id: "solid-prefer-classlist",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation: "Prefer Solid's `classlist={{...}}` over `class={cn({...})}` for object syntax.",
  create: (context: RuleContext) => {
    const settings = readSolidRuleSettings<SolidPreferClasslistSettings>(
      context.settings,
      "solidPreferClasslist",
    );
    const classnames = new Set(settings.classnames ?? DEFAULT_CLASSNAMES);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const propertyName = getJsxAttributeName(node.name);
        if (propertyName !== "class" && propertyName !== "className") return;
        const opening = node.parent;
        if (!opening || !isNodeOfType(opening, "JSXOpeningElement")) return;
        if (hasClasslistAttribute(opening.attributes)) return;
        if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const expression = node.value.expression;
        if (!isNodeOfType(expression, "CallExpression")) return;
        if (!isNodeOfType(expression.callee, "Identifier")) return;
        if (!classnames.has(expression.callee.name)) return;
        if (expression.arguments.length !== 1) return;
        const firstArgument = expression.arguments[0];
        if (!firstArgument || !isNodeOfType(firstArgument, "ObjectExpression")) return;
        context.report({
          node,
          message: `Prefer the \`classlist\` prop over ${expression.callee.name} to set classes from an object.`,
        });
      },
    };
  },
});
