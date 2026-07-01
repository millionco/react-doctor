import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface ListenerMethodPairing {
  registerMethod: string;
  handlerArgumentIndex: number;
  requiresEventLiteral: boolean;
}

// Keyed by the RELEASE method name. Handler position and whether a
// leading event/topic string literal must match are per-method: the
// addEventListener/on family takes `(event, handler)` (handler at index
// 1, matching event string required); the subscribe family takes just
// `(handler)` (handler at index 0, no topic to match).
const RELEASE_METHOD_PAIRINGS = new Map<string, ListenerMethodPairing>([
  [
    "removeEventListener",
    {
      registerMethod: "addEventListener",
      handlerArgumentIndex: 1,
      requiresEventLiteral: true,
    },
  ],
  [
    "removeListener",
    {
      registerMethod: "addListener",
      handlerArgumentIndex: 1,
      requiresEventLiteral: true,
    },
  ],
  [
    "off",
    {
      registerMethod: "on",
      handlerArgumentIndex: 1,
      requiresEventLiteral: true,
    },
  ],
  [
    "unsubscribe",
    {
      registerMethod: "subscribe",
      handlerArgumentIndex: 0,
      requiresEventLiteral: false,
    },
  ],
  [
    "unsub",
    {
      registerMethod: "sub",
      handlerArgumentIndex: 0,
      requiresEventLiteral: false,
    },
  ],
  [
    "unwatch",
    {
      registerMethod: "watch",
      handlerArgumentIndex: 0,
      requiresEventLiteral: false,
    },
  ],
  [
    "unlisten",
    {
      registerMethod: "listen",
      handlerArgumentIndex: 0,
      requiresEventLiteral: false,
    },
  ],
]);

const isFunctionLiteral = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const stripped = stripParenExpression(node);
  return (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  );
};

// Purely syntactic receiver key (node text equality, not aliasing
// analysis) so `window`/`window`, `el`/`el`, `this.emitter`/`this.emitter`
// match, and `a`/`b` do not. Returns null for shapes we can't compare.
const serializeReceiver = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "ThisExpression")) return "this";
  if (isNodeOfType(node, "MemberExpression") && !node.computed) {
    const object = serializeReceiver(node.object);
    if (object === null || !isNodeOfType(node.property, "Identifier"))
      return null;
    return `${object}.${node.property.name}`;
  }
  return null;
};

interface ListenerUsage {
  method: string;
  receiverKey: string;
  eventLiteralValue: string | null;
  handlerNode: EsTreeNode;
}

const readMemberCallMethod = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  return callee.property.name;
};

const getEventLiteralValue = (
  node: EsTreeNode | null | undefined
): string | null => {
  if (!node) return null;
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "string") {
    return stripped.value;
  }
  return null;
};

export const effectListenerCleanupReferenceMismatch = defineRule({
  id: "effect-listener-cleanup-reference-mismatch",
  title: "Effect cleanup removes the wrong listener reference",
  severity: "error",
  category: "Bugs",
  recommendation:
    "Removal APIs match by reference identity, so the second inline function passed to the remove call can never equal the one you added; hoist the handler into a single named const (or useCallback) and pass that same reference to both the add and remove calls.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const registerUsages: ListenerUsage[] = [];
      const releaseUsages: ListenerUsage[] = [];

      walkAst(callback, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        const method = readMemberCallMethod(child);
        if (!method) return;
        const callee = child.callee;
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const receiverKey = serializeReceiver(callee.object);
        if (receiverKey === null) return;

        const pairing = RELEASE_METHOD_PAIRINGS.get(method);
        if (pairing) {
          const handlerNode = child.arguments?.[pairing.handlerArgumentIndex];
          if (!isFunctionLiteral(handlerNode)) return;
          releaseUsages.push({
            method,
            receiverKey,
            eventLiteralValue: pairing.requiresEventLiteral
              ? getEventLiteralValue(child.arguments?.[0])
              : null,
            handlerNode,
          });
          return;
        }

        for (const [, candidatePairing] of RELEASE_METHOD_PAIRINGS) {
          if (candidatePairing.registerMethod !== method) continue;
          const handlerNode =
            child.arguments?.[candidatePairing.handlerArgumentIndex];
          if (!isFunctionLiteral(handlerNode)) return;
          registerUsages.push({
            method,
            receiverKey,
            eventLiteralValue: candidatePairing.requiresEventLiteral
              ? getEventLiteralValue(child.arguments?.[0])
              : null,
            handlerNode,
          });
          return;
        }
      });

      for (const releaseUsage of releaseUsages) {
        const pairing = RELEASE_METHOD_PAIRINGS.get(releaseUsage.method);
        if (!pairing) continue;
        const hasMatchingRegister = registerUsages.some((registerUsage) => {
          if (registerUsage.method !== pairing.registerMethod) return false;
          if (registerUsage.receiverKey !== releaseUsage.receiverKey)
            return false;
          if (!pairing.requiresEventLiteral) return true;
          return (
            registerUsage.eventLiteralValue !== null &&
            registerUsage.eventLiteralValue === releaseUsage.eventLiteralValue
          );
        });
        if (!hasMatchingRegister) continue;
        context.report({
          node: releaseUsage.handlerNode,
          message: `Your cleanup calls \`${releaseUsage.method}\` with a brand-new inline function that never equals the handler you added, so the cleanup exists but detaches nothing and the listener leaks; pass one shared named handler to both calls.`,
        });
      }
    },
  }),
});
