import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Effect-shaped hooks incl. the common userland `useMount`; named distinctly so
// it does not shadow the canonical two-member `EFFECT_HOOK_NAMES`.
const EFFECT_LIKE_HOOK_NAMES = new Set([
  "useEffect",
  "useLayoutEffect",
  "useMount",
]);
const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);

// Call names that denote a real async source whose promise can reject
// at runtime (network, loader, dynamic import, RPC).
const ASYNC_INITIATOR_PATTERN =
  /^(?:fetch|load|generate|download|request|refresh|reload|create|query|import|read|send|open|connect|init)/i;
// Predicate-shaped names resolve to a settled value, not a real
// rejectable async source — excluded to kill the `isImageValid(...)`
// false positives.
const PREDICATE_NAME_PATTERN =
  /^(?:is|has|should|can|will|was|validate|check|assert|ensure|match)/i;
const ASYNC_MEMBER_METHOD_NAMES = new Set([
  "init",
  "load",
  "fetch",
  "get",
  "refresh",
  "reload",
  "query",
  "request",
  "create",
  "open",
  "connect",
  "download",
  "send",
  "run",
  "start",
]);

const MESSAGE =
  "This promise chain runs in an effect, ends in a `.then` that sets state or mutates a ref, and has no `.catch` or enclosing try/catch, so a rejection leaves the state unset and surfaces as an unhandled rejection. Add a `.catch` handler on the chain (`.finally` does not count).";

interface ChainAnalysis {
  root: EsTreeNode;
  hasCatch: boolean;
  hasRejectionHandlerArgument: boolean;
  sideEffectThenCallbacks: EsTreeNode[];
}

const unwrapChain = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression")
    ? (node.expression as EsTreeNode)
    : node;

// Walks a `.then`/`.catch`/`.finally` member-call chain down to its
// initiator, collecting which settlement methods appear and the
// side-effecting `.then` callbacks.
const analyzeChain = (chainExpression: EsTreeNode): ChainAnalysis | null => {
  let cursor = unwrapChain(chainExpression);
  let hasCatch = false;
  let hasRejectionHandlerArgument = false;
  const sideEffectThenCallbacks: EsTreeNode[] = [];
  let sawThen = false;

  while (
    isNodeOfType(cursor, "CallExpression") &&
    isNodeOfType(cursor.callee, "MemberExpression") &&
    !cursor.callee.computed &&
    isNodeOfType(cursor.callee.property, "Identifier") &&
    PROMISE_METHOD_NAMES.has(cursor.callee.property.name)
  ) {
    const methodName = cursor.callee.property.name;
    if (methodName === "catch") hasCatch = true;
    if (methodName === "then") {
      sawThen = true;
      if (cursor.arguments.length >= 2) hasRejectionHandlerArgument = true;
      const callback = cursor.arguments[0];
      if (callback && isFunctionLike(callback as EsTreeNode)) {
        sideEffectThenCallbacks.push(callback as EsTreeNode);
      }
    }
    cursor = unwrapChain(cursor.callee.object as EsTreeNode);
  }

  if (!sawThen) return null;
  return {
    root: cursor,
    hasCatch,
    hasRejectionHandlerArgument,
    sideEffectThenCallbacks,
  };
};

// Follow an identifier initiator (`const p = loader.init(); p.then(...)`)
// to the call it was assigned.
const resolveInitiator = (root: EsTreeNode): EsTreeNode => {
  if (isNodeOfType(root, "Identifier")) {
    const binding = findVariableInitializer(root, root.name);
    if (binding?.initializer) return stripParenExpression(binding.initializer);
  }
  return root;
};

