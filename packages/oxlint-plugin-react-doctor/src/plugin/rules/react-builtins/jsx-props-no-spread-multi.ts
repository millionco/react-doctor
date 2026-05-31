import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const buildIdentifierMessage = (name: string): string =>
  `The later spread of \`${name}\` silently overrides the earlier one.`;
const buildMemberMessage = (name: string): string =>
  `The later spread of \`${name}\` silently overrides the earlier one.`;

const flattenMemberExpressionName = (node: EsTreeNode): string | null => {
  // Peel parens / TS wrappers at every recursion step so that
  // `(props.foo).baz` and `(props.foo.baz)` flatten to the same
  // canonical name.
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "ThisExpression")) return "this";
  if (isNodeOfType(stripped, "MemberExpression")) {
    const objectName = flattenMemberExpressionName(stripped.object);
    if (!objectName) return null;
    if (isNodeOfType(stripped.property, "Identifier") && !stripped.computed) {
      return `${objectName}.${stripped.property.name}`;
    }
    if (isNodeOfType(stripped.property, "Literal") && typeof stripped.property.value === "string") {
      return `${objectName}.${stripped.property.value}`;
    }
  }
  return null;
};

// Port of `oxc_linter::rules::react::jsx_props_no_spread_multi`. Reports
// when the same identifier or member expression is spread more than once
// in a single JSX element (`<C {...props} {...props} />` or
// `<C {...this.props} {...this.props} />`).
export const jsxPropsNoSpreadMulti = defineRule<Rule>({
  id: "jsx-props-no-spread-multi",
  title: "Same prop spread multiple times",
  severity: "warn",
  recommendation: "Spread the same value at most once per element.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const seenNames = new Map<string, EsTreeNode>();
      const reportedNames = new Set<string>();
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
        const argument = stripParenExpression(attribute.argument);
        const isIdentifier = isNodeOfType(argument, "Identifier");
        const name = flattenMemberExpressionName(argument);
        if (!name) continue;
        if (seenNames.has(name)) {
          if (!reportedNames.has(name)) {
            context.report({
              node: attribute,
              message: isIdentifier ? buildIdentifierMessage(name) : buildMemberMessage(name),
            });
            reportedNames.add(name);
          }
        } else {
          seenNames.set(name, attribute);
        }
      }
    },
  }),
});
