import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenEffectHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REQUEST_ANIMATION_FRAME_NAME = "requestAnimationFrame";
const CANCEL_ANIMATION_FRAME_NAME = "cancelAnimationFrame";

interface SelfReschedulingRafLoop {
  rafCall: EsTreeNodeOfType<"CallExpression">;
  scheduledFunction: EsTreeNode;
}

const isRequestAnimationFrameCall = (
  node: EsTreeNode,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  isGlobalFrameMethodCall(node, REQUEST_ANIMATION_FRAME_NAME);

const GLOBAL_FRAME_RECEIVER_NAMES = new Set(["window", "globalThis", "self"]);

const isGlobalFrameMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === methodName && !findVariableInitializer(callee, callee.name);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== methodName) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  return (
    isNodeOfType(receiver, "Identifier") &&
    GLOBAL_FRAME_RECEIVER_NAMES.has(receiver.name) &&
    !findVariableInitializer(receiver, receiver.name)
  );
};

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

const findSelfReschedulingRafLoops = (effectCallback: EsTreeNode): SelfReschedulingRafLoop[] => {
  const foundLoops: SelfReschedulingRafLoop[] = [];
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (child !== effectCallback && isFunctionLike(child)) return false;
    if (!isRequestAnimationFrameCall(child)) return;
    const scheduledArgument = child.arguments?.[0];
    if (!scheduledArgument) return;
    const scheduledFunction = resolveFunctionNode(scheduledArgument);
    if (!scheduledFunction) return;
    const selfNames = collectScheduledSelfNames(scheduledArgument, scheduledFunction);
    if (doesSubtreeRescheduleAnyName(scheduledFunction, selfNames)) {
      foundLoops.push({ rafCall: child, scheduledFunction });
    }
  });
  return foundLoops;
};

const memberChainBaseIdentifierName = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode = node;
  while (isNodeOfType(cursor, "MemberExpression")) cursor = cursor.object as EsTreeNode;
  return isNodeOfType(cursor, "Identifier") ? cursor.name : null;
};

const serializeHandleKey = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (binding?.initializer) {
      const initializerKey = serializeHandleKey(binding.initializer);
      if (initializerKey && initializerKey !== expression.name) return initializerKey;
    }
    return expression.name;
  }
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiverKey = serializeHandleKey(expression.object);
  const propertyName = getStaticPropertyName(expression);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};

const storedHandleKeyForCall = (call: EsTreeNodeOfType<"CallExpression">): string | null => {
  const expressionRoot = findTransparentExpressionRoot(call);
  const parent = expressionRoot.parent;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.right === expressionRoot) {
    return serializeHandleKey(parent.left as EsTreeNode);
  }
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expressionRoot &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const collectLoopSchedulingCalls = (
  rafLoop: SelfReschedulingRafLoop,
): EsTreeNodeOfType<"CallExpression">[] => {
  const initialArgument = rafLoop.rafCall.arguments?.[0];
  if (!initialArgument) return [];
  const selfNames = collectScheduledSelfNames(initialArgument, rafLoop.scheduledFunction);
  const calls = [rafLoop.rafCall];
  walkAst(rafLoop.scheduledFunction, (child: EsTreeNode) => {
    if (!isRequestAnimationFrameCall(child)) return;
    const scheduledArgument = child.arguments?.[0];
    const expression = scheduledArgument ? stripParenExpression(scheduledArgument) : null;
    if (expression && isNodeOfType(expression, "Identifier") && selfNames.has(expression.name)) {
      calls.push(child);
    }
  });
  return calls;
};

const cancellableHandleKey = (rafLoop: SelfReschedulingRafLoop): string | null => {
  const handleKeys = collectLoopSchedulingCalls(rafLoop).map(storedHandleKeyForCall);
  const firstHandleKey = handleKeys[0];
  return firstHandleKey && handleKeys.every((handleKey) => handleKey === firstHandleKey)
    ? firstHandleKey
    : null;
};

const cleanupCancelsHandle = (cleanupFunction: EsTreeNode, handleKey: string): boolean => {
  let didCancel = false;
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    if (didCancel) return false;
    if (child !== cleanupFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression") || !isCancelAnimationFrameCall(child)) {
      return;
    }
    const argument = child.arguments?.[0];
    if (argument && serializeHandleKey(argument) === handleKey) {
      didCancel = true;
      return false;
    }
  });
  return didCancel;
};

