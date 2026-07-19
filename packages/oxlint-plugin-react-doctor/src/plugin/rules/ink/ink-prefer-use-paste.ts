import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const interpretsPastedInput = (handler: EsTreeNode): boolean => {
  if (
    (!isNodeOfType(handler, "ArrowFunctionExpression") &&
      !isNodeOfType(handler, "FunctionExpression")) ||
    !isNodeOfType(handler.params[0], "Identifier")
  ) {
    return false;
  }
  const inputName = handler.params[0].name;
  let isPasteLogic = false;
  walkAst(handler.body, (descendantNode) => {
    if (isNodeOfType(descendantNode, "CallExpression")) {
      const callee = descendantNode.callee;
      const inputReceiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : null;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        inputReceiver &&
        isNodeOfType(inputReceiver, "Identifier") &&
        inputReceiver.name === inputName &&
        (getStaticPropertyName(callee) === "includes" ||
          getStaticPropertyName(callee) === "split") &&
        descendantNode.arguments.some(
          (argumentNode) => isNodeOfType(argumentNode, "Literal") && argumentNode.value === "\n",
        )
      ) {
        isPasteLogic = true;
      }
    }
    if (
      isNodeOfType(descendantNode, "BinaryExpression") &&
      [">", ">="].includes(descendantNode.operator) &&
      isNodeOfType(descendantNode.left, "MemberExpression") &&
      isNodeOfType(descendantNode.left.object, "Identifier") &&
      descendantNode.left.object.name === inputName &&
      getStaticPropertyName(descendantNode.left) === "length" &&
      isNodeOfType(descendantNode.right, "Literal") &&
      typeof descendantNode.right.value === "number" &&
      descendantNode.right.value >= 1
    ) {
      isPasteLogic = true;
    }
  });
  return isPasteLogic;
};

export const inkPreferUsePaste = defineRule({
  id: "ink-prefer-use-paste",
  title: "Paste interpreted through useInput",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.modernHooks,
  recommendation: "Use Ink's `usePaste()` for bracketed multi-character paste input.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (resolveInkApiName(node.callee, context.scopes) !== "useInput") return;
      const handler = node.arguments[0];
      if (!handler || !interpretsPastedInput(handler)) return;
      context.report({
        node,
        message: "Use `usePaste()` instead of inferring paste events from `useInput()` chunks.",
      });
    },
  }),
});
