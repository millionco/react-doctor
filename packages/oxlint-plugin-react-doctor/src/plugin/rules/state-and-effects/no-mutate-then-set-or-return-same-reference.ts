import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookBindingInScope } from "../../utils/is-hook-binding-in-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

// Hooks whose destructure gives a `[value, setValue]` pair React
// compares by identity (`Object.is`) on the next set.
const STATE_HOOK_NAMES = new Set(["useState", "useReducer"]);

// Mutating methods that return the RECEIVER (same identity) — handing
// their result straight to a setter defeats the bailout.
const SELF_RETURNING_MUTATOR_METHODS = new Set([
  "add",
  "set",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

// Every in-place mutator (return value irrelevant) — used to prove a
// reference was mutated before it is handed back by identity.
const IN_PLACE_MUTATOR_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "add",
  "delete",
  "set",
  "clear",
]);

const MESSAGE =
  "This mutates the same object React already holds and hands it back, so Object.is sees no change and skips the re-render. Copy it first (for example `[...value]` or `new Set(value)`) and update the copy.";

const isStateValueBinding = (node: EsTreeNode, name: string): boolean =>
  isHookBindingInScope(node, {
    bindingName: name,
    hookName: STATE_HOOK_NAMES,
    destructureIndex: 0,
  });

const isStateSetterBinding = (node: EsTreeNode, name: string): boolean =>
  isHookBindingInScope(node, {
    bindingName: name,
    hookName: STATE_HOOK_NAMES,
    destructureIndex: 1,
  });

// The root identifier of a member chain (`rows.a.b` -> `rows`), or null.
const memberChainRootIdentifier = (
  node: EsTreeNode
): EsTreeNodeOfType<"Identifier"> | null => {
  let current: EsTreeNode = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? current : null;
};

// True when `node` is `<name>.<selfReturningMutator>(...)` — a call that
// mutates `name` and returns the same reference.
const isSelfReturningMutatorCallOn = (
  node: EsTreeNode,
  name: string
): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  if (!isNodeOfType(unwrapped.callee, "MemberExpression")) return false;
  const method = getStaticMemberPropertyName(unwrapped.callee);
  if (!method || !SELF_RETURNING_MUTATOR_METHODS.has(method)) return false;
  const receiver = stripParenExpression(unwrapped.callee.object);
  return isNodeOfType(receiver, "Identifier") && receiver.name === name;
};

// True when some statement inside `root` mutates `name` in place: a
// mutating method call on it, or an index/property write to it. Nested
// functions are pruned so a mutation inside a handler isn't attributed
// to the render path.
const containsInPlaceMutationOf = (root: EsTreeNode, name: string): boolean => {
  let mutated = false;
  walkAst(root, (child) => {
    if (mutated) return false;
    if (child !== root && isFunctionLike(child)) return false;

    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression")
    ) {
      const method = getStaticMemberPropertyName(child.callee);
      const receiver = stripParenExpression(child.callee.object);
      if (
        method &&
        IN_PLACE_MUTATOR_METHODS.has(method) &&
        isNodeOfType(receiver, "Identifier") &&
        receiver.name === name
      ) {
        mutated = true;
        return false;
      }
    }

    if (
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression")
    ) {
      const target = isNodeOfType(child, "AssignmentExpression")
        ? (child.left as EsTreeNode)
        : (child.argument as EsTreeNode);
      const unwrappedTarget = stripParenExpression(target);
      if (isNodeOfType(unwrappedTarget, "MemberExpression")) {
        const rootIdentifier = memberChainRootIdentifier(unwrappedTarget);
        if (rootIdentifier && rootIdentifier.name === name) {
          mutated = true;
          return false;
        }
      }
    }
  });
  return mutated;
};

const blockReturnsSameReference = (
  blockBody: EsTreeNode,
  name: string
): boolean => {
  let returnsSame = false;
  walkAst(blockBody, (child) => {
    if (returnsSame) return false;
    if (child !== blockBody && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      const returned = stripParenExpression(child.argument);
      if (isNodeOfType(returned, "Identifier") && returned.name === name) {
        returnsSame = true;
        return false;
      }
      if (isSelfReturningMutatorCallOn(returned, name)) {
        returnsSame = true;
        return false;
      }
    }
  });
  return returnsSame;
};

// A functional updater `(prev) => { ...mutate prev...; return prev; }`
// (or the concise `(prev) => prev.add(x)`) hands the same reference
// back to React.
const isMutateThenReturnSameUpdater = (updater: EsTreeNode): boolean => {
  if (!isFunctionLike(updater)) return false;
  const firstParam = updater.params?.[0];
  const prevName = isNodeOfType(firstParam as EsTreeNode, "Identifier")
    ? (firstParam as EsTreeNodeOfType<"Identifier">).name
    : null;
  if (!prevName) return false;

  const body = updater.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    return isSelfReturningMutatorCallOn(body, prevName);
  }
  return (
    containsInPlaceMutationOf(body, prevName) &&
    blockReturnsSameReference(body, prevName)
  );
};

export const noMutateThenSetOrReturnSameReference = defineRule({
  id: "no-mutate-then-set-or-return-same-reference",
  title: "State mutated in place then set by same reference",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Mutating a state Set/Map/array in place and handing the same reference back to its setter defeats React's Object.is bailout, so the re-render is skipped. Copy the value first (`[...value]`, `new Set(value)`) and update the copy.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (!isStateSetterBinding(node, node.callee.name)) return;

      const firstArgument = node.arguments?.[0];
      if (!firstArgument) return;
      const argument = stripParenExpression(firstArgument);

      // Shape A: setX(state.mutator(...)) — self-returning mutator on a
      // state value handed straight back.
      if (
        isNodeOfType(argument, "CallExpression") &&
        isNodeOfType(argument.callee, "MemberExpression")
      ) {
        const method = getStaticMemberPropertyName(argument.callee);
        const receiver = stripParenExpression(argument.callee.object);
        if (
          method &&
          SELF_RETURNING_MUTATOR_METHODS.has(method) &&
          isNodeOfType(receiver, "Identifier") &&
          isStateValueBinding(receiver, receiver.name)
        ) {
          context.report({ node, message: MESSAGE });
          return;
        }
      }

      // Shape B: mutate state in place, then setX(state) with the same
      // identity.
      if (
        isNodeOfType(argument, "Identifier") &&
        isStateValueBinding(argument, argument.name)
      ) {
        const enclosingFunction = node.parent;
        let scope: EsTreeNode | null = node;
        let cursor: EsTreeNode | null | undefined = enclosingFunction;
        while (cursor) {
          if (isFunctionLike(cursor)) {
            scope = cursor;
            break;
          }
          cursor = cursor.parent ?? null;
        }
        if (scope && containsInPlaceMutationOf(scope, argument.name)) {
          context.report({ node, message: MESSAGE });
        }
        return;
      }

      // Shape C: setX((prev) => { mutate prev; return prev; }).
      if (isMutateThenReturnSameUpdater(argument)) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
