import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";
import { patternBindsName } from "./utils/pattern-binds-name.js";

type StateCollectionKind = "array" | "map" | "set";

// Hooks whose destructure gives a `[value, setValue]` pair React
// compares by identity (`Object.is`) on the next set.
const STATE_HOOK_NAMES = new Set(["useState", "useReducer"]);

// Mutating collection methods that return the RECEIVER (same identity),
// keyed by the collection kind whose builtin behaves that way — handing
// their result straight to a setter defeats the bailout. Immutable APIs
// reuse these names but return NEW instances (dayjs `.add`, Immutable.js
// `.set`), so the receiver must be proven to hold the matching native
// collection before the name is trusted.
const SELF_RETURNING_MUTATOR_KINDS = new Map<string, StateCollectionKind>([
  ["add", "set"],
  ["set", "map"],
  ["sort", "array"],
  ["reverse", "array"],
  ["fill", "array"],
  ["copyWithin", "array"],
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

const isStateHookDestructureAt = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  bindingName: string,
  destructureIndex: number,
): boolean => {
  if (!isNodeOfType(declarator.init, "CallExpression")) return false;
  if (!isHookCall(declarator.init, STATE_HOOK_NAMES)) return false;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const element = (declarator.id.elements ?? [])[destructureIndex];
  return isNodeOfType(element, "Identifier") && element.name === bindingName;
};

// Resolves `bindingName` at `node` to its NEAREST binding and returns the
// useState/useReducer declarator only when that nearest binding is the
// hook destructure at `destructureIndex`. Any intervening re-binding — a
// function/callback parameter, a fresh local, a catch clause, a `for`
// head — shadows the state pair, so the reference is not React state.
const findNearestStateHookDeclarator = (
  node: EsTreeNode,
  bindingName: string,
  destructureIndex: number,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      for (const parameter of cursor.params ?? []) {
        if (patternBindsName(parameter, bindingName)) return null;
      }
    }
    if (
      isNodeOfType(cursor, "CatchClause") &&
      cursor.param &&
      patternBindsName(cursor.param, bindingName)
    ) {
      return null;
    }
    if (
      isNodeOfType(cursor, "ForStatement") &&
      isNodeOfType(cursor.init, "VariableDeclaration") &&
      (cursor.init.declarations ?? []).some((declarator) =>
        patternBindsName(declarator.id, bindingName),
      )
    ) {
      return null;
    }
    if (
      (isNodeOfType(cursor, "ForOfStatement") || isNodeOfType(cursor, "ForInStatement")) &&
      isNodeOfType(cursor.left, "VariableDeclaration") &&
      (cursor.left.declarations ?? []).some((declarator) =>
        patternBindsName(declarator.id, bindingName),
      )
    ) {
      return null;
    }
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (isStateHookDestructureAt(declarator, bindingName, destructureIndex)) {
            return declarator;
          }
          if (patternBindsName(declarator.id, bindingName)) return null;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// The collection kind the hook's initial value PROVES the state holds
// (`useState(new Set())`, `useReducer(reducer, [])`), or null when the
// initializer is opaque (`useState(dayjs())`, `useState(props.rows)`).
const stateInitializerCollectionKind = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
): StateCollectionKind | null => {
  if (!isNodeOfType(declarator.init, "CallExpression")) return null;
  const hookCall = declarator.init;
  const isReducer = getCalleeName(hookCall) === "useReducer";
  const hookArguments = hookCall.arguments ?? [];
  if (isReducer && hookArguments.length > 2) return null;
  const initializerArgument = hookArguments[isReducer ? 1 : 0];
  if (!initializerArgument) return null;
  let initialValue = stripParenExpression(initializerArgument);
  if (isFunctionLike(initialValue) && !isNodeOfType(initialValue.body, "BlockStatement")) {
    initialValue = stripParenExpression(initialValue.body);
  }
  if (isNodeOfType(initialValue, "ArrayExpression")) return "array";
  if (
    isNodeOfType(initialValue, "NewExpression") &&
    isNodeOfType(initialValue.callee, "Identifier")
  ) {
    const constructorName = initialValue.callee.name;
    if (constructorName === "Set" || constructorName === "WeakSet") return "set";
    if (constructorName === "Map" || constructorName === "WeakMap") return "map";
    if (constructorName === "Array") return "array";
  }
  return null;
};

// The root identifier of a member chain (`rows.a.b` -> `rows`), or null.
const memberChainRootIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let current: EsTreeNode = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? current : null;
};

// True when `node` is `<name>.<selfReturningMutator>(...)` and the
// mutator matches the proven state collection kind.
const isSelfReturningMutatorCallOn = (
  node: EsTreeNode,
  name: string,
  stateKind: StateCollectionKind | null,
): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  if (!isNodeOfType(unwrapped.callee, "MemberExpression")) return false;
  const method = getStaticMemberPropertyName(unwrapped.callee);
  if (!method || SELF_RETURNING_MUTATOR_KINDS.get(method) !== stateKind) return false;
  const receiver = stripParenExpression(unwrapped.callee.object);
  return isNodeOfType(receiver, "Identifier") && receiver.name === name;
};

