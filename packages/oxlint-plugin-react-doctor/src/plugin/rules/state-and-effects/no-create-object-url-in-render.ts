import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const isGlobalCreateObjectUrlCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(node.callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "URL" &&
    context.scopes.isGlobalReference(receiver) &&
    getStaticPropertyName(node.callee) === "createObjectURL"
  );
};

export const noCreateObjectUrlInRender = defineRule({
  id: "no-create-object-url-in-render",
  title: "Object URL is created during render",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Create object URLs in an effect or event handler and revoke each URL when it is replaced or no longer needed.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isGlobalCreateObjectUrlCall(node, context)) return;
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
      context.report({
        node,
        message:
          "URL.createObjectURL() creates a disposable browser resource during render. Move it to an effect or event and call URL.revokeObjectURL() during cleanup.",
      });
    },
  }),
});
