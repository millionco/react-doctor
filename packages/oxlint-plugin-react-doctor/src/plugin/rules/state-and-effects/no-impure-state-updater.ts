import { isDescendantScope } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { hasReactRefCurrentOrigin } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getRef, resolveToFunction } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getUseStateDecl, isStateSetterCall } from "./utils/effect/react.js";

interface MemberCall {
  methodName: string;
  receiver: EsTreeNode;
}

const TIMER_FUNCTION_NAMES = new Set([
  "cancelAnimationFrame",
  "clearInterval",
  "clearTimeout",
  "queueMicrotask",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
]);

const STORAGE_MUTATION_METHOD_NAMES = new Set(["clear", "removeItem", "setItem"]);
const STORAGE_RECEIVER_NAMES = new Set(["localStorage", "sessionStorage"]);
const EXTERNAL_READ_METHOD_NAMES = new Set(["getBoundingClientRect", "getClientRects"]);
const NOTIFICATION_RECEIVER_NAMES = new Set(["message", "notification", "toast"]);
const NOTIFICATION_METHOD_NAMES = new Set([
  "error",
  "info",
  "loading",
  "open",
  "show",
  "success",
  "warning",
]);
const NOTIFICATION_MODULE_SOURCES = new Set([
  "@chakra-ui/react",
  "@heroui/react",
  "@mantine/notifications",
  "antd",
  "react-hot-toast",
  "react-toastify",
  "sonner",
]);
const SYNCHRONOUS_ARRAY_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
]);

const isNotificationModuleSource = (source: string | null): boolean => {
  if (!source) return false;
  for (const moduleSource of NOTIFICATION_MODULE_SOURCES) {
    if (source === moduleSource || source.startsWith(`${moduleSource}/`)) return true;
  }
  return /(?:^|[/_.-])(?:notification|toast)s?(?:$|[/_.-])/i.test(source);
};

const getMemberCall = (node: EsTreeNode): MemberCall | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression") || node.callee.computed) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  return {
    methodName: node.callee.property.name,
    receiver: stripParenExpression(node.callee.object),
  };
};

const isNotificationReceiver = (receiver: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const importBinding = getImportBindingForName(receiver, receiver.name);
  if (importBinding) {
    return (
      isNotificationModuleSource(importBinding.source) &&
      (importBinding.exportedName === "default" ||
        (importBinding.exportedName !== null &&
          NOTIFICATION_RECEIVER_NAMES.has(importBinding.exportedName)))
    );
  }
  const symbol = scopes.symbolFor(receiver);
  if (!isNodeOfType(symbol?.initializer, "CallExpression")) return false;
  const callee = symbol.initializer.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const hookImport = getImportBindingForName(callee, callee.name);
  return Boolean(
    hookImport &&
    isNotificationModuleSource(hookImport.source) &&
    hookImport.exportedName !== null &&
    /^use(?:Message|Notification|Toast)$/.test(hookImport.exportedName),
  );
};

const isKnownGlobalObject = (
  node: EsTreeNode,
  expectedName: string,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "Identifier") && node.name === expectedName && scopes.isGlobalReference(node);

const isGlobalMember = (
  node: EsTreeNode,
  expectedPropertyName: string,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === expectedPropertyName &&
  (isKnownGlobalObject(node.object, "window", scopes) ||
    isKnownGlobalObject(node.object, "globalThis", scopes));

const isStorageReceiver = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    isNodeOfType(node, "Identifier") &&
    STORAGE_RECEIVER_NAMES.has(node.name) &&
    scopes.isGlobalReference(node)
  ) {
    return true;
  }
  for (const receiverName of STORAGE_RECEIVER_NAMES) {
    if (isGlobalMember(node, receiverName, scopes)) return true;
  }
  return false;
};

const getKnownImpureCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    isNodeOfType(callExpression.callee, "Identifier") &&
    TIMER_FUNCTION_NAMES.has(callExpression.callee.name) &&
    scopes.isGlobalReference(callExpression.callee)
  ) {
    return `${callExpression.callee.name}()`;
  }

  if (
    isNodeOfType(callExpression.callee, "MemberExpression") &&
    !callExpression.callee.computed &&
    isNodeOfType(callExpression.callee.property, "Identifier") &&
    TIMER_FUNCTION_NAMES.has(callExpression.callee.property.name) &&
    (isKnownGlobalObject(callExpression.callee.object, "window", scopes) ||
      isKnownGlobalObject(callExpression.callee.object, "globalThis", scopes))
  ) {
    return `${callExpression.callee.property.name}()`;
  }

  const memberCall = getMemberCall(callExpression);
  if (!memberCall) return null;
  const { methodName, receiver } = memberCall;
  if (STORAGE_MUTATION_METHOD_NAMES.has(methodName) && isStorageReceiver(receiver, scopes)) {
    return `${methodName}()`;
  }
  if (EXTERNAL_READ_METHOD_NAMES.has(methodName) && hasReactRefCurrentOrigin(receiver, scopes)) {
    return `.${methodName}()`;
  }
  const receiverRoot = getRootIdentifier(receiver);
  if (
    EXTERNAL_READ_METHOD_NAMES.has(methodName) &&
    receiverRoot !== null &&
    isKnownGlobalObject(receiverRoot, "document", scopes)
  ) {
    return `.${methodName}()`;
  }
  if (NOTIFICATION_METHOD_NAMES.has(methodName) && isNotificationReceiver(receiver, scopes)) {
    return `${methodName}()`;
  }
  return null;
};

