import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findEnclosingFunction } from "./utils/find-enclosing-function.js";

const REQUEST_ANIMATION_FRAME_NAME = "requestAnimationFrame";
const CANCEL_ANIMATION_FRAME_NAME = "cancelAnimationFrame";

interface SelfReschedulingRafLoop {
  rafCall: EsTreeNodeOfType<"CallExpression">;
  scheduledFunction: EsTreeNode;
}

const isRequestAnimationFrameCall = (
  node: EsTreeNode,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") && getCalleeName(node) === REQUEST_ANIMATION_FRAME_NAME;

const resolveFunctionNode = (expression: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!expression) return null;
  const stripped = stripParenExpression(expression);
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    return stripped;
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const binding = findVariableInitializer(stripped, stripped.name);
    const initializer = binding?.initializer;
    if (isFunctionLike(initializer)) {
      return initializer;
    }
  }
  return null;
};

const collectScheduledSelfNames = (
  scheduledArgument: EsTreeNode,
  scheduledFunction: EsTreeNode,
): Set<string> => {
  const selfNames = new Set<string>();
  const strippedArgument = stripParenExpression(scheduledArgument);
  if (isNodeOfType(strippedArgument, "Identifier")) {
    selfNames.add(strippedArgument.name);
  }
  if (
    (isNodeOfType(scheduledFunction, "FunctionExpression") ||
      isNodeOfType(scheduledFunction, "FunctionDeclaration")) &&
    scheduledFunction.id &&
    isNodeOfType(scheduledFunction.id, "Identifier")
  ) {
    selfNames.add(scheduledFunction.id.name);
  }
  return selfNames;
};

const doesSubtreeRescheduleAnyName = (root: EsTreeNode, selfNames: Set<string>): boolean => {
  let didReschedule = false;
  walkAst(root, (child: EsTreeNode) => {
    if (didReschedule) return false;
    if (!isRequestAnimationFrameCall(child)) return;
    const innerArgument = child.arguments?.[0];
    if (!innerArgument) return;
    const strippedInner = stripParenExpression(innerArgument);
    if (isNodeOfType(strippedInner, "Identifier") && selfNames.has(strippedInner.name)) {
      didReschedule = true;
      return false;
    }
  });
  return didReschedule;
};

const findSelfReschedulingRafLoop = (
  effectCallback: EsTreeNode,
): SelfReschedulingRafLoop | null => {
  let foundLoop: SelfReschedulingRafLoop | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (foundLoop) return false;
    if (!isRequestAnimationFrameCall(child)) return;
    const scheduledArgument = child.arguments?.[0];
    if (!scheduledArgument) return;
    const scheduledFunction = resolveFunctionNode(scheduledArgument);
    if (!scheduledFunction) return;
    const selfNames = collectScheduledSelfNames(scheduledArgument, scheduledFunction);
    if (doesSubtreeRescheduleAnyName(scheduledFunction, selfNames)) {
      foundLoop = { rafCall: child, scheduledFunction };
      return false;
    }
  });
  return foundLoop;
};

const collectRafHandleNames = (root: EsTreeNode): Set<string> => {
  const handleNames = new Set<string>();
  walkAst(root, (child: EsTreeNode) => {
    if (!isRequestAnimationFrameCall(child)) return;
    const parent = child.parent;
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.right === child &&
      isNodeOfType(parent.left, "Identifier")
    ) {
      handleNames.add(parent.left.name);
    }
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.right === child &&
      isNodeOfType(parent.left, "MemberExpression") &&
      isNodeOfType(parent.left.object, "Identifier")
    ) {
      handleNames.add(parent.left.object.name);
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === child &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      handleNames.add(parent.id.name);
    }
  });
  return handleNames;
};

const findCleanupReturnFunction = (effectCallback: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return null;
  }
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    return resolveFunctionNode(effectCallback.body);
  }
  for (const statement of effectCallback.body.body ?? []) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      const returnedFunction = resolveFunctionNode(statement.argument);
      if (returnedFunction) return returnedFunction;
    }
  }
  return null;
};

const didCancelAnyStoredHandle = (searchRoot: EsTreeNode, handleNames: Set<string>): boolean => {
  let didCancel = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (didCancel) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      getCalleeName(child) !== CANCEL_ANIMATION_FRAME_NAME
    ) {
      return;
    }
    for (const cancelArgument of child.arguments ?? []) {
      if (subtreeReferencesIdentifierName(cancelArgument, handleNames)) {
        didCancel = true;
        return false;
      }
    }
  });
  return didCancel;
};

const collectCleanupWrittenNames = (cleanupFunction: EsTreeNode): Set<string> => {
  const writtenNames = new Set<string>();
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    const writeTarget = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression")
        ? child.argument
        : null;
    if (isNodeOfType(writeTarget, "Identifier")) {
      writtenNames.add(writeTarget.name);
    } else if (
      isNodeOfType(writeTarget, "MemberExpression") &&
      isNodeOfType(writeTarget.object, "Identifier")
    ) {
      writtenNames.add(writeTarget.object.name);
    }
  });
  return writtenNames;
};

const doesLoopGuardOnAnyName = (loopFunction: EsTreeNode, guardNames: Set<string>): boolean => {
  let didFindGuard = false;
  walkAst(loopFunction, (child: EsTreeNode) => {
    if (didFindGuard) return false;
    let guardTest: EsTreeNode | null = null;
    if (
      isNodeOfType(child, "IfStatement") ||
      isNodeOfType(child, "ConditionalExpression") ||
      isNodeOfType(child, "WhileStatement") ||
      isNodeOfType(child, "DoWhileStatement")
    ) {
      guardTest = child.test;
    } else if (isNodeOfType(child, "LogicalExpression")) {
      guardTest = child.left;
    }
    if (guardTest && subtreeReferencesIdentifierName(guardTest, guardNames)) {
      didFindGuard = true;
      return false;
    }
  });
  return didFindGuard;
};

export const effectRafLoopNeedsCancel = defineRule({
  id: "effect-raf-loop-needs-cancel",
  title: "requestAnimationFrame loop never cancelled",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "Store the frame id and return a cleanup that calls `cancelAnimationFrame(id)` so the self-scheduling loop stops on unmount instead of running setState ~60x/sec against a torn-down component.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const rafLoop = findSelfReschedulingRafLoop(callback);
      if (!rafLoop) return;

      const handleNames = new Set([
        ...collectRafHandleNames(callback),
        ...collectRafHandleNames(rafLoop.scheduledFunction),
      ]);

      const enclosingComponent = findEnclosingFunction(node);
      const cancelSearchRoot = enclosingComponent ?? callback;
      if (didCancelAnyStoredHandle(cancelSearchRoot, handleNames)) return;

      const cleanupReturnFunction = findCleanupReturnFunction(callback);
      if (cleanupReturnFunction) {
        if (subtreeReferencesIdentifierName(cleanupReturnFunction, handleNames)) return;
        const cleanupWrittenNames = collectCleanupWrittenNames(cleanupReturnFunction);
        if (doesLoopGuardOnAnyName(rafLoop.scheduledFunction, cleanupWrittenNames)) return;
      }

      context.report({
        node: rafLoop.rafCall,
        message:
          "This requestAnimationFrame loop reschedules itself every frame but is never cancelled, so it keeps running after unmount; store the frame id and return `() => cancelAnimationFrame(id)` from the effect.",
      });
    },
  }),
});
