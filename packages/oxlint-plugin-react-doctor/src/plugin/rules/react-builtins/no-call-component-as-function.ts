import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const message = (name: string): string =>
  `\`${name}\` is a component, so calling it as a plain function (\`${name}(...)\`) runs it outside React: its hooks break, it gets no fiber/state, and memoization is lost. Render it as \`<${name} />\` instead.`;

// A PascalCase identifier is treated as a component only on strong, local
// evidence: it is rendered as a JSX element somewhere in this file, OR it is
// defined in this file as a PascalCase function whose body returns JSX. That
// keeps the rule high-precision — PascalCase factories/built-ins (`Boolean(x)`,
// `MyEnum()`) are never JSX-rendered and never return JSX, so they're never
// flagged, and lowercase render helpers (`renderRow()`) are out of scope by
// the naming convention. Calling an imported component that is never rendered
// in this file is a v1 non-goal.
export const noCallComponentAsFunction = defineRule({
  id: "no-call-component-as-function",
  title: "Component called as a function",
  severity: "warn",
  recommendation:
    "Render components as JSX (`<Component />`), never call them like functions (`Component(props)`). A direct call runs the component outside React and breaks hooks, state, and memoization.",
  create: (context) => {
    const knownComponentNames = new Set<string>();
    const candidateCalls: Array<{ node: EsTreeNode; name: string }> = [];

    const visitors: RuleVisitors = {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (
          isComponentDeclaration(node) &&
          functionContainsReactRenderOutput(node, context.scopes)
        ) {
          if (node.id) knownComponentNames.add(node.id.name);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (
          isComponentAssignment(node) &&
          node.init &&
          functionContainsReactRenderOutput(node.init, context.scopes) &&
          isNodeOfType(node.id, "Identifier")
        ) {
          knownComponentNames.add(node.id.name);
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isUppercaseName(node.name.name)) {
          knownComponentNames.add(node.name.name);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && isUppercaseName(node.callee.name)) {
          candidateCalls.push({ node, name: node.callee.name });
        }
      },
      "Program:exit"() {
        for (const candidate of candidateCalls) {
          if (knownComponentNames.has(candidate.name)) {
            context.report({ node: candidate.node, message: message(candidate.name) });
          }
        }
      },
    };
    return visitors;
  },
});
