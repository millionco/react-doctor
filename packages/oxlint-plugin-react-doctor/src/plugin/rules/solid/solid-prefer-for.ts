import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getMemberPropertyName = (node: EsTreeNodeOfType<"MemberExpression">): string | null => {
  if (node.computed) {
    if (isNodeOfType(node.property, "Literal") && typeof node.property.value === "string") {
      return node.property.value;
    }
    return null;
  }
  if (isNodeOfType(node.property, "Identifier")) return node.property.name;
  return null;
};

const isFunctionLikeArgument = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  return isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression");
};

// Port of `solid/prefer-for` — flag `{items.map((item) => <Foo />)}`
// inside JSX because Solid's `<For>` component does keyed-by-identity
// reconciliation, while `Array.prototype.map` recreates every DOM
// node on each render.
export const solidPreferFor = defineRule<Rule>({
  id: "solid-prefer-for",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Use Solid's `<For each={items}>{(item) => ...}</For>` instead of `items.map((item) => ...)` inside JSX.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callOrChain =
        node.parent && isNodeOfType(node.parent, "ChainExpression") ? node.parent : node;
      const jsxExpressionContainer = callOrChain.parent;
      if (
        !jsxExpressionContainer ||
        !isNodeOfType(jsxExpressionContainer, "JSXExpressionContainer")
      ) {
        return;
      }
      const jsxParent = jsxExpressionContainer.parent;
      if (
        !jsxParent ||
        (!isNodeOfType(jsxParent, "JSXElement") && !isNodeOfType(jsxParent, "JSXFragment"))
      ) {
        return;
      }
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getMemberPropertyName(node.callee) !== "map") return;
      if (node.arguments.length !== 1) return;
      const firstArgument = node.arguments[0];
      if (!isFunctionLikeArgument(firstArgument)) return;
      if (
        !isNodeOfType(firstArgument, "ArrowFunctionExpression") &&
        !isNodeOfType(firstArgument, "FunctionExpression")
      ) {
        return;
      }
      const usesIndexParameter =
        firstArgument.params.length > 1 ||
        (firstArgument.params.length === 1 && isNodeOfType(firstArgument.params[0], "RestElement"));
      context.report({
        node,
        message: usesIndexParameter
          ? "Use Solid's `<For />` or `<Index />` instead of Array#map — it recreates DOM nodes on every render."
          : "Use Solid's `<For />` instead of Array#map — it recreates DOM nodes on every render.",
      });
    },
  }),
});
