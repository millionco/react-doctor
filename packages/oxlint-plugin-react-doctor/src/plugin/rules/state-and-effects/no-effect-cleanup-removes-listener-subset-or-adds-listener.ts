import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REGISTER_EVENT_METHOD_NAMES = new Set(["on", "addEventListener", "addListener"]);
const CLEANUP_ADD_METHOD_NAMES = new Set(["addEventListener", "observe"]);
const NAMED_REMOVAL_METHOD_NAMES = new Set([
  "off",
  "removeEventListener",
  "removeListener",
  "unsubscribe",
]);
const BULK_REMOVAL_METHOD_NAMES = new Set(["removeAllListeners", "removeAll"]);
// Methods whose first argument is the event/topic string (rest is handler).
const EVENT_KEYED_METHOD_NAMES = new Set([
  "on",
  "addEventListener",
  "addListener",
  "off",
  "removeEventListener",
  "removeListener",
]);
// Fluent emitter APIs return `this`, so `.on(...)/.off(...)` chains share
// one receiver.
const CHAINABLE_LISTENER_METHOD_NAMES = new Set([
  ...REGISTER_EVENT_METHOD_NAMES,
  ...NAMED_REMOVAL_METHOD_NAMES,
]);

interface ListenerCall {
  method: string;
  receiverKey: string;
  event: string | null;
  handlerKey: string | null;
  node: EsTreeNode;
}

interface CleanupSearch {
  cleanupFunction: EsTreeNode | null;
  hasConditionalCleanupBranches: boolean;
}

const serializeNode = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "ThisExpression")) return "this";
  if (isNodeOfType(node, "MemberExpression") && !node.computed) {
    const object = serializeNode(node.object);
    if (object === null || !isNodeOfType(node.property, "Identifier")) return null;
    return `${object}.${node.property.name}`;
  }
  return null;
};

const getStringLiteralValue = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const stripped = stripParenExpression(node);
  return isNodeOfType(stripped, "Literal") && typeof stripped.value === "string"
    ? stripped.value
    : null;
};

const resolveChainedReceiver = (node: EsTreeNode): EsTreeNode => {
  let receiver = stripParenExpression(node);
  while (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    !receiver.callee.computed &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    CHAINABLE_LISTENER_METHOD_NAMES.has(receiver.callee.property.name)
  ) {
    receiver = stripParenExpression(receiver.callee.object);
  }
  return receiver;
};

const readListenerCall = (node: EsTreeNode): ListenerCall | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const method = callee.property.name;
  const receiverKey = serializeNode(resolveChainedReceiver(callee.object));
  if (receiverKey === null) return null;
  const args = node.arguments ?? [];
  let event: string | null = null;
  let handlerKey: string | null = null;
  if (EVENT_KEYED_METHOD_NAMES.has(method)) {
    const leadingEvent = getStringLiteralValue(args[0]);
    if (leadingEvent !== null) {
      event = leadingEvent;
      handlerKey = serializeNode(args[1]);
    } else {
      handlerKey = serializeNode(args[0]);
    }
  } else {
    handlerKey = serializeNode(args[0]);
  }
  return { method, receiverKey, event, handlerKey, node };
};

const subtreeContainsNode = (root: EsTreeNode, target: EsTreeNode): boolean => {
  let didFindTarget = false;
  walkAst(root, (child: EsTreeNode) => {
    if (didFindTarget) return false;
    if (child === target) {
      didFindTarget = true;
      return false;
    }
  });
  return didFindTarget;
};

const resolveReturnedFunction = (
  returned: EsTreeNode,
  effectCallback: EsTreeNode,
): EsTreeNode | null => {
  if (isFunctionLike(returned)) return returned;
  if (!isNodeOfType(returned, "Identifier")) return null;
  let resolved: EsTreeNode | null = null;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (resolved) return false;
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.id &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === returned.name
    ) {
      resolved = child;
      return false;
    }
    if (child !== effectCallback && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === returned.name &&
      child.init
    ) {
      const initializer = stripParenExpression(child.init);
      if (isFunctionLike(initializer)) resolved = initializer;
    }
  });
  return resolved;
};

