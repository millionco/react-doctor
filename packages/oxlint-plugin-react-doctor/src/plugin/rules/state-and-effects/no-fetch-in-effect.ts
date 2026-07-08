import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../../constants/library.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const IMPORT_INITIALIZER_TYPES = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

const CANCELLATION_FLAG_NAME_PATTERN = /cancel/i;

// `const fetch = useCallback(...)` (demo mocks, wrappers) shadows the global;
// the call is not a network fetch by the library the rule targets. A binding
// that IS an import (ky, got, a fetch wrapper module) still counts.
const isShadowedByLocalBinding = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const initializer = binding.initializer;
  if (initializer && IMPORT_INITIALIZER_TYPES.has(initializer.type)) return false;
  return true;
};

const isRealFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && FETCH_CALLEE_NAMES.has(node.callee.name)) {
    return !isShadowedByLocalBinding(node.callee);
  }
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    FETCH_MEMBER_OBJECTS.has(node.callee.object.name) &&
    !isShadowedByLocalBinding(node.callee.object)
  );
};

const isXmlHttpRequestConstruction = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "XMLHttpRequest";

const isNetworkRequest = (node: EsTreeNode): boolean =>
  isRealFetchCall(node) || isXmlHttpRequestConstruction(node);

const containsNetworkRequest = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child) => {
    if (found) return false;
    if (isNetworkRequest(child)) {
      found = true;
      return false;
    }
  });
  return found;
};

const collectComponentScopeFunctionBindings = (
  componentScope: EsTreeNode,
  effectCallback: EsTreeNode,
): Map<string, EsTreeNode> => {
  const bindings = new Map<string, EsTreeNode>();
  walkAst(componentScope, (child) => {
    if (child === effectCallback) return false;
    if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
      const initializer = child.init ? stripParenExpression(child.init) : null;
      if (isFunctionLike(initializer)) bindings.set(child.id.name, initializer);
      return;
    }
    if (isNodeOfType(child, "FunctionDeclaration") && isNodeOfType(child.id, "Identifier")) {
      bindings.set(child.id.name, child);
    }
  });
  return bindings;
};

const containsNetworkRequestInEffect = (effectCallback: EsTreeNode): boolean => {
  const invokedFunctions = collectEffectInvokedFunctions(effectCallback);
  for (const invokedFunction of invokedFunctions) {
    if (containsNetworkRequest(invokedFunction)) return true;
  }

  const enclosingComponent = findEnclosingFunction(effectCallback);
  if (!enclosingComponent) return false;

  const scopeFunctions = collectComponentScopeFunctionBindings(enclosingComponent, effectCallback);
  let found = false;
  walkAst(effectCallback, (child) => {
    if (found) return false;
    if (child !== effectCallback && isFunctionLike(child) && invokedFunctions.has(child)) {
      return false;
    }
    if (isNodeOfType(child, "CallExpression") && isNodeOfType(child.callee, "Identifier")) {
      const scopeFunction = scopeFunctions.get(child.callee.name);
      if (scopeFunction && containsNetworkRequest(scopeFunction)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

const findEffectCleanupFunction = (callback: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(callback)) return null;
  const body = callback.body;
  if (isFunctionLike(body)) return body;
  let cleanup: EsTreeNode | null = null;
  walkAst(body, (child) => {
    if (child !== body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      isFunctionLike(child.argument)
    ) {
      cleanup = child.argument;
    }
  });
  return cleanup;
};

const collectEffectCancellationFlagNames = (effectCallback: EsTreeNode): Set<string> => {
  const flagNames = new Set<string>();
  if (!isFunctionLike(effectCallback)) return flagNames;
  const body = effectCallback.body;
  if (!isNodeOfType(body, "BlockStatement")) return flagNames;
  for (const statement of body.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "let") continue;
    for (const declarator of statement.declarations ?? []) {
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        !isNodeOfType(declarator.id, "Identifier")
      ) {
        continue;
      }
      const initializer = declarator.init;
      if (
        isNodeOfType(initializer, "Literal") &&
        initializer.value === false &&
        CANCELLATION_FLAG_NAME_PATTERN.test(declarator.id.name)
      ) {
        flagNames.add(declarator.id.name);
      }
    }
  }
  return flagNames;
};

// The doc's explicit false-positive carve-out: a one-shot fetch with proper
// cancellation cleanup — `controller.abort()` on unmount, or the react.dev
// boolean-flag equivalent (`cancelled = true` checked before setState).
const isCancellationCleanup = (cleanup: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  const cancellationFlagNames = collectEffectCancellationFlagNames(effectCallback);
  let found = false;
  walkAst(cleanup, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "abort"
    ) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      cancellationFlagNames.has(child.left.name) &&
      isNodeOfType(child.right, "Literal") &&
      child.right.value === true
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

export const noFetchInEffect = defineRule({
  id: "no-fetch-in-effect",
  title: "Data fetching inside an effect",
  severity: "warn",
  recommendation:
    "Use a data-fetching layer or Server Component so fetches do not race, double-fire, or leak from `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      if (!containsNetworkRequestInEffect(callback)) return;

      const cleanup = findEffectCleanupFunction(callback);
      if (cleanup && isCancellationCleanup(cleanup, callback)) return;

      context.report({
        node,
        message:
          "fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.",
      });
    },
  }),
});
