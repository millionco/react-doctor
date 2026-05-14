import { GIANT_COMPONENT_LINE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGiantComponent = defineRule<Rule>({
  id: "no-giant-component",
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.",
  examples: [
    {
      before: "function UserPage() {\n  // …300+ lines of JSX, hooks, and handlers…\n}",
      after:
        "function UserPage() {\n  return (\n    <>\n      <UserHeader />\n      <UserActions />\n    </>\n  );\n}",
    },
  ],
  create: (context: RuleContext) => {
    const reportOversizedComponent = (
      nameNode: EsTreeNode,
      componentName: string,
      bodyNode: EsTreeNode,
    ): void => {
      if (!bodyNode.loc) return;
      const lineCount = bodyNode.loc.end.line - bodyNode.loc.start.line + 1;
      if (lineCount > GIANT_COMPONENT_LINE_THRESHOLD) {
        context.report({
          node: nameNode,
          message: `Component "${componentName}" is ${lineCount} lines — consider breaking it into smaller focused components`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        reportOversizedComponent(node.id, node.id.name, node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        reportOversizedComponent(node.id, node.id.name, node.init);
      },
    };
  },
});
