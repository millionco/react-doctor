import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This resets a loading/busy flag only on the success path: if the awaited call rejects the reset never runs and the flag stays stuck truthy (a spinner that never stops, a button disabled forever). Move the reset into a `finally` block, or mirror it on every catch, so it clears on rejection too.";

// Setters whose truthy/falsy value models a loading/busy/pending UI flag.
// The reset-on-success defect only matters for a flag the UI reads to show a
// spinner or disable a control, so we gate on the setter name to stay quiet
// on ordinary boolean toggles.
const LOADING_FLAG_SETTER_PATTERN =
  /(loading|busy|submitting|saving|pending|fetching|processing|uploading|spinner|disabl|refreshing|updating|inflight|working|posting|sending|deleting)/i;

// Property names that mark the awaited call as a never-rejecting result-object
// wrapper (`const result = await f(); if (result.success) ...`) — errors are
// folded into the resolved value, so the await cannot skip the trailing reset.
const RESULT_SHAPE_PROPERTY_NAMES = new Set(["success", "error", "ok"]);

// Array methods whose callback receives each element of the awaited result,
// so `<results>.filter((entry) => !entry.success)` is a per-element result-shape
// check equivalent to `if (result.success)` on a single awaited binding.
const ARRAY_CALLBACK_METHOD_NAMES = new Set([
  "filter",
  "map",
  "flatMap",
  "some",
  "every",
  "find",
  "forEach",
]);

const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

const getNodeEnd = (node: EsTreeNode): number | null => {
  const end = (node as { end?: unknown }).end;
  return typeof end === "number" ? end : null;
};

// The boolean argument of a `setX(true)` / `setX(false)` call, or null when
// the call is not a bare-identifier setter with a boolean-literal first arg.
const getSetterBooleanValue = (
  node: EsTreeNodeOfType<"CallExpression">,
): { setterName: string; value: boolean } | null => {
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  const firstArgument = node.arguments[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "Literal")) return null;
  if (typeof firstArgument.value !== "boolean") return null;
  return { setterName: node.callee.name, value: firstArgument.value };
};

// Where a call sits relative to the enclosing async function's try/catch:
// inside a `finally` finalizer, inside a `catch` handler, or neither
// ("plain" — a trailing success-path statement or a bare try body).
const classifyResetContext = (
  callNode: EsTreeNode,
  functionNode: EsTreeNode,
): "finally" | "catch" | "plain" => {
  let child: EsTreeNode = callNode;
  let cursor: EsTreeNode | null | undefined = callNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "CatchClause")) return "catch";
    if (isNodeOfType(cursor, "TryStatement") && cursor.finalizer === child) return "finally";
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return "plain";
};

// Walks the function's own body, never descending into a nested function, so
// awaits/setters belong to THIS async scope, not a deeper closure.
const walkOwnScope = (functionNode: EsTreeNode, visit: (node: EsTreeNode) => void): void => {
  if (!isFunctionLike(functionNode)) return;
  const body = functionNode.body;
  if (!body) return;
  walkAst(body, (child: EsTreeNode) => {
    if (child !== body && isFunctionLike(child)) return false;
    visit(child);
  });
};

const unwrapChainExpression = (expression: EsTreeNode): EsTreeNode =>
  isNodeOfType(expression, "ChainExpression") ? expression.expression : expression;

// `await Promise.allSettled(...)` never rejects by spec, and
// `await f().catch(...)` handles rejection inline, so the await always
// resumes and the trailing reset still runs.
const isNeverRejectingAwaitedExpression = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
): boolean => {
  const awaited = unwrapChainExpression(awaitNode.argument);
  if (!isNodeOfType(awaited, "CallExpression")) return false;
  const callee = unwrapChainExpression(awaited.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name === "catch") return true;
  return (
    callee.property.name === "allSettled" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Promise"
  );
};

