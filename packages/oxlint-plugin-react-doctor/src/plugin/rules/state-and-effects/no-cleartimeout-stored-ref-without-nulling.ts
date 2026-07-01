import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`clearTimeout` cancels the timer but leaves the stale, now-invalid id in this ref, and another guard reads the ref's truthiness to decide whether a timer is still pending, so scheduling silently desyncs. Set the ref's `.current` back to `null` right after clearing.";

const CLEAR_CALLEE_NAMES = new Set(["clearTimeout", "clearInterval", "cancelAnimationFrame"]);
const SCHEDULER_CALLEE_NAMES = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);

// The ref field `X.current` that a call reads as its only argument, or null.
const getCurrentFieldRefName = (node: EsTreeNode): string | null => {
  const member = stripParenExpression(node);
  if (!isNodeOfType(member, "MemberExpression")) return null;
  if (member.computed) return null;
  if (!isNodeOfType(member.property, "Identifier") || member.property.name !== "current") {
    return null;
  }
  const object = stripParenExpression(member.object as EsTreeNode);
  return isNodeOfType(object, "Identifier") ? object.name : null;
};

const isCurrentMemberOf = (node: EsTreeNode, refName: string): boolean =>
  getCurrentFieldRefName(node) === refName;

const isNullLiteral = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && node.value === null) ||
  (isNodeOfType(node, "Identifier") && node.name === "undefined");

// True when the subtree assigns `X.current = null` (or `= undefined`).
const containsNullAssignment = (root: EsTreeNode, refName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (!isNodeOfType(child, "AssignmentExpression")) return;
    if (child.operator !== "=") return;
    if (!isCurrentMemberOf(child.left as EsTreeNode, refName)) return;
    if (isNullLiteral(stripParenExpression(child.right as EsTreeNode))) found = true;
  });
  return found;
};

// True when the subtree clears the ref or reassigns `X.current` — the
// debounce/idle idiom's "clear then overwrite" both count, so a guard whose
// body does this is NOT the standalone pending-state guard the rule needs.
const clearsOrReassignsRef = (root: EsTreeNode, refName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const name = getCalleeName(child);
      if (name && CLEAR_CALLEE_NAMES.has(name)) {
        const argument = child.arguments[0];
        if (argument && isCurrentMemberOf(argument as EsTreeNode, refName)) found = true;
      }
      return;
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isCurrentMemberOf(child.left as EsTreeNode, refName)
    ) {
      found = true;
    }
  });
  return found;
};

const testReadsRefCurrent = (test: EsTreeNode, refName: string): boolean => {
  let found = false;
  walkAst(test, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "MemberExpression") && isCurrentMemberOf(child, refName)) {
      found = true;
      return false;
    }
  });
  return found;
};

// A standalone pending-state guard: `if (X.current) { skip }` whose body does
// NOT clear or reassign the ref (so the truthiness decides skip-vs-schedule
// across event boundaries, not merely a redundant clear in the debounce idiom).
const hasStandalonePendingGuard = (searchRoot: EsTreeNode, refName: string): boolean => {
  let found = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (found) return false;
    if (!isNodeOfType(child, "IfStatement")) return;
    if (!testReadsRefCurrent(child.test as EsTreeNode, refName)) return;
    if (clearsOrReassignsRef(child.consequent as EsTreeNode, refName)) return;
    found = true;
    return false;
  });
  return found;
};

// True when a `X.current = setTimeout(cb, …)` scheduler reassignment exists
// whose callback body never nulls the ref — so a fired timer leaves the field
// permanently truthy.
const hasSchedulerReassignThatNeverNulls = (searchRoot: EsTreeNode, refName: string): boolean => {
  let found = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (found) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    if (!isCurrentMemberOf(child.left as EsTreeNode, refName)) return;
    const right = stripParenExpression(child.right as EsTreeNode);
    if (!isNodeOfType(right, "CallExpression")) return;
    const name = getCalleeName(right);
    if (!name || !SCHEDULER_CALLEE_NAMES.has(name)) return;
    const callback = right.arguments[0];
    if (!callback || !isFunctionLike(callback as EsTreeNode)) {
      found = true;
      return;
    }
    if (!containsNullAssignment(callback as EsTreeNode, refName)) found = true;
  });
  return found;
};

const nearestBlock = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement")) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isUseRefInitializer = (refName: string, referenceNode: EsTreeNode): EsTreeNode | null => {
  const binding = findVariableInitializer(referenceNode, refName);
  if (!binding) return null;
  const declarator = binding.bindingIdentifier.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  if (!init || !isNodeOfType(init, "CallExpression")) return null;
  const calleeName = getCalleeName(init);
  if (calleeName !== "useRef") return null;
  return binding.scopeOwner;
};

export const noCleartimeoutStoredRefWithoutNulling = defineRule({
  id: "no-cleartimeout-stored-ref-without-nulling",
  title: "clearTimeout on a stored ref without nulling it",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "After `clearTimeout(ref.current)` set `ref.current = null`; otherwise the ref keeps a truthy-but-dead id and a later `if (ref.current)` pending-state guard reads it as still-scheduled, so a show/hide/delay race silently corrupts scheduling.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = getCalleeName(node as EsTreeNode);
      if (!calleeName || !CLEAR_CALLEE_NAMES.has(calleeName)) return;
      const argument = node.arguments[0];
      if (!argument) return;
      const refName = getCurrentFieldRefName(argument as EsTreeNode);
      if (!refName) return;

      const searchRoot = isUseRefInitializer(refName, node as EsTreeNode);
      if (!searchRoot) return;

      const block = nearestBlock(node as EsTreeNode);
      if (block && containsNullAssignment(block, refName)) return;

      if (!hasStandalonePendingGuard(searchRoot, refName)) return;
      if (!hasSchedulerReassignThatNeverNulls(searchRoot, refName)) return;

      context.report({ node: node as EsTreeNode, message: MESSAGE });
    },
  }),
});
