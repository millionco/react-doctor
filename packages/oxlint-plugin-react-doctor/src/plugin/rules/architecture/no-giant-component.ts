import { GIANT_COMPONENT_LINE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGiantComponent = defineRule<Rule>({
  id: "no-giant-component",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.",
  create: (context: RuleContext) => {
    const getOversizedComponentLineCount = (bodyNode: EsTreeNode): number | null => {
      if (!bodyNode.loc) return null;
      const lineCount = bodyNode.loc.end.line - bodyNode.loc.start.line + 1;
      return lineCount > GIANT_COMPONENT_LINE_THRESHOLD ? lineCount : null;
    };

    const reportOversizedComponent = (
      nameNode: EsTreeNode,
      componentName: string,
      lineCount: number,
    ): void => {
      context.report({
        node: nameNode,
        message: `Component "${componentName}" is ${lineCount} lines — consider breaking it into smaller focused components`,
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        const lineCount = getOversizedComponentLineCount(node);
        if (lineCount === null) return;
        if (!functionContainsReactRenderOutput(node, context.scopes)) return;
        reportOversizedComponent(node.id, node.id.name, lineCount);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        const lineCount = getOversizedComponentLineCount(node.init);
        if (lineCount === null) return;
        if (!functionContainsReactRenderOutput(node.init, context.scopes)) return;
        reportOversizedComponent(node.id, node.id.name, lineCount);
      },
    };
  },
});