const isWithinIfTest = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "IfStatement")) return cursor.test === child;
    if (isFunctionLike(cursor)) return false;
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// `const result = await f(...)` where the binding (or a destructured
// success/error/ok field) is branch-checked in an `if` marks the callee as a
// result-object wrapper that folds errors into a resolved value.
const isResultObjectCheckedAwait = (
  awaitNode: EsTreeNodeOfType<"AwaitExpression">,
  checkedResultNames: ReadonlySet<string>,
): boolean => {
  const parent = awaitNode.parent;
  if (!isNodeOfType(parent, "VariableDeclarator") || parent.init !== awaitNode) return false;
  const bindingTarget = parent.id;
  if (isNodeOfType(bindingTarget, "Identifier")) return checkedResultNames.has(bindingTarget.name);
  if (isNodeOfType(bindingTarget, "ObjectPattern")) {
    return bindingTarget.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        RESULT_SHAPE_PROPERTY_NAMES.has(property.key.name) &&
        isNodeOfType(property.value, "Identifier") &&
        checkedResultNames.has(property.value.name),
    );
  }
  return false;
};

// A `throw` or `return` in the catch handler's own scope skips the statements
// after the try, so the handler does not guarantee the trailing reset runs.
const catchHandlerEscapes = (handler: EsTreeNode): boolean => {
  let didFindEscape = false;
  walkAst(handler, (child: EsTreeNode) => {
    if (child !== handler && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ThrowStatement") || isNodeOfType(child, "ReturnStatement")) {
      didFindEscape = true;
    }
  });
  return didFindEscape;
};

// When the await sits in a `try` whose catch swallows the error (no rethrow,
// no return) and the reset comes after that whole try statement, the reset
// runs on the rejection path too — it is semantically a `finally`.
const isRejectionSwallowedBeforeReset = (
  awaitNode: EsTreeNode,
  functionNode: EsTreeNode,
  resetStart: number,
): boolean => {
  let child: EsTreeNode = awaitNode;
  let cursor: EsTreeNode | null | undefined = awaitNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "TryStatement") && cursor.block === child && cursor.handler) {
      const tryEnd = getNodeEnd(cursor);
      if (tryEnd !== null && tryEnd < resetStart && !catchHandlerEscapes(cursor.handler)) {
        return true;
      }
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const collectIfBranches = (
  node: EsTreeNode,
  functionNode: EsTreeNode,
): Map<EsTreeNode, "consequent" | "alternate"> => {
  const branches = new Map<EsTreeNode, "consequent" | "alternate">();
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "IfStatement")) {
      if (cursor.consequent === child) branches.set(cursor, "consequent");
      else if (cursor.alternate === child) branches.set(cursor, "alternate");
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return branches;
};

// Source-offset ordering merges mutually exclusive if/else branches; two nodes
// on opposite branches of the same `if` never execute on the same call.
const areOnExclusiveBranches = (
  first: EsTreeNode,
  second: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  const firstBranches = collectIfBranches(first, functionNode);
  if (firstBranches.size === 0) return false;
  const secondBranches = collectIfBranches(second, functionNode);
  for (const [ifNode, branch] of firstBranches) {
    const otherBranch = secondBranches.get(ifNode);
    if (otherBranch && otherBranch !== branch) return true;
  }
  return false;
};

const recordCheckedResultName = (
  identifier: EsTreeNodeOfType<"Identifier">,
  checkedResultNames: Set<string>,
): void => {
  const parent = identifier.parent;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === identifier &&
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier") &&
    RESULT_SHAPE_PROPERTY_NAMES.has(parent.property.name)
  ) {
    checkedResultNames.add(identifier.name);
    return;
  }
  if (
    isNodeOfType(parent, "IfStatement") ||
    (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
    isNodeOfType(parent, "LogicalExpression")
  ) {
    checkedResultNames.add(identifier.name);
  }
};

// `<results>.filter((entry) => !entry.success)`-style calls: a result-shape
// field of the callback parameter is checked per element, marking the awaited
// `<results>` binding (e.g. from `await Promise.all(...)`) as a never-rejecting
// result-object wrapper whose errors are consumed via the resolved value.
const getResultCheckedArrayCallbackBindingName = (
  callNode: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = unwrapChainExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!ARRAY_CALLBACK_METHOD_NAMES.has(callee.property.name)) return null;
  const calleeObject = unwrapChainExpression(callee.object);
  if (!isNodeOfType(calleeObject, "Identifier")) return null;
  const callback = callNode.arguments[0];
  if (!isFunctionLike(callback)) return null;
  const firstParameter = callback.params[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return null;
  const parameterName = firstParameter.name;
  let didFindResultShapeCheck = false;
  walkAst(callback.body, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === parameterName &&
      isNodeOfType(child.property, "Identifier") &&
      RESULT_SHAPE_PROPERTY_NAMES.has(child.property.name)
    ) {
      didFindResultShapeCheck = true;
    }
  });
  return didFindResultShapeCheck ? calleeObject.name : null;
};

