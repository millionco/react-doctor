import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "This async handler awaits a mutating request and only flips state after the await, so a fast double-click or double Enter fires the request twice. Add a leading `if (busy) return` guard (or set a flag before the await and disable the control) to close the re-entry window.";

const REENTRY_GUARDED_EVENT_HANDLER_NAMES = new Set(["onClick", "onSubmit", "onPress"]);
const MUTATING_REQUEST_METHOD_NAMES = new Set(["post", "put", "patch", "delete", "mutate"]);
const MUTATING_FETCH_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STATE_SETTER_NAME_PATTERN = /^set[A-Z]/;
const NON_STATE_SETTER_GLOBAL_NAMES = new Set(["setTimeout", "setInterval", "setImmediate"]);
const LOCAL_STORAGE_RECEIVER_NAME_PATTERN = /^(?:db|idb|database|caches?|store)$/i;

const getNodeOffset = (node: EsTreeNode, edge: "start" | "end"): number | null => {
  const offset = (node as { start?: unknown; end?: unknown })[edge];
  if (typeof offset === "number") return offset;
  const range = node.range;
  return range ? range[edge === "start" ? 0 : 1] : null;
};

const isStateSetterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  STATE_SETTER_NAME_PATTERN.test(node.callee.name) &&
  !NON_STATE_SETTER_GLOBAL_NAMES.has(node.callee.name);

const findFirstAwaitInStatement = (statement: EsTreeNode): EsTreeNode | null => {
  let awaitNode: EsTreeNode | null = null;
  walkAst(statement, (node) => {
    if (node !== statement && isFunctionLike(node)) return false;
    if (!awaitNode && isNodeOfType(node, "AwaitExpression")) awaitNode = node;
  });
  return awaitNode;
};

const isInsideCatchOrFinally = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && child !== boundary) {
    if (isNodeOfType(ancestor, "CatchClause")) return true;
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.finalizer === child) return true;
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const statementContainsPostAwaitStateSetter = (
  statement: EsTreeNode,
  afterPosition?: number,
): boolean => {
  let found = false;
  walkAst(statement, (node) => {
    if (node !== statement && isFunctionLike(node)) return false;
    if (found || !isStateSetterCall(node)) return;
    if (afterPosition !== undefined) {
      const setterStart = getNodeOffset(node, "start");
      if (setterStart === null || setterStart <= afterPosition) return;
    }
    if (isInsideCatchOrFinally(node, statement)) return;
    found = true;
  });
  return found;
};

// Endpoint tails whose double-fire is harmless even over POST: read-style
// compute endpoints (a preview/search/validation just recomputes the same
// answer) and idempotent halt endpoints (stopping an already-stopped thing
// is a no-op). Matched against the last STATIC path segment of the request
// URL; a trailing dynamic segment (`/items/${id}`) never matches.
const NON_MUTATING_ENDPOINT_TAIL_PATTERN =
  /^(?:preview|render|search|query|validate|verify|check|stop|cancel|abort)$/i;

const getStaticRequestUrlTail = (node: EsTreeNodeOfType<"CallExpression">): string | null => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return null;
  const stripped = stripParenExpression(firstArgument);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "string") {
    return stripped.value;
  }
  if (isNodeOfType(stripped, "TemplateLiteral")) {
    const lastQuasi = stripped.quasis[stripped.quasis.length - 1];
    const cooked = lastQuasi?.value?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
};

const targetsNonMutatingEndpoint = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const urlTail = getStaticRequestUrlTail(node);
  if (!urlTail) return false;
  const path = urlTail.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];
  return Boolean(lastSegment) && NON_MUTATING_ENDPOINT_TAIL_PATTERN.test(lastSegment);
};

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

const awaitedExpressionIsMutatingNetworkOp = (
  expression: EsTreeNode | null | undefined,
): boolean => {
  if (!expression) return false;
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  if (isMutatingFetchCall(stripped)) return !targetsNonMutatingEndpoint(stripped);
  const callee = stripped.callee;
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    if (
      isNodeOfType(callee.property, "Identifier") &&
      MUTATING_REQUEST_METHOD_NAMES.has(callee.property.name)
    ) {
      // SWR's bound `mutate()` with no arguments is a GET revalidation.
      if (callee.property.name === "mutate" && (stripped.arguments?.length ?? 0) === 0) {
        return false;
      }
      // `db.delete(...)` (IndexedDB) / `caches.delete(...)` are local,
      // idempotent storage operations — no network request exists to double-fire.
      let receiverBase: EsTreeNode = callee.object as EsTreeNode;
      while (isNodeOfType(receiverBase, "MemberExpression")) {
        receiverBase = receiverBase.object as EsTreeNode;
      }
      if (
        isNodeOfType(receiverBase, "Identifier") &&
        LOCAL_STORAGE_RECEIVER_NAME_PATTERN.test(receiverBase.name)
      ) {
        return false;
      }
      // `api.post('/media/stop')` / `client.post('/prompts/preview')` —
      // the static endpoint tail marks the request as read-style or
      // idempotent, so a double-fire carries no duplicate-mutation harm.
      if (targetsNonMutatingEndpoint(stripped)) return false;
      return true;
    }
    return awaitedExpressionIsMutatingNetworkOp(callee.object as EsTreeNode);
  }
  return false;
};

