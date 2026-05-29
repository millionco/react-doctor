import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? node.expression : node;

const hasEmptyDependencyArray = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const dependencyArray = node.arguments[1];
  return (
    Boolean(dependencyArray) &&
    isNodeOfType(dependencyArray, "ArrayExpression") &&
    dependencyArray.elements.length === 0
  );
};

const isFocusCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = unwrapChainExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return callee.property.name === "focus";
};

const effectCallbackContainsFocusCall = (callback: EsTreeNode): boolean => {
  let didFindFocusCall = false;
  walkAst(callback, (child: EsTreeNode) => {
    if (didFindFocusCall) return false;
    if (isFocusCall(child)) didFindFocusCall = true;
  });
  return didFindFocusCall;
};

export const noFocusOnMount = defineRule<Rule>({
  id: "no-focus-on-mount",
  severity: "warn",
  recommendation:
    "Move the focus into the user action that opens the UI, or gate it on an explicit ready/open state instead of running it on mount.\n\n```tsx\nuseEffect(() => {\n  if (isOpen) inputRef.current?.focus();\n}, [isOpen]);\n```",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      if (!hasEmptyDependencyArray(node)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;
      if (!effectCallbackContainsFocusCall(callback)) return;
      context.report({
        node,
        message:
          "focus() in a mount effect can steal focus before the UI is ready - move it behind a user action or an explicit open state",
      });
    },
  }),
});
