import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noNestedComponentDefinition = defineRule<Rule>({
  id: "no-nested-component-definition",
  title: "Component defined inside another component",
  tags: ["test-noise", "react-jsx-only"],
  severity: "error",
  category: "Correctness",
  recommendation: "Move to a separate file or to module scope above the parent component",
  create: (context: RuleContext) => {
    const componentStack: string[] = [];

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        if (componentStack.length > 0) {
          context.report({
            node: node.id,
            message: `Your users lose all state in "${node.id.name}" on every render because it's defined inside "${componentStack[componentStack.length - 1]}", so move it out to the top of the file.`,
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
          context.report({
            node: node.id,
            message: `Your users lose all state in "${node.id.name}" on every render because it's defined inside "${componentStack[componentStack.length - 1]}", so move it out to the top of the file.`,
          });
        }
        componentStack.push(node.id.name);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) componentStack.pop();
      },
    };
  },
});
