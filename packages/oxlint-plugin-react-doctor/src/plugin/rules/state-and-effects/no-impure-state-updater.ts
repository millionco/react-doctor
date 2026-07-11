import { isDescendantScope } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getRef } from "./utils/effect/ast.js";
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
  if (!NOTIFICATION_RECEIVER_NAMES.has(receiver.name)) return false;
  const symbol = scopes.symbolFor(receiver);
  if (symbol?.kind === "import") return true;
  if (!isNodeOfType(symbol?.initializer, "CallExpression")) return false;
  const callee = symbol.initializer.callee;
  return (
    isNodeOfType(callee, "Identifier") && /^use(?:Message|Notification|Toast)$/.test(callee.name)
  );
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

  const memberCall = getMemberCall(callExpression);
  if (!memberCall) return null;
  const { methodName, receiver } = memberCall;
  if (
    STORAGE_MUTATION_METHOD_NAMES.has(methodName) &&
    isNodeOfType(receiver, "Identifier") &&
    STORAGE_RECEIVER_NAMES.has(receiver.name) &&
    scopes.isGlobalReference(receiver)
  ) {
    return `${receiver.name}.${methodName}()`;
  }
  if (EXTERNAL_READ_METHOD_NAMES.has(methodName)) return `.${methodName}()`;
  if (
    NOTIFICATION_METHOD_NAMES.has(methodName) &&
    isNodeOfType(receiver, "Identifier") &&
    isNotificationReceiver(receiver, scopes)
  ) {
    return `${receiver.name}.${methodName}()`;
  }
  return null;
};

const getExternalAssignmentDescription = (
  assignmentTarget: EsTreeNode,
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let rootIdentifier: EsTreeNodeOfType<"Identifier"> | null = null;
  if (isNodeOfType(assignmentTarget, "Identifier")) {
    rootIdentifier = assignmentTarget;
  } else if (
    isNodeOfType(assignmentTarget, "MemberExpression") &&
    isNodeOfType(assignmentTarget.object, "Identifier")
  ) {
    rootIdentifier = assignmentTarget.object;
  }
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

const findImpureUpdaterOperation = (updater: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const analysis = getProgramAnalysis(updater);
  let operation: string | null = null;
  walkAst(updater, (child: EsTreeNode): boolean | void => {
    if (operation) return false;
    if (child !== updater && isFunctionLike(child) && !executesDuringRender(child, scopes)) {
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
      const updater = node.arguments?.[0];
      if (!updater || !isFunctionLike(updater)) return;
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
      const operation = findImpureUpdaterOperation(updater, context.scopes);
      if (!operation) return;
      context.report({
        node: updater,
        message: `This state updater performs ${operation}. React may run updater functions more than once, so side effects here can repeat or observe inconsistent external state.`,
      });
    },
  }),
});
