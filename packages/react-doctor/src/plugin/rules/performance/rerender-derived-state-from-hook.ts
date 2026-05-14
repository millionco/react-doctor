import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const CONTINUOUS_VALUE_HOOK_PATTERN =
  /^use(?:Window(?:Width|Height|Dimensions)|Scroll(?:Position|Y|X)|MousePosition|ResizeObserver|IntersectionObserver)/;

// HACK: hooks that return a continuously-changing numeric value
// (`useWindowWidth`, `useScrollPosition`, etc.) trigger a re-render on
// every change. If the component only cares about a coarser boolean
// derived from that value (`width < 768` → "is mobile"), it ends up
// rendering on every pixel of resize. Use a media-query / threshold
// hook (`useMediaQuery("(max-width: 767px)")`) which only fires when
// the threshold flips.
//
// Heuristic: `const x = useFooBar(...)` immediately followed by a
// `const y = x [<>=] literal` (or boolean expression on x), where y is
// the only value referenced in the JSX.
const isThresholdComparison = (node: EsTreeNode, valueName: string): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (!["<", "<=", ">", ">=", "===", "!==", "==", "!="].includes(node.operator)) return false;
  const referencesContinuous =
    (isNodeOfType(node.left, "Identifier") && node.left.name === valueName) ||
    (isNodeOfType(node.right, "Identifier") && node.right.name === valueName);
  if (!referencesContinuous) return false;
  return isNodeOfType(node.left, "Literal") || isNodeOfType(node.right, "Literal");
};

const findThresholdDerivedBindings = (
  componentBody: EsTreeNode,
): Array<{ continuousName: string; hookName: string; declarator: EsTreeNode }> => {
  const out: Array<{ continuousName: string; hookName: string; declarator: EsTreeNode }> = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return out;
  const statements = componentBody.body ?? [];

  for (let outerIndex = 0; outerIndex < statements.length; outerIndex++) {
    const outerStatement = statements[outerIndex];
    if (!isNodeOfType(outerStatement, "VariableDeclaration")) continue;

    for (const declarator of outerStatement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const init = declarator.init;
      if (!isNodeOfType(init, "CallExpression")) continue;
      if (!isNodeOfType(init.callee, "Identifier")) continue;
      if (!CONTINUOUS_VALUE_HOOK_PATTERN.test(init.callee.name)) continue;

      const continuousName = declarator.id.name;
      const hookName = init.callee.name;

      // Look at the next statement(s) for a derived threshold binding.
      for (let innerIndex = outerIndex + 1; innerIndex < statements.length; innerIndex++) {
        const innerStatement = statements[innerIndex];
        if (!isNodeOfType(innerStatement, "VariableDeclaration")) break;
        let foundThreshold = false;
        for (const innerDecl of innerStatement.declarations ?? []) {
          if (innerDecl.init && isThresholdComparison(innerDecl.init, continuousName)) {
            foundThreshold = true;
            break;
          }
        }
        if (foundThreshold) {
          out.push({ continuousName, hookName, declarator });
          break;
        }
      }
    }
  }
  return out;
};

export const rerenderDerivedStateFromHook = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    'Use a threshold/media-query hook (e.g. `useMediaQuery("(max-width: 767px)")`) — the component re-renders only when the threshold flips, not every pixel',
  examples: [
    {
      before: "const width = useWindowWidth();\nconst isMobile = width < 768;",
      after: "const isMobile = useMediaQuery('(max-width: 767px)');",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = findThresholdDerivedBindings(componentBody);
      for (const binding of bindings) {
        context.report({
          node: binding.declarator,
          message: `${binding.hookName}() returns a continuously-changing value but you only compare it to a threshold — use a media-query / threshold hook (e.g. \`useMediaQuery("(max-width: 767px)")\`) so the component re-renders only when the threshold flips`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
