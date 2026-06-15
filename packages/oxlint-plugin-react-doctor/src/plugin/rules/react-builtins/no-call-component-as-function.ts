import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

const message = (name: string): string =>
  `\`${name}\` is a component, so calling it as a plain function (\`${name}(...)\`) runs it outside React: its hooks break, it gets no fiber/state, and memoization is lost. Render it as \`<${name} />\` instead.`;

// True when the binding the call resolves to is a same-file component
// definition whose body returns JSX. Resolving through the SYMBOL (not the
// name) makes this shadow-safe: a parameter or local named like a component
// resolves to its own binding, not the component, so it is never flagged.
const symbolIsLocalComponent = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const declaration = symbol.declarationNode;
  if (isComponentDeclaration(declaration)) {
    return functionContainsReactRenderOutput(declaration, context.scopes);
  }
  if (isComponentAssignment(declaration) && symbol.initializer) {
    return functionContainsReactRenderOutput(symbol.initializer, context.scopes);
  }
  return false;
};

// A component is only flagged on strong, shadow-safe evidence: the called
// identifier resolves to a same-file component definition that returns JSX, OR
// to an imported binding that is also rendered as a JSX element in this file.
// PascalCase factories/built-ins (`Boolean(x)`, `MyEnum()`) resolve to a
// global or a non-component binding and are never flagged.
export const noCallComponentAsFunction = defineRule({
  id: "no-call-component-as-function",
  title: "Component called as a function",
  severity: "warn",
  // Test/story files routinely call hookless wrapper components as functions
  // and pass the result to `render(...)` — harmless there, and the dominant
  // real-world firing surface (verified via an OSS eval sweep). `test-noise`
  // skips those files so the rule only nags shipped code.
  tags: ["test-noise"],
  recommendation:
    "Render components as JSX (`<Component />`), never call them like functions (`Component(props)`). A direct call runs the component outside React and breaks hooks, state, and memoization.",
  create: (context: RuleContext) => {
    const renderedJsxNames = new Set<string>();
    const candidateCalls: Array<{ node: EsTreeNode; callee: EsTreeNode; name: string }> = [];

    const visitors: RuleVisitors = {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isUppercaseName(node.name.name)) {
          renderedJsxNames.add(node.name.name);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && isUppercaseName(node.callee.name)) {
          candidateCalls.push({ node, callee: node.callee, name: node.callee.name });
        }
      },
      "Program:exit"() {
        for (const candidate of candidateCalls) {
          const symbol = context.scopes.symbolFor(candidate.callee);
          if (!symbol) continue;
          const isComponent =
            symbolIsLocalComponent(symbol, context) ||
            (symbol.kind === "import" && renderedJsxNames.has(candidate.name));
          if (isComponent) {
            context.report({ node: candidate.node, message: message(candidate.name) });
          }
        }
      },
    };
    return visitors;
  },
});
