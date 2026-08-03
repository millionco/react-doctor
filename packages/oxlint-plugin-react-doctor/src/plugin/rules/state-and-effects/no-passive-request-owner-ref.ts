import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { canNodeReachLaterNodeWithinFunction } from "../../utils/can-node-reach-later-node-within-function.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isDescendantWithoutFunctionBoundary } from "../../utils/is-descendant-without-function-boundary.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookResultReference } from "../../utils/is-react-hook-result-reference.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "This request guard relies on an owner ref updated by a passive effect, leaving a render-to-effect window where an old request can commit into the new owner. Invalidate the request before that window or tie it to a cleanup that runs before stale commits.";

const EFFECT_HOOKS = new Set(["useEffect"]);
const REF_HOOKS = new Set(["useRef"]);
const STATE_DISPATCHER_HOOKS = new Set(["useReducer", "useState"]);

interface PassiveOwnerSync {
  ownerFunction: EsTreeNode;
  ownerRefSymbolId: number;
  ownerSymbolId: number;
}

const isCurrentMemberForSymbol = (
  node: EsTreeNode,
  symbolId: number,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  if (getStaticPropertyName(candidate) !== "current") return false;
  const receiver = stripParenExpression(candidate.object);
  return (
    isNodeOfType(receiver, "Identifier") && context.scopes.symbolFor(receiver)?.id === symbolId
  );
};

const doesDependencyArrayContainSymbol = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  symbolId: number,
  context: RuleContext,
): boolean => {
  const dependencyArgument = effectCall.arguments[1];
  if (!dependencyArgument) return false;
  const dependencyArray = stripParenExpression(dependencyArgument);
  if (!isNodeOfType(dependencyArray, "ArrayExpression")) return false;
  return dependencyArray.elements.some((element) => {
    if (!element) return false;
    const dependency = stripParenExpression(element);
    return (
      isNodeOfType(dependency, "Identifier") &&
      context.scopes.symbolFor(dependency)?.id === symbolId
    );
  });
};

const findPassiveOwnerSyncs = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): PassiveOwnerSync[] => {
  const ownerFunction = findEnclosingFunction(effectCall);
  const callback = getEffectCallback(effectCall, context.scopes);
  if (!ownerFunction || !isFunctionLike(callback)) return [];
  const passiveOwnerSyncs: PassiveOwnerSync[] = [];
  walkOwnFunctionScope(callback, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "AssignmentExpression") || node.operator !== "=") {
      return;
    }
    const target = stripParenExpression(node.left);
    const owner = stripParenExpression(node.right);
    if (
      !isNodeOfType(target, "MemberExpression") ||
      getStaticPropertyName(target) !== "current" ||
      !isNodeOfType(owner, "Identifier")
    ) {
      return;
    }
    const ownerRef = stripParenExpression(target.object);
    if (
      !isNodeOfType(ownerRef, "Identifier") ||
      !isReactHookResultReference(ownerRef, REF_HOOKS, null, context.scopes)
    ) {
      return;
    }
    const ownerSymbol = context.scopes.symbolFor(owner);
    const ownerRefSymbol = context.scopes.symbolFor(ownerRef);
    if (
      !ownerSymbol ||
      !ownerRefSymbol ||
      ownerSymbol.kind !== "parameter" ||
      ownerSymbol.scope.node !== ownerFunction ||
      !doesDependencyArrayContainSymbol(effectCall, ownerSymbol.id, context)
    ) {
      return;
    }
    if (
      passiveOwnerSyncs.some(
        (passiveOwnerSync) =>
          passiveOwnerSync.ownerRefSymbolId === ownerRefSymbol.id &&
          passiveOwnerSync.ownerSymbolId === ownerSymbol.id,
      )
    ) {
      return;
    }
    passiveOwnerSyncs.push({
      ownerFunction,
      ownerRefSymbolId: ownerRefSymbol.id,
      ownerSymbolId: ownerSymbol.id,
    });
  });
  return passiveOwnerSyncs;
};

