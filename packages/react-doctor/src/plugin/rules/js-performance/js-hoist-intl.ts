import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `new Intl.NumberFormat()` / `Intl.DateTimeFormat()` is expensive
// (dozens of allocations per locale lookup). Allocating it inside a render
// function or hot loop tanks scroll/list perf. Hoist to module scope or
// wrap in useMemo.
const INTL_CLASSES = new Set([
  "NumberFormat",
  "DateTimeFormat",
  "Collator",
  "RelativeTimeFormat",
  "ListFormat",
  "PluralRules",
  "Segmenter",
  "DisplayNames",
]);

const isIntlNewExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "NewExpression")) return false;
  const callee = node.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Intl" &&
    isNodeOfType(callee.property, "Identifier") &&
    INTL_CLASSES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
};

export const jsHoistIntl = defineRule<Rule>({
  id: "js-hoist-intl",
  severity: "warn",
  recommendation:
    "Hoist `new Intl.NumberFormat(...)` to module scope or wrap in `useMemo` — Intl constructors allocate dozens of objects per locale lookup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (!isIntlNewExpression(node)) return;
      // Walk up: if any enclosing function is a function/arrow, this is in
      // a function body. Module-scope `new Intl.X()` is fine; we only flag
      // when wrapped in a function (likely called per render or per item).
      let cursor: EsTreeNode | null = node.parent ?? null;
      let inFunctionBody = false;
      while (cursor) {
        if (
          isNodeOfType(cursor, "FunctionDeclaration") ||
          isNodeOfType(cursor, "FunctionExpression") ||
          isNodeOfType(cursor, "ArrowFunctionExpression")
        ) {
          inFunctionBody = true;
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!inFunctionBody) return;

      const className =
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.property, "Identifier")
          ? node.callee.property.name
          : "Intl";
      context.report({
        node,
        message: `new Intl.${className}() inside a function — hoist to module scope or wrap in useMemo so it isn't recreated each call`,
      });
    },
  }),
});
