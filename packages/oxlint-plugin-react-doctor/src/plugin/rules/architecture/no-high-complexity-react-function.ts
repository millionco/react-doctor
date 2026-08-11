import {
  REACT_FUNCTION_COGNITIVE_COMPLEXITY_THRESHOLD,
  REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD,
} from "../../constants/thresholds.js";
import { calculateFunctionComplexity } from "../../semantic/function-complexity.js";
import {
  componentOrHookDisplayNameForFunction,
  findComponentHocExpressionRoot,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noHighComplexityReactFunction = defineRule({
  id: "no-high-complexity-react-function",
  title: "React function has high control-flow complexity",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Extract independent render branches and state logic into focused components or hooks until the control flow is easy to follow.",
  create: (context: RuleContext) => {
    const checkReactFunction = (functionNode: EsTreeNode): void => {
      const expressionRoot = findComponentHocExpressionRoot(functionNode);
      const isAnonymousDefaultExport =
        isNodeOfType(expressionRoot.parent, "ExportDefaultDeclaration") &&
        expressionRoot.parent.declaration === expressionRoot;
      const displayName =
        componentOrHookDisplayNameForFunction(functionNode) ??
        (isAnonymousDefaultExport ? "default export" : null);
      if (!displayName) return;
      if (
        !isReactHookName(displayName) &&
        !functionHasReactComponentEvidence(functionNode, context.scopes, context.cfg)
      ) {
        return;
      }
      const functionControlFlow = context.cfg.cfgFor(functionNode);
      if (!functionControlFlow) return;
      const complexity = calculateFunctionComplexity(functionNode, functionControlFlow);
      if (
        complexity.cyclomatic <= REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD &&
        complexity.cognitive <= REACT_FUNCTION_COGNITIVE_COMPLEXITY_THRESHOLD
      ) {
        return;
      }
      context.report({
        node: functionNode,
        message: `\`${displayName}\` has cyclomatic complexity ${complexity.cyclomatic}, cognitive complexity ${complexity.cognitive}, and maximum nesting depth ${complexity.maxNestingDepth}, so its React logic is hard to understand and change. Extract independent branches into components or hooks.`,
      });
    };

    return {
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        checkReactFunction(node);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        checkReactFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        checkReactFunction(node);
      },
    };
  },
});
