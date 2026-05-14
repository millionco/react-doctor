import { defineRule } from "../../utils/define-rule.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: React 19 removes `Component.defaultProps` for FUNCTION components
// (class components still tolerate it but the team recommends ES6
// default parameters anyway). Detection target: any
// `<Identifier>.defaultProps = <ObjectExpression>` assignment where the
// identifier looks like a component (uppercase first letter). We can't
// distinguish class vs function from the assignment alone, but the
// recommendation is the same either way — switch to ES6 default params
// in destructured props — so the guidance is uniform.
export const noDefaultProps = defineRule<Rule>({
  id: "no-default-props",
  requires: ["react:19"],
  tags: ["test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    'React 19 removes `Component.defaultProps` for function components. Move the defaults into the destructured props parameter: `function Foo({ size = "md", variant = "primary" })` instead of `Foo.defaultProps = { size: "md", variant: "primary" }`.',
  examples: [
    {
      before:
        'function Button({ size, variant }) { return <button />; }\nButton.defaultProps = { size: "md", variant: "primary" };',
      after: 'function Button({ size = "md", variant = "primary" }) { return <button />; }',
    },
  ],
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      const left = node.left;
      if (!isNodeOfType(left, "MemberExpression")) return;
      if (left.computed) return;
      if (!isNodeOfType(left.property, "Identifier") || left.property.name !== "defaultProps")
        return;
      if (!isNodeOfType(left.object, "Identifier")) return;
      if (!isUppercaseName(left.object.name)) return;
      context.report({
        node: left,
        message: `${left.object.name}.defaultProps — React 19 removes \`defaultProps\` for function components and discourages it for class components. Move defaults into the destructured props parameter (e.g. \`function ${left.object.name}({ size = "md", ...rest })\`) so the rule applies cleanly to both shapes`,
      });
    },
  }),
});
