import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface NestedComponentCandidate {
  reportNode: EsTreeNode;
  name: string;
  enclosingName: string;
}

export const noNestedComponentDefinition = defineRule({
  id: "no-nested-component-definition",
  title: "Component defined inside another component",
  tags: ["test-noise", "react-jsx-only"],
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move it to module scope or a separate file so React does not recreate the component and erase its state on every parent render.",
  create: (context: RuleContext) => {
    const componentStack: string[] = [];
    const candidates: NestedComponentCandidate[] = [];
    // Only a PascalCase binding that is actually RENDERED as a JSX
    // element (`<Name/>`) creates a child fiber that React remounts.
    // A capitalized helper that is exclusively invoked as `Name()` is
    // inlined into the parent's render (no separate fiber, no state to
    // lose), so requiring JSX-render membership before reporting drops
    // the inline-render-helper false positives.
    const renderedJsxNames = new Set<string>();

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isNodeOfType(node.name, "JSXIdentifier") && isUppercaseName(node.name.name)) {
          renderedJsxNames.add(node.name.name);
        }
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        if (componentStack.length > 0) {
          candidates.push({
            reportNode: node.id,
            name: node.id.name,
            enclosingName: componentStack[componentStack.length - 1],
          });
        }
        componentStack.push(node.id.name);
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (isComponentDeclaration(node)) componentStack.pop();
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (componentStack.length > 0) {
          candidates.push({
            reportNode: node.id,
            name: node.id.name,
            enclosingName: componentStack[componentStack.length - 1],
          });
        }
        componentStack.push(node.id.name);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) componentStack.pop();
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          if (!renderedJsxNames.has(candidate.name)) continue;
          context.report({
            node: candidate.reportNode,
            message: `Your users lose all state in "${candidate.name}" on every render because it's defined inside "${candidate.enclosingName}", so move it out to the top of the file.`,
          });
        }
      },
    };
  },
});