const findCleanupFunction = (effectCallback: EsTreeNode): CleanupSearch => {
  if (isFunctionLike(effectCallback) && !isNodeOfType(effectCallback.body, "BlockStatement")) {
    const concise = stripParenExpression(effectCallback.body);
    return {
      cleanupFunction: isFunctionLike(concise) ? concise : null,
      hasConditionalCleanupBranches: false,
    };
  }
  const returnedCleanups = new Set<EsTreeNode>();
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (child !== effectCallback && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      const resolved = resolveReturnedFunction(
        stripParenExpression(child.argument),
        effectCallback,
      );
      if (resolved) returnedCleanups.add(resolved);
    }
  });
  const [onlyCleanup] = returnedCleanups;
  return {
    cleanupFunction: returnedCleanups.size === 1 ? onlyCleanup : null,
    hasConditionalCleanupBranches: returnedCleanups.size > 1,
  };
};

// Registrations inside an if/try branch the returned cleanup does not
// share are fallback/one-time setups, not symmetric subscriptions.
const collectBranchesWithoutCleanup = (
  effectCallback: EsTreeNode,
  cleanupFunction: EsTreeNode,
): Set<EsTreeNode> => {
  const branchesWithoutCleanup = new Set<EsTreeNode>();
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (child !== effectCallback && isFunctionLike(child)) return false;
    const branchNodes: (EsTreeNode | null | undefined)[] = isNodeOfType(child, "IfStatement")
      ? [child.consequent, child.alternate]
      : isNodeOfType(child, "TryStatement")
        ? [child.block, child.handler, child.finalizer]
        : [];
    for (const branchNode of branchNodes) {
      if (branchNode && !subtreeContainsNode(branchNode, cleanupFunction)) {
        branchesWithoutCleanup.add(branchNode);
      }
    }
  });
  return branchesWithoutCleanup;
};

const removalCoversRegistration = (removal: ListenerCall, registration: ListenerCall): boolean => {
  if (removal.receiverKey !== registration.receiverKey) return false;
  if (
    removal.event !== null &&
    removal.handlerKey !== null &&
    removal.event === registration.event &&
    removal.handlerKey === registration.handlerKey
  ) {
    return true;
  }
  // A handler-only removal (`emitter.off(handler)`) tears down every event
  // bound to that handler.
  if (removal.event === null && removal.handlerKey !== null) {
    return removal.handlerKey === registration.handlerKey;
  }
  // An event-only removal removes all handlers for that event.
  if (removal.event !== null && removal.handlerKey === null) {
    return removal.event === registration.event;
  }
  return false;
};

