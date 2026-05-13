import { PROPERTY_ACCESS_REPEAT_THRESHOLD } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const buildMemberAccessKey = (node: EsTreeNode): string | null => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type !== "MemberExpression" || node.computed) return null;
  const objectKey = buildMemberAccessKey(node.object);
  if (!objectKey) return null;
  if (node.property?.type !== "Identifier") return null;
  return `${objectKey}.${node.property.name}`;
};

// HACK: detect repeated deep `obj.a.b.c` reads inside the same loop —
// JS engines can sometimes optimize, but reads through proxies, getters,
// or hot user-code paths often benefit from caching the access in a const
// at the top of the loop body. We require a member-expression depth ≥ 2
// (two dots) and ≥ 3 occurrences in the same loop block to fire.
export const jsCachePropertyAccess = defineRule<Rule>({
  recommendation:
    "Hoist the deep member access into a const at the top of the loop body: `const { x, y } = obj.deeply.nested`",
  create: (context: RuleContext) => {
    const inspectLoopBody = (loopBody: EsTreeNode): void => {
      const counts = new Map<string, { count: number; firstNode: EsTreeNode }>();
      walkAst(loopBody, (child: EsTreeNode) => {
        if (child.type !== "MemberExpression") return;
        if (child.computed) return;
        // Skip if this MemberExpression is itself nested inside another (only
        // count the deepest reference per chain).
        if (child.parent?.type === "MemberExpression" && child.parent.object === child) return;
        const key = buildMemberAccessKey(child);
        if (!key) return;
        if (key.split(".").length < 3) return;
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { count: 1, firstNode: child });
        }
      });

      for (const [key, { count, firstNode }] of counts) {
        if (count >= PROPERTY_ACCESS_REPEAT_THRESHOLD) {
          context.report({
            node: firstNode,
            message: `${key} is read ${count} times inside this loop — hoist into a const at the top of the loop body`,
          });
        }
      }
    };

    const handleLoop = (node: EsTreeNode): void => {
      if (node.body) inspectLoopBody(node.body);
    };

    return {
      ForStatement: handleLoop,
      ForInStatement: handleLoop,
      ForOfStatement: handleLoop,
      WhileStatement: handleLoop,
      DoWhileStatement: handleLoop,
    };
  },
});
