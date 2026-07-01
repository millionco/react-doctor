import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// oxc-parser surfaces `(...)` as a node kind outside the TSESTree union,
// so it is matched via a `string`-typed constant.
const PARENTHESIZED_EXPRESSION: string = "ParenthesizedExpression";
const BODY_CONSUMER_METHODS = new Set(["json", "text", "blob", "arrayBuffer", "formData"]);
const STATUS_CHECK_PROPERTIES = new Set(["ok", "status"]);

const MESSAGE =
  "`fetch()` resolves (does not reject) on HTTP 4xx/5xx, so consuming this Response without checking `response.ok`/`response.status` parses an error body as success or crashes on a truthiness guard that is always true. Check `if (!response.ok) throw ...` before reading `.json()`/`.text()`/`.blob()`.";

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};

const isGlobalFetchCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "Identifier") || callee.name !== "fetch") return false;
  // An imported / aliased / locally-bound `fetch` is a wrapper whose
  // status check the detector can't see; only root at the DOM global.
  if (findVariableInitializer(callee, "fetch")) return false;
  return true;
};

const nearestFunction = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent ?? null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const isBodyConsumeCall = (node: EsTreeNode, responseName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === responseName &&
    isNodeOfType(callee.property, "Identifier") &&
    BODY_CONSUMER_METHODS.has(callee.property.name)
  );
};

const isTruthinessTest = (node: EsTreeNode, responseName: string): boolean =>
  isNodeOfType(node, "UnaryExpression") &&
  node.operator === "!" &&
  isNodeOfType(node.argument, "Identifier") &&
  node.argument.name === responseName;

const scopeConsumesResponse = (scope: EsTreeNode, responseName: string): boolean => {
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (isBodyConsumeCall(child, responseName) || isTruthinessTest(child, responseName)) {
      found = true;
      return false;
    }
  });
  return found;
};

const scopeChecksStatus = (scope: EsTreeNode, responseName: string): boolean => {
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === responseName &&
      isNodeOfType(child.property, "Identifier") &&
      STATUS_CHECK_PROPERTIES.has(child.property.name)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const isConsumingReceiver = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === identifier &&
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier") &&
    (BODY_CONSUMER_METHODS.has(parent.property.name) ||
      STATUS_CHECK_PROPERTIES.has(parent.property.name)),
  );
};

// The Response escapes to a caller (`return response` / `return { response }`),
// so its status check is legitimately deferred downstream.
const scopeReturnsResponse = (scope: EsTreeNode, responseName: string): boolean => {
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    walkAst(child.argument as EsTreeNode, (inner) => {
      if (found) return false;
      if (
        isNodeOfType(inner, "Identifier") &&
        inner.name === responseName &&
        !isConsumingReceiver(inner)
      ) {
        found = true;
        return false;
      }
    });
  });
  return found;
};

const reportUnguarded = (
  context: RuleContext,
  reportNode: EsTreeNode,
  scope: EsTreeNode,
  responseName: string,
): void => {
  if (!scopeConsumesResponse(scope, responseName)) return;
  if (scopeChecksStatus(scope, responseName)) return;
  if (scopeReturnsResponse(scope, responseName)) return;
  context.report({ node: reportNode, message: MESSAGE });
};

// Flags consuming a global-`fetch` Response without an `ok`/`status`
// check: `.json()`/`.text()`/`.blob()` (or a truthiness test on the
// Response, which is always truthy) with no preceding `response.ok` /
// `response.status`. `fetch` resolves on 4xx/5xx, so the error body is
// parsed as success. Roots only at the literal global `fetch`, and stays
// quiet when the Response is returned to a caller for a downstream check.
export const noFetchResponseUsedWithoutStatusCheck = defineRule({
  id: "no-fetch-response-used-without-status-check",
  title: "fetch Response consumed without status check",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Check `response.ok` (or `response.status`) before consuming a `fetch` Response with `.json()`/`.text()`/`.blob()`. `fetch` resolves on HTTP 4xx/5xx, so an unchecked response parses the error body as success or crashes on an always-truthy guard.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isGlobalFetchCall(node)) return;
      const parent = meaningfulParent(node as EsTreeNode);
      if (!parent) return;

      // Shape: fetch(...).then((response) => ...consume...)
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === (node as EsTreeNode) &&
        !parent.computed &&
        isNodeOfType(parent.property, "Identifier") &&
        parent.property.name === "then"
      ) {
        const thenCall = meaningfulParent(parent);
        if (!thenCall || !isNodeOfType(thenCall, "CallExpression")) return;
        const callback = thenCall.arguments?.[0]
          ? stripGroupingParens(thenCall.arguments[0] as EsTreeNode)
          : null;
        if (!callback || !isFunctionLike(callback)) return;
        const firstParam = callback.params?.[0];
        if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
        reportUnguarded(
          context,
          node as EsTreeNode,
          callback,
          (firstParam as EsTreeNodeOfType<"Identifier">).name,
        );
        return;
      }

      // Shape: (await fetch(...)).json() — immediate consume, no status possible.
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === (node as EsTreeNode) &&
        !parent.computed &&
        isNodeOfType(parent.property, "Identifier") &&
        BODY_CONSUMER_METHODS.has(parent.property.name)
      ) {
        context.report({ node: node as EsTreeNode, message: MESSAGE });
        return;
      }

      if (isNodeOfType(parent, "AwaitExpression")) {
        const afterAwait = meaningfulParent(parent);
        if (!afterAwait) return;

        // (await fetch(...)).json()
        if (
          isNodeOfType(afterAwait, "MemberExpression") &&
          stripGroupingParens(afterAwait.object as EsTreeNode) === parent &&
          !afterAwait.computed &&
          isNodeOfType(afterAwait.property, "Identifier") &&
          BODY_CONSUMER_METHODS.has(afterAwait.property.name)
        ) {
          context.report({ node: node as EsTreeNode, message: MESSAGE });
          return;
        }

        // const response = await fetch(...)
        let responseName: string | null = null;
        if (
          isNodeOfType(afterAwait, "VariableDeclarator") &&
          isNodeOfType(afterAwait.id, "Identifier")
        ) {
          responseName = afterAwait.id.name;
        } else if (
          isNodeOfType(afterAwait, "AssignmentExpression") &&
          isNodeOfType(afterAwait.left, "Identifier")
        ) {
          responseName = afterAwait.left.name;
        }
        if (!responseName) return;
        const scope = nearestFunction(afterAwait);
        if (!scope) return;
        reportUnguarded(context, node as EsTreeNode, scope, responseName);
      }
    },
  }),
});