// True when some statement inside `root` mutates `name` in place: a
// mutating method call rooted at it (`rows.sort()`, `form.tags.push()`),
// or an index/property write to it. Nested functions are pruned so a
// mutation inside a handler isn't attributed to the render path.
const containsInPlaceMutationOf = (
  root: EsTreeNode,
  name: string,
  stateKind: StateCollectionKind | null,
): boolean => {
  let mutated = false;
  walkAst(root, (child) => {
    if (mutated || (child !== root && isFunctionLike(child))) return false;

    let receiver: EsTreeNode | null = null;
    if (isNodeOfType(child, "CallExpression") && isNodeOfType(child.callee, "MemberExpression")) {
      const method = getStaticMemberPropertyName(child.callee);
      if (method && IN_PLACE_MUTATOR_METHODS.has(method)) {
        // A mutator-NAMED call whose result is consumed (bound, returned,
        // passed on) is how immutable APIs chain — dayjs .add, Luxon .set,
        // Immutable.js .push/.delete all RETURN a new value. Without a
        // proven native collection kind, only discard-position calls
        // (`prev.push(x);`) prove in-place mutation.
        const resultIsDiscarded =
          isNodeOfType(child.parent, "ExpressionStatement") ||
          isNodeOfType(child.parent, "SequenceExpression");
        if (resultIsDiscarded || stateKind !== null) receiver = child.callee.object;
      }
    } else if (
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression")
    ) {
      const target = stripParenExpression(
        isNodeOfType(child, "AssignmentExpression")
          ? (child.left as EsTreeNode)
          : (child.argument as EsTreeNode),
      );
      if (isNodeOfType(target, "MemberExpression")) receiver = target;
    }
    mutated = Boolean(receiver && memberChainRootIdentifier(receiver)?.name === name);
  });
  return mutated;
};

const blockReturnsSameReference = (
  blockBody: EsTreeNode,
  name: string,
  stateKind: StateCollectionKind | null,
): boolean => {
  let returnsSame = false;
  walkAst(blockBody, (child) => {
    if (returnsSame || (child !== blockBody && isFunctionLike(child))) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    returnsSame =
      (isNodeOfType(returned, "Identifier") && returned.name === name) ||
      isSelfReturningMutatorCallOn(returned, name, stateKind);
  });
  return returnsSame;
};

// A functional updater `(prev) => { ...mutate prev...; return prev; }`
// (or the concise `(prev) => prev.add(x)` on a proven native collection)
// hands the same reference back to React.
const isMutateThenReturnSameUpdater = (
  updater: EsTreeNode,
  stateKind: StateCollectionKind | null,
): boolean => {
  if (!isFunctionLike(updater)) return false;
  const firstParam = updater.params?.[0];
  const prevName = isNodeOfType(firstParam as EsTreeNode, "Identifier")
    ? (firstParam as EsTreeNodeOfType<"Identifier">).name
    : null;
  if (!prevName) return false;

  const body = updater.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    return isSelfReturningMutatorCallOn(body, prevName, stateKind);
  }
  // `prev = prev.slice(); prev.push(job); return prev;` — reassigning the
  // param first means the returned reference is a fresh copy, not the
  // incoming state.
  let paramIsReassigned = false;
  walkAst(body, (child) => {
    if (paramIsReassigned || (child !== body && isFunctionLike(child))) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === prevName
    ) {
      paramIsReassigned = true;
      return false;
    }
  });
  if (paramIsReassigned) return false;
  return (
    containsInPlaceMutationOf(body, prevName, stateKind) &&
    blockReturnsSameReference(body, prevName, stateKind)
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
      const setterDeclarator = findNearestStateHookDeclarator(node, node.callee.name, 1);
      if (!setterDeclarator) return;

      const firstArgument = node.arguments?.[0];
      if (!firstArgument) return;
      const argument = stripParenExpression(firstArgument);

      // Shape A: setX(state.mutator(...)) — self-returning mutator on a
      // state value whose initializer proves the matching native
      // collection, handed straight back.
      if (
        isNodeOfType(argument, "CallExpression") &&
        isNodeOfType(argument.callee, "MemberExpression")
      ) {
        const receiver = stripParenExpression(argument.callee.object);
        if (isNodeOfType(receiver, "Identifier")) {
          const valueDeclarator = findNearestStateHookDeclarator(receiver, receiver.name, 0);
          if (
            valueDeclarator &&
            isSelfReturningMutatorCallOn(
              argument,
              receiver.name,
              stateInitializerCollectionKind(valueDeclarator),
            )
          ) {
            context.report({ node, message: MESSAGE });
            return;
          }
        }
      }

      // Shape B: mutate state in place, then setX(state) with the same
      // identity.
      if (
        isNodeOfType(argument, "Identifier") &&
        findNearestStateHookDeclarator(argument, argument.name, 0)
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
        const argumentStateDeclarator = findNearestStateHookDeclarator(argument, argument.name, 0);
        const argumentStateKind = argumentStateDeclarator
          ? stateInitializerCollectionKind(argumentStateDeclarator)
          : null;
        if (scope && containsInPlaceMutationOf(scope, argument.name, argumentStateKind)) {
          context.report({ node, message: MESSAGE });
        }
        return;
      }

      // Shape C: setX((prev) => { mutate prev; return prev; }).
      if (
        isMutateThenReturnSameUpdater(argument, stateInitializerCollectionKind(setterDeclarator))
      ) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
