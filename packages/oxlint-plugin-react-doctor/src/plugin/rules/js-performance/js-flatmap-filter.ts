import { SMALL_LITERAL_ARRAY_MAX_ELEMENTS } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const BOUNDED_PIPELINE_SOURCE_METHOD_NAMES = new Set(["slice", "split"]);

const isBoundedPipelineSource = (node: EsTreeNode): boolean => {
  const receiver = stripParenExpression(node);
  return (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    BOUNDED_PIPELINE_SOURCE_METHOD_NAMES.has(receiver.callee.property.name)
  );
};

export const jsFlatmapFilter = defineRule({
  id: "js-flatmap-filter",
  title: ".map().filter(Boolean) loops twice",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `.flatMap(item => condition ? [value] : [])` to change and drop items in one pass, instead of building a throwaway array in between",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !isNodeOfType(node.callee.property, "Identifier")
      )
        return;

      const outerMethod = node.callee.property.name;
      if (outerMethod !== "filter") return;

      const filterArgument = node.arguments?.[0];
      if (!filterArgument) return;

      const isIdentityArrow =
        isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
        filterArgument.params?.length === 1 &&
        isNodeOfType(filterArgument.body, "Identifier") &&
        isNodeOfType(filterArgument.params[0], "Identifier") &&
        filterArgument.body.name === filterArgument.params[0].name;

      const isFilterBoolean =
        (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
        isIdentityArrow;

      if (!isFilterBoolean) return;

      const innerCall = stripParenExpression(node.callee.object);
      if (
        !isNodeOfType(innerCall, "CallExpression") ||
        !isNodeOfType(innerCall.callee, "MemberExpression") ||
        !isNodeOfType(innerCall.callee.property, "Identifier")
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (innerMethod !== "map") return;

      // `[a, b, c].map(...).filter(Boolean)` — iterating a small
      // literal twice is trivial cost; the flatMap rewrite is pure
      // ceremony at this scale.
      const receiver: EsTreeNode | null | undefined = stripParenExpression(innerCall.callee.object);
      if (receiver && isBoundedPipelineSource(receiver)) return;
      if (receiver && isNodeOfType(receiver, "ArrayExpression")) {
        const elements = receiver.elements ?? [];
        if (
          elements.length > 0 &&
          elements.length <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS &&
          elements.every((element) => element == null || !isNodeOfType(element, "SpreadElement"))
        ) {
          return;
        }
      }

      context.report({
        node,
        message:
          "This loops over your list twice because .map().filter(Boolean) makes two passes, so use .flatMap() to change & drop items in one pass",
      });
    },
  }),
});
