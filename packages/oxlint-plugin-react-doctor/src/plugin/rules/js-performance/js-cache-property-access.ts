import { PROPERTY_ACCESS_REPEAT_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// A member chain is a write target when it is the left-hand side of an
// assignment (`a.b.c = …`) or the argument of an update (`a.b.c++`). Such
// a chain is mutated inside the loop, so it is NOT loop-invariant and
// caching it once at the top would snapshot a stale value.
const isWriteTarget = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === node) return true;
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === node) return true;
  return false;
};

const buildMemberAccessKey = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "ThisExpression")) return "this";
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return null;
  const objectKey = buildMemberAccessKey(node.object);
  if (!objectKey) return null;
  if (!isNodeOfType(node.property, "Identifier")) return null;
  return `${objectKey}.${node.property.name}`;
};

// HACK: detect repeated deep `obj.a.b.c` reads inside the same loop —
// JS engines can sometimes optimize, but reads through proxies, getters,
// or hot user-code paths often benefit from caching the access in a const
// at the top of the loop body. We require a member-expression depth ≥ 2
// (two dots) and ≥ 3 occurrences in the same loop block to fire.
export const jsCachePropertyAccess = defineRule({
  id: "js-cache-property-access",
  title: "Repeated property access in a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Read the value once into a variable at the top of the loop: `const { x, y } = obj.deeply.nested`",
  create: (context: RuleContext) => {
    const inspectLoopBody = (loopBody: EsTreeNode): void => {
      const counts = new Map<
        string,
        { count: number; firstNode: EsTreeNode; isMutated: boolean }
      >();
      // Root identifiers reassigned inside the loop (`node = node.next`,
      // `node++`). When the base of a cached chain is rebound mid-loop,
      // later reads dereference a different object, so caching the first
      // read would snapshot a stale value — same rationale as the
      // member-chain write guard below.
      const reassignedRoots = new Set<string>();
      walkAst(loopBody, (child: EsTreeNode) => {
        if (isNodeOfType(child, "AssignmentExpression") && isNodeOfType(child.left, "Identifier")) {
          reassignedRoots.add(child.left.name);
        }
        if (isNodeOfType(child, "UpdateExpression") && isNodeOfType(child.argument, "Identifier")) {
          reassignedRoots.add(child.argument.name);
        }
      });
      walkAst(loopBody, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "MemberExpression")) return;
        if (child.computed) return;
        // Skip if this MemberExpression is itself nested inside another (only
        // count the deepest reference per chain).
        if (isNodeOfType(child.parent, "MemberExpression") && child.parent.object === child) return;
        // Skip when the MemberExpression IS the callee of a CallExpression
        // — that's a method call, not a property read. Hoisting
        // `const x = obj.deeply.method` doesn't work (lost `this`
        // binding); the user would need to hoist the PARENT
        // `const { method } = obj.deeply` and the rule's existing
        // chain counter still fires on the parent if it's reused
        // ≥ 3 times.
        if (isNodeOfType(child.parent, "CallExpression") && child.parent.callee === child) return;
        const key = buildMemberAccessKey(child);
        if (!key) return;
        if (key.split(".").length < 3) return;
        const writeTarget = isWriteTarget(child);
        const existing = counts.get(key);
        if (existing) {
          if (writeTarget) existing.isMutated = true;
          // A write LHS is not a "read" we could hoist, so don't tally it.
          else existing.count++;
        } else {
          counts.set(key, { count: writeTarget ? 0 : 1, firstNode: child, isMutated: writeTarget });
        }
      });

      for (const [key, { count, firstNode, isMutated }] of counts) {
        if (isMutated) continue;
        if (reassignedRoots.has(key.split(".")[0])) continue;
        if (count >= PROPERTY_ACCESS_REPEAT_THRESHOLD) {
          context.report({
            node: firstNode,
            message: `This slows the loop because ${key} is read ${count} times inside it, so read it once into a variable at the top`,
          });
        }
      }
    };

    const handleLoop = (node: EsTreeNode): void => {
      if (
        !isNodeOfType(node, "ForStatement") &&
        !isNodeOfType(node, "ForInStatement") &&
        !isNodeOfType(node, "ForOfStatement") &&
        !isNodeOfType(node, "WhileStatement") &&
        !isNodeOfType(node, "DoWhileStatement")
      ) {
        return;
      }
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