interface SetterCall {
  value: boolean;
  start: number;
  context: "finally" | "catch" | "plain";
  node: EsTreeNode;
}

interface AwaitSite {
  node: EsTreeNodeOfType<"AwaitExpression">;
  start: number;
}

const analyzeFunction = (functionNode: EsTreeNode, context: RuleContext): void => {
  const awaitSites: AwaitSite[] = [];
  const settersByName = new Map<string, SetterCall[]>();
  const checkedResultNames = new Set<string>();

  walkOwnScope(functionNode, (node) => {
    if (isNodeOfType(node, "AwaitExpression")) {
      const start = getNodeStart(node);
      if (start !== null) awaitSites.push({ node, start });
      return;
    }
    if (isNodeOfType(node, "Identifier")) {
      if (isWithinIfTest(node, functionNode)) recordCheckedResultName(node, checkedResultNames);
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const resultCheckedBindingName = getResultCheckedArrayCallbackBindingName(node);
    if (resultCheckedBindingName) checkedResultNames.add(resultCheckedBindingName);
    const setter = getSetterBooleanValue(node);
    if (!setter) return;
    if (!LOADING_FLAG_SETTER_PATTERN.test(setter.setterName)) return;
    const start = getNodeStart(node);
    if (start === null) return;
    const list = settersByName.get(setter.setterName) ?? [];
    list.push({
      value: setter.value,
      start,
      context: classifyResetContext(node, functionNode),
      node,
    });
    settersByName.set(setter.setterName, list);
  });

  if (awaitSites.length === 0) return;

  const rejectionCanSkipReset = (awaitSite: AwaitSite, resetStart: number): boolean =>
    !isNeverRejectingAwaitedExpression(awaitSite.node) &&
    !isResultObjectCheckedAwait(awaitSite.node, checkedResultNames) &&
    !isRejectionSwallowedBeforeReset(awaitSite.node, functionNode, resetStart);

  for (const calls of settersByName.values()) {
    // A reset in `finally` always runs; a reset in `catch` mirrors the reset
    // on the rejection path. Either discharges the clear-obligation, so the
    // flag is not stuck.
    if (
      calls.some((call) => !call.value && (call.context === "finally" || call.context === "catch"))
    ) {
      continue;
    }

    const truthySets = calls.filter((call) => call.value);
    if (truthySets.length === 0) continue;
    const plainResets = calls.filter((call) => !call.value && call.context === "plain");

    for (const reset of plainResets) {
      const stuckFlagAwait = awaitSites.find(
        (awaitSite) =>
          awaitSite.start < reset.start &&
          rejectionCanSkipReset(awaitSite, reset.start) &&
          truthySets.some(
            (truthySet) =>
              truthySet.start < awaitSite.start &&
              !areOnExclusiveBranches(truthySet.node, reset.node, functionNode) &&
              !areOnExclusiveBranches(truthySet.node, awaitSite.node, functionNode) &&
              !areOnExclusiveBranches(awaitSite.node, reset.node, functionNode),
          ),
      );
      if (stuckFlagAwait) {
        context.report({ node: reset.node, message: MESSAGE });
        return;
      }
    }
  }
};

export const noLoadingFlagResetOutsideFinally = defineRule({
  id: "no-loading-flag-reset-outside-finally",
  title: "Loading flag reset outside finally",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A trailing `setLoading(false)` after an `await` never runs if the awaited call rejects, so the flag stays stuck truthy; reset it in a `finally` block (or mirror the reset on every catch) so it clears on both paths.",
  create: (context: RuleContext) => ({
    ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
      analyzeFunction(node as EsTreeNode, context);
    },
    FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
      analyzeFunction(node as EsTreeNode, context);
    },
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      analyzeFunction(node as EsTreeNode, context);
    },
  }),
});