export const noEffectCleanupRemovesListenerSubsetOrAddsListener = defineRule({
  id: "no-effect-cleanup-removes-listener-subset-or-adds-listener",
  title: "Effect cleanup misses a listener or re-adds it",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "This effect subscribes to multiple events but its cleanup removes only some of them (or re-adds a listener), so the unremoved handlers accumulate on every re-run. Remove every registered `(emitter, event)` pair in the cleanup, using the same named handler you registered with.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const effectCallback = getEffectCallback(node);
      if (!effectCallback) return;
      const { cleanupFunction, hasConditionalCleanupBranches } =
        findCleanupFunction(effectCallback);
      if (hasConditionalCleanupBranches || !cleanupFunction) return;
      const branchesWithoutCleanup = collectBranchesWithoutCleanup(effectCallback, cleanupFunction);

      const setupCalls: ListenerCall[] = [];
      const disposerNamesByRegistrationNode = new Map<EsTreeNode, string>();
      walkAst(effectCallback, (child: EsTreeNode) => {
        if (child === cleanupFunction) return false;
        if (branchesWithoutCleanup.has(child)) return false;
        if (child !== effectCallback && isFunctionLike(child)) return false;
        if (
          isNodeOfType(child, "VariableDeclarator") &&
          isNodeOfType(child.id, "Identifier") &&
          child.init
        ) {
          const initializerCall = readListenerCall(stripParenExpression(child.init));
          if (initializerCall && REGISTER_EVENT_METHOD_NAMES.has(initializerCall.method)) {
            disposerNamesByRegistrationNode.set(initializerCall.node, child.id.name);
          }
        }
        const listenerCall = readListenerCall(child);
        if (
          listenerCall &&
          (REGISTER_EVENT_METHOD_NAMES.has(listenerCall.method) ||
            CLEANUP_ADD_METHOD_NAMES.has(listenerCall.method))
        ) {
          setupCalls.push(listenerCall);
        }
      });
      if (setupCalls.length === 0) return;

      const namedRemovals: ListenerCall[] = [];
      const cleanupAdds: ListenerCall[] = [];
      const invokedCleanupIdentifierNames = new Set<string>();
      let hasBulkRemoval = false;
      walkAst(cleanupFunction, (child: EsTreeNode) => {
        if (isNodeOfType(child, "CallExpression")) {
          const calleeExpression = stripParenExpression(child.callee);
          if (isNodeOfType(calleeExpression, "Identifier")) {
            invokedCleanupIdentifierNames.add(calleeExpression.name);
          }
        }
        const listenerCall = readListenerCall(child);
        if (!listenerCall) return;
        if (BULK_REMOVAL_METHOD_NAMES.has(listenerCall.method)) {
          hasBulkRemoval = true;
          return;
        }
        if (NAMED_REMOVAL_METHOD_NAMES.has(listenerCall.method)) {
          if (listenerCall.event === null && listenerCall.handlerKey === null) {
            // A bare `emitter.off()` removes every handler.
            hasBulkRemoval = true;
            return;
          }
          namedRemovals.push(listenerCall);
          return;
        }
        if (CLEANUP_ADD_METHOD_NAMES.has(listenerCall.method)) {
          cleanupAdds.push(listenerCall);
        }
      });

      // Subset case: a named removal proves intent, but at least one
      // registered event on the same emitter has no matching removal.
      if (namedRemovals.length > 0 && !hasBulkRemoval) {
        const registrations = setupCalls.filter((call) => {
          if (!REGISTER_EVENT_METHOD_NAMES.has(call.method)) return false;
          const disposerName = disposerNamesByRegistrationNode.get(call.node);
          // `const dispose = api.on(...)` torn down via `dispose()` in the
          // cleanup is a subscribe API returning its own unsubscribe.
          return !(disposerName !== undefined && invokedCleanupIdentifierNames.has(disposerName));
        });
        const uncovered = registrations.find((registration) => {
          const removalsOnReceiver = namedRemovals.filter(
            (removal) => removal.receiverKey === registration.receiverKey,
          );
          if (removalsOnReceiver.length === 0) return false;
          return !removalsOnReceiver.some((removal) =>
            removalCoversRegistration(removal, registration),
          );
        });
        if (uncovered) {
          context.report({
            node: uncovered.node,
            message: `This effect registers "${
              uncovered.event ?? uncovered.method
            }" on the same emitter that the cleanup tears down, but the cleanup never removes it, so this handler accumulates on every re-run. Remove every event you register in the cleanup.`,
          });
          return;
        }
      }

      // Add-variant: the cleanup mirrors a setup registration with the ADD
      // API and never removes it.
      const mirroredAdd = cleanupAdds.find((add) => {
        const mirrorsSetup = setupCalls.some(
          (setupCall) =>
            setupCall.method === add.method &&
            setupCall.receiverKey === add.receiverKey &&
            setupCall.event === add.event &&
            setupCall.handlerKey === add.handlerKey,
        );
        if (!mirrorsSetup) return false;
        const hasRemoval = namedRemovals.some(
          (removal) =>
            removal.receiverKey === add.receiverKey &&
            (removal.event === add.event ||
              removal.event === null ||
              removal.handlerKey === add.handlerKey),
        );
        return !hasRemoval;
      });
      if (mirroredAdd) {
        context.report({
          node: mirroredAdd.node,
          message: `This cleanup calls \`${mirroredAdd.method}\`, mirroring the setup instead of removing the listener, so it re-registers the handler on every teardown. Call the matching remove method instead.`,
        });
      }
    },
  }),
});
