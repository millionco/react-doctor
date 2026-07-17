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
import { walkAst } from "../../utils/walk-ast.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REQUEST_ANIMATION_FRAME_NAME = "requestAnimationFrame";
const CANCEL_ANIMATION_FRAME_NAME = "cancelAnimationFrame";
const COLLECTION_VALUES_HANDLE_PREFIX = "collection-values:";
const MONOTONIC_MATH_METHOD_NAMES = new Set(["min", "max"]);

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
  walkSynchronousCallbackFlow(effectCallback, (child: EsTreeNode) => {
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
  if (isNodeOfType(parent, "CallExpression") && isNodeOfType(parent.callee, "MemberExpression")) {
    const storageMethodName = getStaticPropertyName(parent.callee);
    const argumentIndex =
      parent.arguments?.findIndex((argument) => argument === expressionRoot) ?? -1;
    const storesCollectionValue =
      (storageMethodName === "set" && argumentIndex > 0) ||
      ((storageMethodName === "push" || storageMethodName === "unshift") && argumentIndex >= 0);
    const collectionKey = storesCollectionValue
      ? serializeHandleKey(parent.callee.object as EsTreeNode)
      : null;
    if (collectionKey) return `${COLLECTION_VALUES_HANDLE_PREFIX}${collectionKey}`;
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

const cleanupCancelsCollectionValues = (
  cleanupFunction: EsTreeNode,
  collectionKey: string,
): boolean => {
  let didCancel = false;
  walkSynchronousCallbackFlow(cleanupFunction, (child: EsTreeNode) => {
    if (didCancel || !isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      getStaticPropertyName(callee) !== "forEach" ||
      serializeHandleKey(callee.object as EsTreeNode) !== collectionKey
    ) {
      return;
    }
    const callbackArgument = child.arguments?.[0];
    const callback =
      callbackArgument && !isNodeOfType(callbackArgument, "SpreadElement")
        ? resolveFunctionNode(callbackArgument)
        : null;
    if (!isFunctionLike(callback)) return;
    const valueParameter = callback.params?.[0];
    if (!isNodeOfType(valueParameter, "Identifier")) return;
    walkAst(callback, (callbackChild: EsTreeNode) => {
      if (didCancel) return false;
      if (callbackChild !== callback && isFunctionLike(callbackChild)) return false;
      if (!isNodeOfType(callbackChild, "CallExpression")) return;
      const argument = callbackChild.arguments?.[0];
      if (
        isCancelAnimationFrameCall(callbackChild) &&
        isNodeOfType(argument, "Identifier") &&
        argument.name === valueParameter.name
      ) {
        didCancel = true;
        return false;
      }
    });
  });
  return didCancel;
};

const cleanupCancelsHandle = (cleanupFunction: EsTreeNode, handleKey: string): boolean => {
  if (handleKey.startsWith(COLLECTION_VALUES_HANDLE_PREFIX)) {
    return cleanupCancelsCollectionValues(
      cleanupFunction,
      handleKey.slice(COLLECTION_VALUES_HANDLE_PREFIX.length),
    );
  }
  let didCancel = false;
  walkSynchronousCallbackFlow(cleanupFunction, (child: EsTreeNode) => {
    if (didCancel) return;
    if (!isNodeOfType(child, "CallExpression") || !isCancelAnimationFrameCall(child)) {
      return;
    }
    const argument = child.arguments?.[0];
    if (argument && serializeHandleKey(argument) === handleKey) {
      didCancel = true;
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

const isMonotonicIdentifierWrite = (
  write: EsTreeNode,
  identifierName: string,
  isIncreasing: boolean,
): boolean => {
  if (isNodeOfType(write, "UpdateExpression")) {
    return write.operator === (isIncreasing ? "++" : "--");
  }
  if (!isNodeOfType(write, "AssignmentExpression")) return false;
  if (write.operator === (isIncreasing ? "+=" : "-=")) {
    return isPositiveNumericLiteral(write.right);
  }
  if (write.operator !== "=") return false;
  const value = stripParenExpression(write.right);
  const leftOperand = isNodeOfType(value, "BinaryExpression")
    ? stripParenExpression(value.left)
    : null;
  return (
    isNodeOfType(value, "BinaryExpression") &&
    value.operator === (isIncreasing ? "+" : "-") &&
    isNodeOfType(leftOperand, "Identifier") &&
    leftOperand.name === identifierName &&
    isPositiveNumericLiteral(value.right)
  );
};

const collectMonotonicMutationNames = (root: EsTreeNode, isIncreasing: boolean): Set<string> => {
  const monotonicNames = new Set<string>();
  const nonMonotonicNames = new Set<string>();
  walkAst(root, (child: EsTreeNode) => {
    const writeTarget = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression")
        ? child.argument
        : null;
    if (!isNodeOfType(writeTarget, "Identifier")) return;
    if (isMonotonicIdentifierWrite(child, writeTarget.name, isIncreasing)) {
      monotonicNames.add(writeTarget.name);
    } else {
      nonMonotonicNames.add(writeTarget.name);
    }
  });
  for (const nonMonotonicName of nonMonotonicNames) monotonicNames.delete(nonMonotonicName);
  return monotonicNames;
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
      const calleeKey = serializeHandleKey(callee);
      if (!calleeKey) return;
      if (getStaticPropertyName(callee) === "abort") {
        const receiverKey = serializeHandleKey(callee.object as EsTreeNode);
        if (receiverKey) writtenNames.add(`${receiverKey}.signal.aborted`);
      }
      // `stopRef.current()` — merge the writes of the function assigned to
      // `stopRef.current` inside the effect.
      walkAst(effectCallback, (candidate: EsTreeNode) => {
        if (
          isNodeOfType(candidate, "AssignmentExpression") &&
          isNodeOfType(candidate.left, "MemberExpression") &&
          serializeHandleKey(candidate.left as EsTreeNode) === calleeKey &&
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
        if (isNodeOfType(guardChild, "MemberExpression")) {
          if (guardNames.has(serializeHandleKey(guardChild) ?? "")) didFindGuard = true;
          return false;
        }
        if (isNodeOfType(guardChild, "Identifier") && guardNames.has(guardChild.name)) {
          didFindGuard = true;
          return false;
        }
      });
      if (didFindGuard) return false;
    }
  });
  return didFindGuard;
};

const isPositiveNumericLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number" && node.value > 0;

const isStableNumericOffset = (
  expression: EsTreeNode,
  mutatedNames: ReadonlySet<string>,
): boolean => {
  const node = stripParenExpression(expression);
  return (
    (isNodeOfType(node, "Literal") && typeof node.value === "number") ||
    (isNodeOfType(node, "Identifier") && !mutatedNames.has(node.name))
  );
};

const isMonotonicExpression = (
  expression: EsTreeNode,
  monotonicNames: ReadonlySet<string>,
  mutatedNames: ReadonlySet<string>,
): boolean => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Identifier")) return monotonicNames.has(node.name);
  if (isNodeOfType(node, "BinaryExpression")) {
    if (node.operator === "+" || node.operator === "-") {
      return (
        isMonotonicExpression(node.left, monotonicNames, mutatedNames) &&
        isStableNumericOffset(node.right, mutatedNames)
      );
    }
    if (node.operator === "*" || node.operator === "/") {
      return (
        isMonotonicExpression(node.left, monotonicNames, mutatedNames) &&
        isPositiveNumericLiteral(node.right)
      );
    }
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  const calleeObject = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : null;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(calleeObject, "Identifier") ||
    calleeObject.name !== "Math" ||
    !MONOTONIC_MATH_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
  ) {
    return false;
  }
  let didFindMonotonicArgument = false;
  for (const argument of node.arguments) {
    if (isMonotonicExpression(argument, monotonicNames, mutatedNames)) {
      didFindMonotonicArgument = true;
      continue;
    }
    if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "number") return false;
  }
  return didFindMonotonicArgument;
};

const isNumericProgressBoundTest = (
  test: EsTreeNode,
  increasingNames: ReadonlySet<string>,
  decreasingNames: ReadonlySet<string>,
  mutatedNames: ReadonlySet<string>,
): boolean => {
  const stripped = stripParenExpression(test);
  if (isNodeOfType(stripped, "LogicalExpression") && stripped.operator !== "??") {
    return (
      isNumericProgressBoundTest(stripped.left, increasingNames, decreasingNames, mutatedNames) &&
      isNumericProgressBoundTest(stripped.right, increasingNames, decreasingNames, mutatedNames)
    );
  }
  if (!isNodeOfType(stripped, "BinaryExpression")) return false;
  const leftIsProgressExpression =
    isMonotonicExpression(stripped.left, increasingNames, mutatedNames) &&
    isNodeOfType(stripped.right, "Literal") &&
    typeof stripped.right.value === "number";
  const rightIsProgressExpression =
    isNodeOfType(stripped.left, "Literal") &&
    typeof stripped.left.value === "number" &&
    isMonotonicExpression(stripped.right, increasingNames, mutatedNames);
  if (
    ((stripped.operator === "<" || stripped.operator === "<=") && leftIsProgressExpression) ||
    ((stripped.operator === ">" || stripped.operator === ">=") && rightIsProgressExpression)
  ) {
    return true;
  }
  const leftIsCountdownExpression =
    isMonotonicExpression(stripped.left, decreasingNames, mutatedNames) &&
    isNodeOfType(stripped.right, "Literal") &&
    typeof stripped.right.value === "number";
  const rightIsCountdownExpression =
    isNodeOfType(stripped.left, "Literal") &&
    typeof stripped.left.value === "number" &&
    isMonotonicExpression(stripped.right, decreasingNames, mutatedNames);
  return (
    ((stripped.operator === ">" || stripped.operator === ">=") && leftIsCountdownExpression) ||
    ((stripped.operator === "<" || stripped.operator === "<=") && rightIsCountdownExpression)
  );
};

const everyRescheduleIsProgressBounded = (scheduledFunction: EsTreeNode): boolean => {
  const mutatedNames = new Set<string>();
  collectWrittenNames(scheduledFunction, mutatedNames);
  const increasingNames = collectMonotonicMutationNames(scheduledFunction, true);
  const decreasingNames = collectMonotonicMutationNames(scheduledFunction, false);
  if (isFunctionLike(scheduledFunction)) {
    for (const parameter of scheduledFunction.params ?? []) {
      if (isNodeOfType(parameter, "Identifier") && !mutatedNames.has(parameter.name)) {
        increasingNames.add(parameter.name);
      }
    }
  }
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    walkAst(scheduledFunction, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
      if (
        !isNodeOfType(child.id, "Identifier") ||
        increasingNames.has(child.id.name) ||
        decreasingNames.has(child.id.name) ||
        mutatedNames.has(child.id.name)
      ) {
        return;
      }
      if (isMonotonicExpression(child.init as EsTreeNode, increasingNames, mutatedNames)) {
        increasingNames.add(child.id.name);
        didGrow = true;
      } else if (isMonotonicExpression(child.init as EsTreeNode, decreasingNames, mutatedNames)) {
        decreasingNames.add(child.id.name);
        didGrow = true;
      }
    });
  }
  if (increasingNames.size === 0 && decreasingNames.size === 0) return false;
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
        isNumericProgressBoundTest(
          cursor.test as EsTreeNode,
          increasingNames,
          decreasingNames,
          mutatedNames,
        )
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