// A `xRef.current.get(key)` call reads a promise previously stored in a
// ref-held Map/cache — the standard in-flight-request dedup idiom. The
// stored promise's creation site owns the `.catch`, so re-reading it and
// chaining a `.then` is not an unhandled fresh async source (resolving an
// identifier initiator to this shape would otherwise false-positive).
const isRefHeldCacheRead = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  !callee.computed &&
  isNodeOfType(callee.property, "Identifier") &&
  callee.property.name === "get" &&
  isNodeOfType(callee.object, "MemberExpression") &&
  !callee.object.computed &&
  isNodeOfType(callee.object.property, "Identifier") &&
  callee.object.property.name === "current";

const initiatorIsRealAsyncSource = (initiator: EsTreeNode): boolean => {
  if (isNodeOfType(initiator, "ImportExpression")) return true;
  if (!isNodeOfType(initiator, "CallExpression")) return false;
  const callee = initiator.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (callee.name === "fetch") return true;
    if (PREDICATE_NAME_PATTERN.test(callee.name)) return false;
    return ASYNC_INITIATOR_PATTERN.test(callee.name);
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    // `Promise.resolve()/reject()/all()` never model a real rejectable
    // source — a microtask-defer idiom.
    if (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Promise"
    )
      return false;
    if (isRefHeldCacheRead(callee)) return false;
    const methodName = callee.property.name;
    if (PREDICATE_NAME_PATTERN.test(methodName)) return false;
    if (ASYNC_MEMBER_METHOD_NAMES.has(methodName)) return true;
    return ASYNC_INITIATOR_PATTERN.test(methodName);
  }
  return false;
};

const callbackHasStateSideEffect = (callback: EsTreeNode): boolean => {
  let found = false;
  walkAst(callback, (child: EsTreeNode) => {
    if (found) return false;
    // A state setter call `setX(...)`.
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      isSetterIdentifier(child.callee.name)
    ) {
      found = true;
      return false;
    }
    // A ref mutation `xRef.current = ...`.
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      isNodeOfType(child.left.property, "Identifier") &&
      child.left.property.name === "current"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Walk the effect body without descending into nested functions, so the
// candidate chains belong to the effect scope (the `.then` callbacks are
// nested functions and are inspected separately).
const collectFloatingChains = (callback: EsTreeNode): EsTreeNode[] => {
  const chains: EsTreeNode[] = [];
  walkOwnFunctionScope(callback, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "ExpressionStatement")) return;
    let expression = child.expression as EsTreeNode;
    if (
      isNodeOfType(expression, "UnaryExpression") &&
      expression.operator === "void"
    ) {
      expression = expression.argument as EsTreeNode;
    }
    chains.push(stripParenExpression(expression));
  });
  return chains;
};

// Flags a floating promise chain inside a React effect that is started
// by a real async call, ends in a `.then` performing a state setter or
// ref mutation, and has no `.catch`/rejection handler and no enclosing
// try/catch. `.finally` does not count as handling the rejection, and
// `Promise.resolve()/reject()` initiators are excluded.
export const noPromiseThenSideEffectInEffectWithoutCatch = defineRule({
  id: "no-promise-then-side-effect-in-effect-without-catch",
  title: "Effect promise .then sets state with no catch",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "An async init in an effect that sets state in `.then` but has no `.catch` leaves the component stuck and raises an unhandled rejection when it fails. Add a `.catch` on the chain (`.finally` does not handle the rejection).",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node as EsTreeNode, EFFECT_LIKE_HOOK_NAMES)) return;
      const callback = getEffectCallback(node as EsTreeNode);
      if (!isFunctionLike(callback)) return;

      for (const chainExpression of collectFloatingChains(callback)) {
        const analysis = analyzeChain(chainExpression);
        if (!analysis) continue;
        if (analysis.hasCatch || analysis.hasRejectionHandlerArgument) continue;
        if (!analysis.sideEffectThenCallbacks.some(callbackHasStateSideEffect))
          continue;
        if (!initiatorIsRealAsyncSource(resolveInitiator(analysis.root)))
          continue;
        if (isInsideTryStatement(chainExpression, { boundary: callback }))
          continue;
        context.report({ node: chainExpression, message: MESSAGE });
      }
    },
  }),
});
