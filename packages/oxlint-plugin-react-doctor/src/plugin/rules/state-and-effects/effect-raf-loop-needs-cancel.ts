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
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";

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

const memberChainBaseIdentifierName = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode = node;
  while (isNodeOfType(cursor, "MemberExpression")) cursor = cursor.object as EsTreeNode;
  return isNodeOfType(cursor, "Identifier") ? cursor.name : null;
};

const collectRafHandleNames = (root: EsTreeNode): Set<string> => {
  const handleNames = new Set<string>();
  walkAst(root, (child: EsTreeNode) => {
    if (!isRequestAnimationFrameCall(child)) return;
    const parent = child.parent;
    if (isNodeOfType(parent, "AssignmentExpression") && parent.right === child) {
      if (isNodeOfType(parent.left, "Identifier")) {
        handleNames.add(parent.left.name);
      } else if (isNodeOfType(parent.left, "MemberExpression")) {
        // `animRef.current.rafId = raf(...)` — any nesting depth roots at
        // the ref binding.
        const baseName = memberChainBaseIdentifierName(parent.left as EsTreeNode);
        if (baseName) handleNames.add(baseName);
      }
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === child &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      handleNames.add(parent.id.name);
    }
    // `frameIds.set(piece.id, raf(loop))` — the CONTAINER holds the handle.
    if (
      isNodeOfType(parent, "CallExpression") &&
      (parent.arguments ?? []).includes(child as never) &&
      isNodeOfType(parent.callee, "MemberExpression")
    ) {
      const containerName = memberChainBaseIdentifierName(parent.callee.object as EsTreeNode);
      if (containerName) handleNames.add(containerName);
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
  let nestedReturnFunction: EsTreeNode | null = null;
  walkAst(effectCallback.body, (child: EsTreeNode) => {
    if (nestedReturnFunction) return false;
    // Do not descend into inner functions — their returns are not the
    // effect's cleanup — but DO look inside if/try blocks.
    if (child !== effectCallback.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      const returnedFunction = resolveFunctionNode(child.argument as EsTreeNode);
      if (returnedFunction) {
        nestedReturnFunction = returnedFunction;
        return false;
      }
    }
  });
  return nestedReturnFunction;
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
    // `frameIds.forEach((id) => cancelAnimationFrame(id))` — the cancel sits
    // in an iteration callback whose RECEIVER is the handle container.
    let cursor: EsTreeNode | null | undefined = child.parent;
    while (cursor && !didCancel) {
      if (
        isNodeOfType(cursor, "CallExpression") &&
        isNodeOfType(cursor.callee, "MemberExpression") &&
        subtreeReferencesIdentifierName(cursor.callee.object as EsTreeNode, handleNames)
      ) {
        didCancel = true;
        return false;
      }
      cursor = cursor.parent ?? null;
    }
  });
  return didCancel;
};

const collectWrittenNames = (root: EsTreeNode, writtenNames: Set<string>): void => {
  walkAst(root, (child: EsTreeNode) => {
    const writeTarget = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression")
        ? child.argument
        : null;
    if (isNodeOfType(writeTarget, "Identifier")) {
      writtenNames.add(writeTarget.name);
    } else if (isNodeOfType(writeTarget, "MemberExpression")) {
      const baseName = memberChainBaseIdentifierName(writeTarget as EsTreeNode);
      if (baseName) writtenNames.add(baseName);
    }
  });
};

// Names the cleanup neutralizes: direct writes, the roots of anything it
// CALLS (`controller.abort()`, `stop()`, `stopRef.current()`), the writes
// inside same-effect functions those calls resolve to, and the writes of
// functions assigned to `<root>.current` (custom stop-through-a-ref hooks).
const collectCleanupWrittenNames = (
  cleanupFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): Set<string> => {
  const writtenNames = new Set<string>();
  collectWrittenNames(cleanupFunction, writtenNames);
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (isNodeOfType(callee, "Identifier")) {
      writtenNames.add(callee.name);
      // `return () => stop()` — merge the writes of the same-effect helper.
      walkAst(effectCallback, (candidate: EsTreeNode) => {
        if (
          isNodeOfType(candidate, "VariableDeclarator") &&
          isNodeOfType(candidate.id, "Identifier") &&
          candidate.id.name === callee.name &&
          candidate.init &&
          isFunctionLike(candidate.init as EsTreeNode)
        ) {
          collectWrittenNames(candidate.init as EsTreeNode, writtenNames);
        }
      });
      return;
    }
    if (isNodeOfType(callee, "MemberExpression")) {
      const rootName = memberChainBaseIdentifierName(callee as EsTreeNode);
      if (!rootName) return;
      writtenNames.add(rootName);
      // `stopRef.current()` — merge the writes of the function assigned to
      // `stopRef.current` inside the effect.
      walkAst(effectCallback, (candidate: EsTreeNode) => {
        if (
          isNodeOfType(candidate, "AssignmentExpression") &&
          isNodeOfType(candidate.left, "MemberExpression") &&
          memberChainBaseIdentifierName(candidate.left as EsTreeNode) === rootName &&
          candidate.right &&
          isFunctionLike(candidate.right as EsTreeNode)
        ) {
          collectWrittenNames(candidate.right as EsTreeNode, writtenNames);
        }
      });
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

// A tween that reschedules only while progress is inside a numeric bound
// terminates by construction within a bounded number of frames — there is
// nothing left to cancel. Both directions count: `if (t < 1) raf(step)`
// (progress grows to the bound) and `if (Math.abs(velocity) > 0.1)
// raf(animate)` (a damped quantity decays to the threshold), including
// `&&`/`||` combinations of such comparisons.
const RELATIONAL_BOUND_OPERATORS = new Set(["<", "<=", ">", ">="]);

const isNumericBoundTest = (test: EsTreeNode): boolean => {
  const stripped = stripParenExpression(test);
  if (isNodeOfType(stripped, "LogicalExpression") && stripped.operator !== "??") {
    return isNumericBoundTest(stripped.left) && isNumericBoundTest(stripped.right);
  }
  return (
    isNodeOfType(stripped, "BinaryExpression") &&
    RELATIONAL_BOUND_OPERATORS.has(stripped.operator) &&
    ((isNodeOfType(stripped.right, "Literal") && typeof stripped.right.value === "number") ||
      (isNodeOfType(stripped.left, "Literal") && typeof stripped.left.value === "number"))
  );
};

const everyRescheduleIsProgressBounded = (scheduledFunction: EsTreeNode): boolean => {
  let sawReschedule = false;
  let sawUnboundedReschedule = false;
  walkAst(scheduledFunction, (child: EsTreeNode) => {
    if (sawUnboundedReschedule) return false;
    if (!isRequestAnimationFrameCall(child)) return;
    sawReschedule = true;
    let bounded = false;
    let cursor: EsTreeNode | null | undefined = child.parent;
    while (cursor && cursor !== scheduledFunction) {
      if (
        (isNodeOfType(cursor, "IfStatement") || isNodeOfType(cursor, "ConditionalExpression")) &&
        isNumericBoundTest(cursor.test as EsTreeNode)
      ) {
        bounded = true;
        break;
      }
      cursor = cursor.parent ?? null;
    }
    if (!bounded) sawUnboundedReschedule = true;
  });
  return sawReschedule && !sawUnboundedReschedule;
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
      if (everyRescheduleIsProgressBounded(rafLoop.scheduledFunction)) return;

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
        const cleanupWrittenNames = collectCleanupWrittenNames(cleanupReturnFunction, callback);
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