const getExternalAssignmentDescription = (
  assignmentTarget: EsTreeNode,
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const rootIdentifier = getRootIdentifier(assignmentTarget);
  if (!rootIdentifier) return null;
  const updaterScope = scopes.ownScopeFor(updater);
  if (!updaterScope) return null;
  const symbol = scopes.symbolFor(rootIdentifier);
  if (!symbol) return `the external value "${rootIdentifier.name}"`;
  if (symbol.kind === "parameter" && symbol.scope === updaterScope) {
    return `the updater argument "${rootIdentifier.name}"`;
  }
  return isDescendantScope(symbol.scope, updaterScope)
    ? null
    : `the captured value "${rootIdentifier.name}"`;
};

const isArrayValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "ArrayExpression")) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  return isNodeOfType(
    resolveConstIdentifierAlias(expression, scopes)?.initializer,
    "ArrayExpression",
  );
};

const isDefinitelySynchronousCallback = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = callback.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === callback) return true;
  if (
    !isNodeOfType(parent, "CallExpression") ||
    !parent.arguments?.some((argument) => argument === callback)
  ) {
    return false;
  }
  if (
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    SYNCHRONOUS_ARRAY_METHOD_NAMES.has(parent.callee.property.name) &&
    isArrayValue(parent.callee.object, scopes)
  ) {
    return true;
  }
  return (
    isNodeOfType(parent.callee, "MemberExpression") &&
    !parent.callee.computed &&
    isNodeOfType(parent.callee.object, "Identifier") &&
    parent.callee.object.name === "Array" &&
    scopes.isGlobalReference(parent.callee.object) &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    parent.callee.property.name === "from" &&
    parent.arguments[1] === callback
  );
};

const findImpureUpdaterOperation = (updater: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const analysis = getProgramAnalysis(updater);
  let operation: string | null = null;
  walkAst(updater, (child: EsTreeNode): boolean | void => {
    if (operation) return false;
    if (
      child !== updater &&
      isFunctionLike(child) &&
      !isDefinitelySynchronousCallback(child, scopes)
    ) {
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      if (isNodeOfType(child.callee, "Identifier") && analysis) {
        const calleeReference = getRef(analysis, child.callee);
        if (calleeReference && isStateSetterCall(analysis, calleeReference)) {
          operation = `the nested state update "${child.callee.name}()"`;
          return false;
        }
      }
      const impureCall = getKnownImpureCall(child, scopes);
      if (impureCall) {
        operation = impureCall;
        return false;
      }
    }
    if (isNodeOfType(child, "AssignmentExpression")) {
      operation = getExternalAssignmentDescription(child.left, updater, scopes);
      if (operation) return false;
    }
    if (isNodeOfType(child, "UpdateExpression")) {
      operation = getExternalAssignmentDescription(child.argument, updater, scopes);
      if (operation) return false;
    }
  });
  return operation;
};

export const noImpureStateUpdater = defineRule({
  id: "no-impure-state-updater",
  title: "State updater has side effects",
  severity: "error",
  recommendation:
    "Keep state updater callbacks pure and return only the next state. Move notifications, storage, timers, ref writes, and other external work into the event or effect that queues the update.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const updaterArgument = node.arguments?.[0];
      if (!updaterArgument) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis || !isNodeOfType(node.callee, "Identifier")) return;
      const calleeReference = getRef(analysis, node.callee);
      if (!calleeReference || !isStateSetterCall(analysis, calleeReference)) return;
      const stateDeclarator = getUseStateDecl(analysis, calleeReference);
      if (
        !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
        !isNodeOfType(stateDeclarator.init, "CallExpression") ||
        !isReactApiCall(stateDeclarator.init, "useState", context.scopes, {
          allowGlobalReactNamespace: true,
        })
      ) {
        return;
      }
      let updater: EsTreeNode | null = null;
      if (isFunctionLike(updaterArgument)) {
        updater = updaterArgument;
      } else if (isNodeOfType(updaterArgument, "Identifier")) {
        const updaterReference = getRef(analysis, updaterArgument);
        if (updaterReference) updater = resolveToFunction(updaterReference);
      }
      if (!updater) return;
      const operation = findImpureUpdaterOperation(updater, context.scopes);
      if (!operation) return;
      context.report({
        node: updaterArgument,
        message: `This state updater performs ${operation}. React may run updater functions more than once, so side effects here can repeat or observe inconsistent external state.`,
      });
    },
  }),
});
