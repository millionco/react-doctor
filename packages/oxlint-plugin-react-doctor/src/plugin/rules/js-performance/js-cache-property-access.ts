import { PROPERTY_ACCESS_REPEAT_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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
// immediately before its repeated reads. We require a member-expression depth ≥ 2
// (two dots) and ≥ 3 occurrences in the same loop block to fire.
export const jsCachePropertyAccess = defineRule({
  id: "js-cache-property-access",
  title: "Repeated property access in a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "When the value is unchanged between reads, cache it immediately before the first read inside the loop",
  create: (context: RuleContext) => {
    const inspectLoopBody = (loopBody: EsTreeNode): void => {
      const counts = new Map<string, { count: number; firstNode: EsTreeNode }>();
      // Every write target inside the loop, keyed by its access path —
      // root identifiers (`node = node.next`, `node++`) and member chains
      // of ANY depth (`state.counter = next(i)`). When a counted chain
      // extends a written prefix, later reads dereference a different
      // object, so caching the first read would snapshot a stale value.
      const writtenAccessPrefixes = new Set<string>();
      const calledReceiverPrefixes = new Set<string>();
      const recordWriteTarget = (writeTarget: EsTreeNode): void => {
        const writtenKey = buildMemberAccessKey(writeTarget);
        if (!writtenKey) return;
        writtenAccessPrefixes.add(writtenKey);
      };
      // Write targets and read counts inspect disjoint node types, and the
      // write-prefix set is only consulted after the walk — one pass fills both.
      walkAst(loopBody, (child: EsTreeNode) => {
        if (child !== loopBody && isFunctionLike(child)) return false;
        if (isNodeOfType(child, "AssignmentExpression")) recordWriteTarget(child.left);
        if (isNodeOfType(child, "UpdateExpression")) recordWriteTarget(child.argument);
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "MemberExpression")
        ) {
          const receiverKey = buildMemberAccessKey(child.callee.object);
          if (receiverKey?.includes(".")) calledReceiverPrefixes.add(receiverKey);
        }
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
        // A write LHS is not a "read" we could hoist — it's already in
        // writtenAccessPrefixes from the collection walk above.
        if (isWriteTarget(child)) return;
        const key = buildMemberAccessKey(child);
        if (!key) return;
        if (key.split(".").length < 3) return;
        // `.length` is a cheap intrinsic — repeated reads cost nothing
        // worth caching (and hoisting it can go stale when the array
        // grows or shrinks inside the loop).
        if (key.endsWith(".length")) return;
        const existing = counts.get(key);
        if (existing) existing.count++;
        else counts.set(key, { count: 1, firstNode: child });
      });

      for (const [key, { count, firstNode }] of counts) {
        if (count < PROPERTY_ACCESS_REPEAT_THRESHOLD) continue;
        const segments = key.split(".");
        let accessPrefix = segments[0];
        let doesExtendUnstablePrefix =
          writtenAccessPrefixes.has(accessPrefix) || calledReceiverPrefixes.has(accessPrefix);
        for (
          let segmentIndex = 1;
          segmentIndex < segments.length && !doesExtendUnstablePrefix;
          segmentIndex++
        ) {
          accessPrefix = `${accessPrefix}.${segments[segmentIndex]}`;
          doesExtendUnstablePrefix =
            writtenAccessPrefixes.has(accessPrefix) || calledReceiverPrefixes.has(accessPrefix);
        }
        if (doesExtendUnstablePrefix) continue;
        context.report({
          node: firstNode,
          message: `This may slow the loop because ${key} is read ${count} times inside it; if the value stays unchanged between those reads, cache it immediately before the first read`,
        });
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
