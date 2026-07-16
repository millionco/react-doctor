import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isInsideTryStatement } from "./is-inside-try-statement.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

export const subtreeContainsThrow = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "ThrowStatement")) {
      found = true;
      return false;
    }
  });
  return found;
};

// A node is rejection-proof inside `functionBoundary` when it sits in a try
// BLOCK whose catch handler exists and does not rethrow.
export const isInsideNonRethrowingTry = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== functionBoundary) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      ancestor.handler &&
      !subtreeContainsThrow(ancestor.handler as EsTreeNode)
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// `new Promise((resolve) => { ...sync work...; resolve(v) })` used as a
// sequencing/delay wrapper: the executor declares no reject parameter and
// contains no throw, so the promise structurally cannot reject.
export const isNonRejectingPromiseConstruction = (root: EsTreeNode): boolean => {
  const inner = stripParenExpression(root);
  if (!isNodeOfType(inner, "NewExpression")) return false;
  if (!isNodeOfType(inner.callee, "Identifier") || inner.callee.name !== "Promise") return false;
  const executor = inner.arguments?.[0]
    ? stripParenExpression(inner.arguments[0] as EsTreeNode)
    : null;
  if (
    !executor ||
    (!isNodeOfType(executor, "ArrowFunctionExpression") &&
      !isNodeOfType(executor, "FunctionExpression"))
  ) {
    return false;
  }
  if ((executor.params?.length ?? 0) >= 2) return false;
  return !subtreeContainsThrow(executor);
};

export const isPromiseResolveCall = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  return (
    isNodeOfType(inner, "CallExpression") &&
    isNodeOfType(inner.callee, "MemberExpression") &&
    !inner.callee.computed &&
    isNodeOfType(inner.callee.object, "Identifier") &&
    inner.callee.object.name === "Promise" &&
    isNodeOfType(inner.callee.property, "Identifier") &&
    inner.callee.property.name === "resolve"
  );
};

// True when the chain (walked through member links) carries a `.catch(...)`
// or two-argument `.then(onOk, onErr)` rejection handler.
export const chainCarriesRejectionHandler = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = stripParenExpression(node);
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee: EsTreeNode = cursor.callee as EsTreeNode;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier")
      ) {
        if (callee.property.name === "catch") return true;
        if (callee.property.name === "then" && (cursor.arguments?.length ?? 0) >= 2) return true;
      }
      cursor = isNodeOfType(callee, "MemberExpression") ? (callee.object as EsTreeNode) : null;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object as EsTreeNode;
      continue;
    }
    return false;
  }
  return false;
};

// A same-file helper whose returned promise structurally cannot reject: an
// async function whose every await (and throw) is inside a try with a
// non-rethrowing catch, or a sync function whose every return is a
// `.catch`-terminated chain, a `Promise.resolve(...)`, or a no-reject
// `new Promise` delay (`sleep`, `safeFetch`, `to()`-tuple wrappers).
export const isNeverRejectingHelperCall = (root: EsTreeNode): boolean => {
  const inner = stripParenExpression(root);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  const helper = binding?.initializer;
  if (!helper || !isFunctionLike(helper)) return false;

  if (helper.async) {
    let isRejectionProof = true;
    let sawSuspension = false;
    walkOwnFunctionScope(helper, (child: EsTreeNode) => {
      if (!isRejectionProof) return false;
      if (isNodeOfType(child, "AwaitExpression")) {
        sawSuspension = true;
        if (!isInsideNonRethrowingTry(child, helper)) isRejectionProof = false;
      }
      if (
        isNodeOfType(child, "ThrowStatement") &&
        !isInsideTryStatement(child, { region: "block", boundary: helper })
      ) {
        isRejectionProof = false;
      }
    });
    return isRejectionProof && sawSuspension;
  }

  const returnedExpressions: EsTreeNode[] = [];
  if (
    isNodeOfType(helper, "ArrowFunctionExpression") &&
    !isNodeOfType(helper.body, "BlockStatement")
  ) {
    returnedExpressions.push(stripParenExpression(helper.body as EsTreeNode));
  } else {
    walkOwnFunctionScope(helper, (child: EsTreeNode) => {
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        returnedExpressions.push(stripParenExpression(child.argument as EsTreeNode));
      }
    });
  }
  return (
    returnedExpressions.length > 0 &&
    returnedExpressions.every(
      (returned) =>
        chainCarriesRejectionHandler(returned) ||
        isPromiseResolveCall(returned) ||
        isNonRejectingPromiseConstruction(returned),
    )
  );
};
