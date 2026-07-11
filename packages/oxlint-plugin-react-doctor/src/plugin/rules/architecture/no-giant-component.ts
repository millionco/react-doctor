import { GIANT_COMPONENT_LINE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { unwrapReactHocFunction } from "../../utils/unwrap-react-hoc-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noGiantComponent = defineRule({
  id: "no-giant-component",
  title: "Large component is hard to read and change",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Pull each section into its own component so the parent is easier to read, test, and change.",
  create: (context: RuleContext) => {
    const getOversizedComponentLineCount = (bodyNode: EsTreeNode): number | null => {
      if (!bodyNode.loc) return null;
      const lineCount = bodyNode.loc.end.line - bodyNode.loc.start.line + 1;
      return lineCount > GIANT_COMPONENT_LINE_THRESHOLD ? lineCount : null;
    };

    const reportOversizedComponent = (nameNode: EsTreeNode, componentName: string): void => {
      context.report({
        node: nameNode,
        message: `Component "${componentName}" is over ${GIANT_COMPONENT_LINE_THRESHOLD} lines long, which is hard to read & change. Split it into a few smaller components.`,
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        const lineCount = getOversizedComponentLineCount(node);
        if (lineCount === null) return;
        if (!functionContainsReactRenderOutput(node, context.scopes)) return;
        reportOversizedComponent(node.id, node.id.name);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !isUppercaseName(node.id.name)) return;
        const functionNode = unwrapReactHocFunction(node.init);
        if (!functionNode) return;
        const lineCount = getOversizedComponentLineCount(functionNode);
        if (lineCount === null) return;
        if (!functionContainsReactRenderOutput(functionNode, context.scopes)) return;
        reportOversizedComponent(node.id, node.id.name);
      },
    };
  },
});