const doesTestContainOwnerMismatch = (
  test: EsTreeNode,
  passiveOwnerSync: PassiveOwnerSync,
  context: RuleContext,
): boolean => {
  let hasOwnerMismatch = false;
  walkAst(test, (node: EsTreeNode) => {
    if (
      hasOwnerMismatch ||
      !isNodeOfType(node, "BinaryExpression") ||
      (node.operator !== "!=" && node.operator !== "!==")
    ) {
      return;
    }
    const left = stripParenExpression(node.left);
    const right = stripParenExpression(node.right);
    const isOwnerIdentifier = (candidate: EsTreeNode): boolean =>
      isNodeOfType(candidate, "Identifier") &&
      context.scopes.symbolFor(candidate)?.id === passiveOwnerSync.ownerSymbolId;
    hasOwnerMismatch =
      (isCurrentMemberForSymbol(left, passiveOwnerSync.ownerRefSymbolId, context) &&
        isOwnerIdentifier(right)) ||
      (isOwnerIdentifier(left) &&
        isCurrentMemberForSymbol(right, passiveOwnerSync.ownerRefSymbolId, context));
  });
  return hasOwnerMismatch;
};

const isStateDispatcherCall = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    isReactHookResultReference(callee, STATE_DISPATCHER_HOOKS, 1, context.scopes)
  );
};

const doesAsyncFunctionTrustPassiveOwner = (
  asyncFunction: EsTreeNode,
  passiveOwnerSync: PassiveOwnerSync,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(asyncFunction) || !asyncFunction.async) return false;
  const awaitNodes: EsTreeNode[] = [];
  const ownerGuards: EsTreeNodeOfType<"IfStatement">[] = [];
  const stateDispatcherCalls: EsTreeNode[] = [];
  walkOwnFunctionScope(asyncFunction, (node: EsTreeNode) => {
    if (isNodeOfType(node, "AwaitExpression")) {
      awaitNodes.push(node);
      return;
    }
    if (
      isNodeOfType(node, "IfStatement") &&
      isEarlyExitStatement(node.consequent) &&
      doesTestContainOwnerMismatch(node.test, passiveOwnerSync, context)
    ) {
      ownerGuards.push(node);
      return;
    }
    if (isStateDispatcherCall(node, context)) stateDispatcherCalls.push(node);
  });
  return ownerGuards.some(
    (ownerGuard) =>
      awaitNodes.some((awaitNode) =>
        canNodeReachLaterNodeWithinFunction(awaitNode, ownerGuard, asyncFunction, context),
      ) &&
      stateDispatcherCalls.some(
        (stateDispatcherCall) =>
          !isDescendantWithoutFunctionBoundary(stateDispatcherCall, ownerGuard.consequent) &&
          nodesCanCoExecute(ownerGuard, stateDispatcherCall, context) &&
          canNodeReachLaterNodeWithinFunction(
            ownerGuard,
            stateDispatcherCall,
            asyncFunction,
            context,
          ),
      ),
  );
};

const hasAsyncCommitTrustingPassiveOwner = (
  passiveOwnerSync: PassiveOwnerSync,
  context: RuleContext,
): boolean => {
  let hasUnsafeCommit = false;
  walkAst(passiveOwnerSync.ownerFunction, (node: EsTreeNode) => {
    if (
      node !== passiveOwnerSync.ownerFunction &&
      isFunctionLike(node) &&
      doesAsyncFunctionTrustPassiveOwner(node, passiveOwnerSync, context)
    ) {
      hasUnsafeCommit = true;
      return false;
    }
  });
  return hasUnsafeCommit;
};

export const noPassiveRequestOwnerRef = defineRule({
  id: "no-passive-request-owner-ref",
  title: "Passive owner ref leaves a stale-request window",
  severity: "warn",
  category: "Bugs",
  tags: ["react-jsx-only"],
  defaultEnabled: false,
  recommendation:
    "Invalidate requests when the owner changes before an old promise can settle, or bind the request to lifecycle cleanup instead of trusting a ref synchronized by `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isReactApiCall(node, EFFECT_HOOKS, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }
      const passiveOwnerSyncs = findPassiveOwnerSyncs(node, context);
      if (
        passiveOwnerSyncs.some((passiveOwnerSync) =>
          hasAsyncCommitTrustingPassiveOwner(passiveOwnerSync, context),
        )
      ) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
