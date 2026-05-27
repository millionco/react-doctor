import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SET_STATE_PATTERN = /^set[A-Z]/;

const findSetStateInBody = (body: EsTreeNode): EsTreeNode | null => {
  let setStateCallNode: EsTreeNode | null = null;
  walkAst(body, (child: EsTreeNode) => {
    if (setStateCallNode) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      SET_STATE_PATTERN.test(child.callee.name)
    ) {
      setStateCallNode = child;
    }
  });
  return setStateCallNode;
};

// HACK: setting React state inside an onScroll handler triggers a re-render
// at scroll-event frequency (60-120Hz). Use a Reanimated shared value
// (useSharedValue + useAnimatedScrollHandler) or a ref + raf throttle so
// the JS thread isn't pegged.
export const rnNoScrollState = defineRule<Rule>({
  id: "rn-no-scroll-state",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "Track scroll position with a Reanimated shared value (`useAnimatedScrollHandler`) or a ref — `setState` on every scroll event causes re-render storms",
  create: (context: RuleContext) => {
    const stateSettersInHandlers = new Map<string, EsTreeNode>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        const variableName = node.id.name;
        if (!/scroll/i.test(variableName)) return;

        const init = node.init;
        if (
          !isNodeOfType(init, "ArrowFunctionExpression") &&
          !isNodeOfType(init, "FunctionExpression")
        )
          return;

        const setStateCall = findSetStateInBody(init.body);
        if (setStateCall) {
          stateSettersInHandlers.set(variableName, setStateCall);
        }
      },

      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (node.name.name !== "onScroll") return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const expression = node.value.expression;

        if (isNodeOfType(expression, "Identifier")) {
          const tracked = stateSettersInHandlers.get(expression.name);
          if (tracked) {
            context.report({
              node: tracked,
              message:
                "setState in onScroll handler triggers re-renders on every scroll event — use a Reanimated shared value (useAnimatedScrollHandler) or a ref to track scroll position",
            });
          }
          return;
        }

        if (
          !isNodeOfType(expression, "ArrowFunctionExpression") &&
          !isNodeOfType(expression, "FunctionExpression")
        ) {
          return;
        }

        const setStateCallNode = findSetStateInBody(expression.body);
        if (setStateCallNode) {
          context.report({
            node: setStateCallNode,
            message:
              "setState in onScroll triggers re-renders on every scroll event — use a Reanimated shared value (useAnimatedScrollHandler) or a ref to track scroll position",
          });
        }
      },
    };
  },
});
