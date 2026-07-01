import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`parseInt` without a radix infers the base from the string, so a leading `0x` is read as hex and the value is silently wrong; pass an explicit radix like `parseInt(value, 10)`.";

// The `parseInt` name resolving to a same-file user-defined binding (a
// helper function / variable, not an import) means it isn't the global
// `parseInt`, so the radix rule doesn't apply.
const isShadowedByLocalBinding = (calleeIdentifier: EsTreeNode): boolean => {
  const binding = findVariableInitializer(calleeIdentifier, "parseInt");
  const initializer = binding?.initializer;
  if (!initializer) return false;
  return (
    !isNodeOfType(initializer, "ImportSpecifier") &&
    !isNodeOfType(initializer, "ImportDefaultSpecifier") &&
    !isNodeOfType(initializer, "ImportNamespaceSpecifier")
  );
};

// Callee is the global `parseInt` identifier or the `Number.parseInt`
// member. Any other member call (`obj.parseInt`) is unrelated.
const isParseIntCallee = (callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "parseInt" && !isShadowedByLocalBinding(callee);
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "parseInt"
  );
};

export const noParseintWithoutRadix = defineRule({
  id: "no-parseint-without-radix",
  title: "parseInt called without a radix",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Always pass an explicit radix to `parseInt` / `Number.parseInt` (almost always `10`) so a leading `0`/`0x` in the input can't silently change the parsing base.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isParseIntCallee(node.callee as EsTreeNode)) return;
      const args = node.arguments ?? [];
      if (args.length !== 1) return;
      // A spread (`parseInt(...args)`) may carry the radix at runtime — abstain.
      if (isNodeOfType(args[0] as EsTreeNode, "SpreadElement")) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
