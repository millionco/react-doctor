import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule<Rule>({
  recommendation:
    "Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") {
        return;
      }
      const params = callback.params ?? [];
      if (params.length < 2) return; // need (item, index, ...) to address other array

      // Look for `other[index]` access in the body, suggesting elementwise compare.
      let referencesOtherArrayByIndex = false;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (referencesOtherArrayByIndex) return;
        if (
          child.type === "MemberExpression" &&
          child.computed &&
          child.property?.type === "Identifier" &&
          params[1]?.type === "Identifier" &&
          child.property.name === params[1].name
        ) {
          referencesOtherArrayByIndex = true;
        }
      });

      if (!referencesOtherArrayByIndex) return;

      // Walk up to ensure we're not already inside a length-check guard.
      let guard: EsTreeNode | null = node.parent ?? null;
      while (guard && guard.type !== "LogicalExpression" && guard.type !== "IfStatement") {
        guard = guard.parent ?? null;
      }
      if (guard?.type === "LogicalExpression" && guard.operator === "&&") {
        const left = guard.left;
        if (
          left?.type === "BinaryExpression" &&
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
