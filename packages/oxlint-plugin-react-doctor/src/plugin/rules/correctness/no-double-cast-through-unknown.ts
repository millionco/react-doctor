import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isCastNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "TSAsExpression") || isNodeOfType(node, "TSTypeAssertion");

// The value being asserted, when `node` is a cast. Both `as` and the
// `<T>` assertion forms carry `.expression`.
const getCastExpression = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "TSAsExpression") || isNodeOfType(node, "TSTypeAssertion")) {
    return node.expression as EsTreeNode;
  }
  return null;
};

// The launder-target types: casting THROUGH `unknown`/`any` erases the
// source type so any following `as T` compiles unchecked.
const castTargetIsUnknownOrAny = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "TSAsExpression") && !isNodeOfType(node, "TSTypeAssertion")) {
    return false;
  }
  const target = node.typeAnnotation as EsTreeNode | undefined;
  return Boolean(target && (target.type === "TSUnknownKeyword" || target.type === "TSAnyKeyword"));
};

// Flags a double type assertion `expr as unknown as T` / `expr as any as T`
// (and the angle-bracket `<T>` form). The inner cast to `unknown`/`any`
// deliberately defeats TypeScript's structural check so the outer `as T`
// always compiles no matter how wrong `T` is — a shape mismatch surfaces
// only as a runtime crash. A lone `as unknown`, single cast, or `as const`
// never matches.
export const noDoubleCastThroughUnknown = defineRule({
  id: "no-double-cast-through-unknown",
  title: "Double cast through unknown or any",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Laundering a value through `unknown`/`any` before a second `as T` skips every structural check, so a shape mismatch crashes at runtime. Assert to a genuinely compatible type or validate the value at runtime instead.",
  create: (context: RuleContext) => {
    const reportDoubleCast = (node: EsTreeNode): void => {
      const castExpression = getCastExpression(node);
      if (!castExpression) return;
      const inner = stripGroupingParens(castExpression);
      if (!isCastNode(inner)) return;
      if (!castTargetIsUnknownOrAny(inner)) return;
      context.report({
        node,
        message:
          "This casts through `unknown`/`any` and then re-asserts, which bypasses TypeScript's structural check entirely. Assert to a compatible type or validate the value at runtime so a shape mismatch can't crash at runtime.",
      });
    };
    return {
      TSAsExpression(node: EsTreeNodeOfType<"TSAsExpression">) {
        reportDoubleCast(node as EsTreeNode);
      },
      TSTypeAssertion(node: EsTreeNodeOfType<"TSTypeAssertion">) {
        reportDoubleCast(node as EsTreeNode);
      },
    };
  },
});