const isCancelAnimationFrameCall = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (isGlobalFrameMethodCall(call, CANCEL_ANIMATION_FRAME_NAME)) return true;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  const bindingIdentifier = binding?.bindingIdentifier;
  const property = bindingIdentifier?.parent;
  if (!isNodeOfType(property, "Property")) return false;
  const propertyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
      ? property.key.value
      : null;
  if (propertyName !== CANCEL_ANIMATION_FRAME_NAME) return false;
  const pattern = property.parent;
  const declarator = pattern?.parent;
  if (!isNodeOfType(pattern, "ObjectPattern") || !isNodeOfType(declarator, "VariableDeclarator")) {
    return false;
  }
  const initializer = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  return (
    isNodeOfType(initializer, "Identifier") &&
    GLOBAL_FRAME_RECEIVER_NAMES.has(initializer.name) &&
    !findVariableInitializer(initializer, initializer.name)
  );
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
      const referenceKey = serializeHandleKey(writeTarget as EsTreeNode);
      if (referenceKey) writtenNames.add(referenceKey);
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
    if (guardTest) {
      walkAst(guardTest, (guardChild: EsTreeNode) => {
        if (didFindGuard) return false;
        if (
          (isNodeOfType(guardChild, "Identifier") ||
            isNodeOfType(guardChild, "MemberExpression")) &&
          guardNames.has(serializeHandleKey(guardChild) ?? "")
        ) {
          didFindGuard = true;
          return false;
        }
      });
      if (didFindGuard) return false;
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

const isNumericBoundTest = (test: EsTreeNode, writtenNames: ReadonlySet<string>): boolean => {
  const stripped = stripParenExpression(test);
  if (isNodeOfType(stripped, "LogicalExpression") && stripped.operator !== "??") {
    return (
      isNumericBoundTest(stripped.left, writtenNames) &&
      isNumericBoundTest(stripped.right, writtenNames)
    );
  }
  if (!isNodeOfType(stripped, "BinaryExpression")) return false;
  if (!RELATIONAL_BOUND_OPERATORS.has(stripped.operator)) return false;
  const variableSide =
    isNodeOfType(stripped.right, "Literal") && typeof stripped.right.value === "number"
      ? stripped.left
      : isNodeOfType(stripped.left, "Literal") && typeof stripped.left.value === "number"
        ? stripped.right
        : null;
  return Boolean(variableSide && subtreeReferencesIdentifierName(variableSide, writtenNames));
};

const everyRescheduleIsProgressBounded = (scheduledFunction: EsTreeNode): boolean => {
  const writtenNames = new Set<string>();
  collectWrittenNames(scheduledFunction, writtenNames);
  if (isFunctionLike(scheduledFunction)) {
    for (const parameter of scheduledFunction.params ?? []) {
      if (isNodeOfType(parameter, "Identifier")) writtenNames.add(parameter.name);
    }
  }
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    walkAst(scheduledFunction, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
      if (!isNodeOfType(child.id, "Identifier") || writtenNames.has(child.id.name)) return;
      if (subtreeReferencesIdentifierName(child.init as EsTreeNode, writtenNames)) {
        writtenNames.add(child.id.name);
        didGrow = true;
      }
    });
  }
  if (writtenNames.size === 0) return false;
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
        isNumericBoundTest(cursor.test as EsTreeNode, writtenNames)
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
      if (!isProvenEffectHookCall(node, context.scopes)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const cleanupFunctions = collectReturnedCleanupFunctions(callback);
      for (const rafLoop of findSelfReschedulingRafLoops(callback)) {
        if (everyRescheduleIsProgressBounded(rafLoop.scheduledFunction)) continue;
        const handleKey = cancellableHandleKey(rafLoop);
        if (
          handleKey &&
          cleanupFunctions.some((cleanupFunction) =>
            cleanupCancelsHandle(cleanupFunction, handleKey),
          )
        ) {
          continue;
        }
        const hasCleanupGuard = cleanupFunctions.some((cleanupFunction) => {
          const cleanupWrittenNames = collectCleanupWrittenNames(cleanupFunction, callback);
          return doesLoopGuardOnAnyName(rafLoop.scheduledFunction, cleanupWrittenNames);
        });
        if (hasCleanupGuard) continue;
        context.report({
          node: rafLoop.rafCall,
          message:
            "This requestAnimationFrame loop reschedules itself every frame but is never cancelled, so it keeps running after unmount; store every frame id in one handle and cancel that handle from the returned effect cleanup.",
        });
      }
    },
  }),
});
