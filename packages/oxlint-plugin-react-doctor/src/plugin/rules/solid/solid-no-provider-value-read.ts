import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isProviderElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (isNodeOfType(node.name, "JSXIdentifier")) {
    return node.name.name.endsWith("Provider");
  }
  if (isNodeOfType(node.name, "JSXMemberExpression")) {
    const property = node.name.property;
    if (isNodeOfType(property, "JSXIdentifier")) {
      return property.name === "Provider";
    }
  }
  return false;
};

export const solidNoProviderValueRead = defineRule<Rule>({
  id: "solid-no-provider-value-read",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Pass signal accessors (functions) to context providers, not their read values — `value={count}` not `value={count()}`.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isProviderElement(node)) return;
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const attributeName = getJsxAttributeName(attribute.name);
        if (attributeName !== "value") continue;
        if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) continue;
        const expression = attribute.value.expression as EsTreeNode;
        if (isNodeOfType(expression, "JSXEmptyExpression")) continue;
        if (isNodeOfType(expression, "ObjectExpression")) continue;
        if (!isNodeOfType(expression, "CallExpression")) continue;
        if (expression.arguments.length !== 0) continue;
        const callee = expression.callee;
        if (isNodeOfType(callee, "Identifier")) {
          context.report({
            node: attribute,
            message: `Provider \`value={${callee.name}()}\` reads the signal once — pass the accessor instead: \`value={${callee.name}}\`.`,
          });
        } else if (
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.property, "Identifier")
        ) {
          const objectName = isNodeOfType(callee.object, "Identifier")
            ? `${callee.object.name}.`
            : "";
          const fullName = `${objectName}${callee.property.name}`;
          context.report({
            node: attribute,
            message: `Provider \`value={${fullName}()}\` reads the value once — pass the accessor instead: \`value={() => ${fullName}()}\`.`,
          });
        }
      }
    },
  }),
});
