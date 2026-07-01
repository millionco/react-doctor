import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REQUEST_ANIMATION_FRAME_NAME = "requestAnimationFrame";
const CANCEL_ANIMATION_FRAME_NAME = "cancelAnimationFrame";

const isRequestAnimationFrameCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") && getCalleeName(node) === REQUEST_ANIMATION_FRAME_NAME;

const subtreeContainsRequestAnimationFrame = (root: EsTreeNode): boolean => {
  let didFind = false;
  walkAst(root, (child: EsTreeNode) => {
    if (didFind) return false;
    if (isRequestAnimationFrameCall(child)) {
      didFind = true;
      return false;
    }
  });
  return didFind;
};

const resolveScheduledFunction = (argument: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!argument) return null;
  const stripped = stripParenExpression(argument);
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    return stripped;
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const binding = findVariableInitializer(stripped, stripped.name);
    const initializer = binding?.initializer;
    if (
      initializer &&
      (isNodeOfType(initializer, "ArrowFunctionExpression") ||
        isNodeOfType(initializer, "FunctionExpression") ||
        isNodeOfType(initializer, "FunctionDeclaration"))
    ) {
      return initializer;
    }
  }
  return null;
};

const collectRafHandleNames = (effectCallback: EsTreeNode): Set<string> => {
  const handleNames = new Set<string>();
  walkAst(effectCallback, (child: EsTreeNode) => {
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
    const concise = stripParenExpression(effectCallback.body);
    return isNodeOfType(concise, "ArrowFunctionExpression") ||
      isNodeOfType(concise, "FunctionExpression")
      ? concise
      : null;
  }
  for (const statement of effectCallback.body.body ?? []) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      const returned = stripParenExpression(statement.argument);
      if (
        isNodeOfType(returned, "ArrowFunctionExpression") ||
        isNodeOfType(returned, "FunctionExpression")
      ) {
        return returned;
      }
    }
  }
  return null;
};

const subtreeReferencesAnyName = (root: EsTreeNode, names: Set<string>): boolean => {
  if (names.size === 0) return false;
  let didReference = false;
  walkAst(root, (child: EsTreeNode) => {
    if (didReference) return false;
    if (isNodeOfType(child, "Identifier") && names.has(child.name)) {
      didReference = true;
      return false;
    }
  });
  return didReference;
};

const findEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = node.parent ?? null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "FunctionDeclaration")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const findSelfReschedulingRafCall = (effectCallback: EsTreeNode): EsTreeNode | null => {
  let selfReschedulingCall: EsTreeNode | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (selfReschedulingCall) return false;
    if (!isRequestAnimationFrameCall(child) || !isNodeOfType(child, "CallExpression")) return;
    const scheduledFunction = resolveScheduledFunction(child.arguments?.[0]);
    if (scheduledFunction && subtreeContainsRequestAnimationFrame(scheduledFunction)) {
      selfReschedulingCall = child;
      return false;
    }
  });
  return selfReschedulingCall;
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

      const selfReschedulingCall = findSelfReschedulingRafCall(callback);
      if (!selfReschedulingCall) return;

      const enclosingComponent = findEnclosingFunction(node);
      const cancelSearchRoot = enclosingComponent ?? callback;
      let didCancelAnywhere = false;
      walkAst(cancelSearchRoot, (child: EsTreeNode) => {
        if (didCancelAnywhere) return false;
        if (
          isNodeOfType(child, "CallExpression") &&
          getCalleeName(child) === CANCEL_ANIMATION_FRAME_NAME
        ) {
          didCancelAnywhere = true;
          return false;
        }
      });
      if (didCancelAnywhere) return;

      const cleanupReturnFunction = findCleanupReturnFunction(callback);
      if (cleanupReturnFunction) {
        const handleNames = collectRafHandleNames(callback);
        if (subtreeReferencesAnyName(cleanupReturnFunction, handleNames)) return;
      }

      context.report({
        node: selfReschedulingCall,
        message:
          "This requestAnimationFrame loop reschedules itself every frame but is never cancelled, so it keeps running after unmount; store the frame id and return `() => cancelAnimationFrame(id)` from the effect.",
      });
    },
  }),
});