const isLeadingReentryGuard = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ExpressionStatement")) {
    if (isStateSetterCall(statement.expression as EsTreeNode)) return true;
    // `submitButton.disabled = true;` / `busyRef.current = true;` before
    // the await imperatively closes the re-entry window.
    const expression = statement.expression;
    if (
      isNodeOfType(expression, "AssignmentExpression") &&
      isNodeOfType(expression.left, "MemberExpression") &&
      !expression.left.computed &&
      isNodeOfType(expression.left.property, "Identifier") &&
      (expression.left.property.name === "disabled" || expression.left.property.name === "current")
    ) {
      return true;
    }
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

const statementContainsPreAwaitGuardWrite = (
  statement: EsTreeNode,
  firstAwait: EsTreeNode,
): boolean => {
  const awaitStart = getNodeOffset(firstAwait, "start");
  if (awaitStart === null) return false;
  let hasGuardWrite = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (hasGuardWrite) return false;
    const childEnd = getNodeOffset(child, "end");
    if (childEnd === null || childEnd > awaitStart) return;
    if (
      isNodeOfType(child, "ExpressionStatement") &&
      isStateSetterCall(child.expression as EsTreeNode)
    ) {
      hasGuardWrite = true;
      return false;
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      !child.left.computed &&
      isNodeOfType(child.left.property, "Identifier") &&
      (child.left.property.name === "current" || child.left.property.name === "disabled")
    ) {
      hasGuardWrite = true;
      return false;
    }
  });
  return hasGuardWrite;
};

const unwrapUseCallback = (expression: EsTreeNode): EsTreeNode => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return stripped;
  const callee = stripped.callee;
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier")
      ? callee.property.name
      : null;
  if (calleeName !== "useCallback") return stripped;
  const wrappedFunction = stripped.arguments[0];
  return wrappedFunction && isFunctionLike(wrappedFunction) ? wrappedFunction : stripped;
};

const resolveHandlerFunction = (value: EsTreeNode): EsTreeNode | null => {
  const unwrappedValue = unwrapUseCallback(value);
  if (isInlineFunctionExpression(unwrappedValue)) return unwrappedValue;
  if (isNodeOfType(unwrappedValue, "Identifier")) {
    const binding = findVariableInitializer(unwrappedValue, unwrappedValue.name);
    if (!binding?.initializer) return null;
    const unwrappedInitializer = unwrapUseCallback(binding.initializer);
    if (isFunctionLike(unwrappedInitializer)) return unwrappedInitializer;
  }
  return null;
};

const analyzeAsyncHandler = (context: RuleContext, functionNode: EsTreeNode): void => {
  if (!isFunctionLike(functionNode)) return;
  if (!(functionNode as { async?: boolean }).async) return;
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return;

  let mutatingAwaitNode: EsTreeNode | null = null;
  let hasPostAwaitStateSetter = false;

  for (const statement of functionNode.body.body) {
    const currentStatement = statement as EsTreeNode;
    if (!mutatingAwaitNode) {
      if (isLeadingReentryGuard(currentStatement)) return;
      const firstAwait = findFirstAwaitInStatement(currentStatement);
      if (firstAwait) {
        if (
          !awaitedExpressionIsMutatingNetworkOp((firstAwait as { argument?: EsTreeNode }).argument)
        ) {
          return;
        }
        // A busy write BEFORE the await inside the same statement — the
        // wrap-in-if guard (`if (!busy) { setBusy(true); await ... }`), the
        // try/finally form (the rule's own remediation), or an imperative
        // `submitButton.disabled = true` — closes the re-entry window.
        if (statementContainsPreAwaitGuardWrite(currentStatement, firstAwait)) return;
        mutatingAwaitNode = firstAwait;
        const awaitEnd = getNodeOffset(firstAwait, "end");
        if (
          awaitEnd !== null &&
          statementContainsPostAwaitStateSetter(currentStatement, awaitEnd)
        ) {
          hasPostAwaitStateSetter = true;
        }
      }
      continue;
    }
    if (statementContainsPostAwaitStateSetter(currentStatement)) hasPostAwaitStateSetter = true;
  }

  if (!mutatingAwaitNode || !hasPostAwaitStateSetter) return;
  context.report({ node: mutatingAwaitNode, message: MESSAGE });
};

export const noAsyncEventHandlerWithoutReentryGuard = defineRule({
  id: "no-async-event-handler-without-reentry-guard",
  title: "Async mutating handler without re-entry guard",
  severity: "warn",
  recommendation:
    "An async onClick/onSubmit/onPress handler that awaits a mutating request and sets state only afterward stays interactive across the await, so a double-click fires the write twice. Add a leading `if (busy) return` guard, or set a flag before the await inside `try` and reset it in `finally` while the control is disabled.",
  create: (context: RuleContext) => {
    const analyzedFunctions = new WeakSet<EsTreeNode>();
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (!REENTRY_GUARDED_EVENT_HANDLER_NAMES.has(node.name.name)) return;
        // Only intrinsic DOM elements stay interactive across the await:
        // component handlers (Formik onSubmit injects setSubmitting, Radix
        // menu/dialog items auto-close on select) manage their own gating.
        const openingElement = node.parent;
        if (
          !openingElement ||
          !isNodeOfType(openingElement, "JSXOpeningElement") ||
          !isNodeOfType(openingElement.name, "JSXIdentifier") ||
          !/^[a-z]/.test(openingElement.name.name)
        ) {
          return;
        }
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
