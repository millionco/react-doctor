import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "This async handler awaits a mutating request and only flips state after the await, so a fast double-click or double Enter fires the request twice. Add a leading `if (busy) return` guard (or set a flag before the await and disable the control) to close the re-entry window.";

const REENTRY_GUARDED_EVENT_HANDLER_NAMES = new Set(["onClick", "onSubmit", "onPress"]);
const MUTATING_REQUEST_METHOD_NAMES = new Set(["post", "put", "patch", "delete", "mutate"]);
const MUTATING_FETCH_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STATE_SETTER_NAME_PATTERN = /^set[A-Z]/;

const isStateSetterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  STATE_SETTER_NAME_PATTERN.test(node.callee.name);

// Walk a statement collecting only the nodes that execute on this handler path,
// pruning nested function bodies (a nested arrow does not run synchronously).
const walkStatementPruningNestedFunctions = (
  root: EsTreeNode,
  visitor: (node: EsTreeNode) => void,
): void => {
  const visit = (node: EsTreeNode): void => {
    if (node !== root && isFunctionLike(node)) return;
    visitor(node);
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
};

const findFirstAwaitInStatement = (statement: EsTreeNode): EsTreeNode | null => {
  let awaitNode: EsTreeNode | null = null;
  walkStatementPruningNestedFunctions(statement, (node) => {
    if (!awaitNode && isNodeOfType(node, "AwaitExpression")) awaitNode = node;
  });
  return awaitNode;
};

const statementContainsStateSetterCall = (statement: EsTreeNode): boolean => {
  let found = false;
  walkStatementPruningNestedFunctions(statement, (node) => {
    if (isStateSetterCall(node)) found = true;
  });
  return found;
};

// `fetch(url, { method: "POST" | "PUT" | "PATCH" | "DELETE" })`.
const isMutatingFetchCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return optionsArgument.properties.some((property) => {
    if (!isNodeOfType(property, "Property") || property.computed) return false;
    const key = property.key;
    const keyName = isNodeOfType(key, "Identifier")
      ? key.name
      : isNodeOfType(key, "Literal")
        ? String(key.value)
        : null;
    if (keyName !== "method") return false;
    const value = property.value;
    return (
      isNodeOfType(value, "Literal") &&
      typeof value.value === "string" &&
      MUTATING_FETCH_HTTP_METHODS.has(value.value.toUpperCase())
    );
  });
};

// A mutating network op: a mutating `fetch`, or a `.post`/`.put`/`.patch`/
// `.delete`/`.mutate` call. Chained calls (`fetch(...).then(...)`) unwrap to
// their base receiver so a trailing `.then`/`.json` doesn't hide the verb.
const awaitedExpressionIsMutatingNetworkOp = (
  expression: EsTreeNode | null | undefined,
): boolean => {
  if (!expression) return false;
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  if (isMutatingFetchCall(stripped)) return true;
  const callee = stripped.callee;
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    if (
      isNodeOfType(callee.property, "Identifier") &&
      MUTATING_REQUEST_METHOD_NAMES.has(callee.property.name)
    ) {
      return true;
    }
    return awaitedExpressionIsMutatingNetworkOp(callee.object as EsTreeNode);
  }
  return false;
};

// A synchronous in-flight guard placed BEFORE the first await:
// `if (busy) return;` (early-return re-entry guard) or a leading `setBusy(true)`
// (loading-flag pattern; treated conservatively as sufficient protection).
const isLeadingReentryGuard = (statement: EsTreeNode): boolean => {
  if (
    isNodeOfType(statement, "ExpressionStatement") &&
    isStateSetterCall(statement.expression as EsTreeNode)
  ) {
    return true;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    const consequent = statement.consequent;
    if (isNodeOfType(consequent, "ReturnStatement")) return true;
    if (
      isNodeOfType(consequent, "BlockStatement") &&
      consequent.body.some((inner) => isNodeOfType(inner as EsTreeNode, "ReturnStatement"))
    ) {
      return true;
    }
  }
  return false;
};

const resolveHandlerFunction = (value: EsTreeNode): EsTreeNode | null => {
  if (isInlineFunctionExpression(value)) return value;
  if (isNodeOfType(value, "Identifier")) {
    const binding = findVariableInitializer(value, value.name);
    if (binding?.initializer && isFunctionLike(binding.initializer)) return binding.initializer;
  }
  return null;
};

// Reports when an async handler runs a mutating network op at its first await
// and only flips state afterward, with no leading re-entry guard closing the
// double-click / double-Enter window.
const analyzeAsyncHandler = (context: RuleContext, functionNode: EsTreeNode): void => {
  if (!isFunctionLike(functionNode)) return;
  if (!(functionNode as { async?: boolean }).async) return;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return;

  let sawFirstAwait = false;
  let mutatingAwaitNode: EsTreeNode | null = null;
  let hasPostAwaitStateSetter = false;

  for (const statement of functionNode.body.body) {
    const currentStatement = statement as EsTreeNode;
    if (!sawFirstAwait) {
      if (isLeadingReentryGuard(currentStatement)) return;
      const firstAwait = findFirstAwaitInStatement(currentStatement);
      if (firstAwait) {
        sawFirstAwait = true;
        if (
          !awaitedExpressionIsMutatingNetworkOp((firstAwait as { argument?: EsTreeNode }).argument)
        ) {
          return;
        }
        mutatingAwaitNode = firstAwait;
      }
      continue;
    }
    if (statementContainsStateSetterCall(currentStatement)) hasPostAwaitStateSetter = true;
  }

  if (!sawFirstAwait || !mutatingAwaitNode || !hasPostAwaitStateSetter) return;
  context.report({ node: mutatingAwaitNode, message: MESSAGE });
};

export const noAsyncEventHandlerWithoutReentryGuard = defineRule({
  id: "no-async-event-handler-without-reentry-guard",
  title: "Async mutating handler without re-entry guard",
  severity: "warn",
  recommendation:
    "An async onClick/onSubmit/onPress handler that awaits a mutating request and sets state only afterward stays interactive across the await, so a double-click fires the write twice. Add a leading `if (busy) return` guard, or set a flag before the await and disable the control.",
  create: (context: RuleContext) => {
    const analyzedFunctions = new WeakSet<EsTreeNode>();
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (!REENTRY_GUARDED_EVENT_HANDLER_NAMES.has(node.name.name)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const handlerFunction = resolveHandlerFunction(value.expression as EsTreeNode);
        if (!handlerFunction || analyzedFunctions.has(handlerFunction)) return;
        analyzedFunctions.add(handlerFunction);
        analyzeAsyncHandler(context, handlerFunction);
      },
    };
  },
});
