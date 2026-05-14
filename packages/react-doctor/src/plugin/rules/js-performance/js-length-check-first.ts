import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule<Rule>({
  id: "js-length-check-first",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately",
  examples: [
    {
      before: "const isEqual = a.every((x, i) => x === b[i]);",
      after: "const isEqual = a.length === b.length && a.every((x, i) => x === b[i]);",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      ) {
        return;
      }
      const params = callback.params ?? [];
      if (params.length < 2) return; // need (item, index, ...) to address other array

      // Look for `other[index]` access in the body, suggesting elementwise compare.
      let referencesOtherArrayByIndex = false;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (referencesOtherArrayByIndex) return;
        if (
          isNodeOfType(child, "MemberExpression") &&
          child.computed &&
          isNodeOfType(child.property, "Identifier") &&
          isNodeOfType(params[1], "Identifier") &&
          child.property.name === params[1].name
        ) {
          referencesOtherArrayByIndex = true;
        }
      });

      if (!referencesOtherArrayByIndex) return;

      // Walk up to ensure we're not already inside a length-check guard.
      let guard: EsTreeNode | null = node.parent ?? null;
      while (
        guard &&
        !isNodeOfType(guard, "LogicalExpression") &&
        !isNodeOfType(guard, "IfStatement")
      ) {
        guard = guard.parent ?? null;
      }
      if (isNodeOfType(guard, "LogicalExpression") && guard.operator === "&&") {
        const left = guard.left;
        if (
          isNodeOfType(left, "BinaryExpression") &&
          left.operator === "===" &&
          (isMemberProperty(left.left, "length") || isMemberProperty(left.right, "length"))
        ) {
          return;
        }
      }

      context.report({
        node,
        message:
          ".every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately",
      });
    },
  }),
});
