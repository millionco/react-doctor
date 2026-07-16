import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface ListenerMethodPairing {
  registerMethod: string;
  requiresEventArgument: boolean;
  allowsHandlerOnlyForm: boolean;
}

// Keyed by the RELEASE method name. The addEventListener/on family takes
// `(event, handler)` (matching event argument required); the subscribe
// family takes just `(handler)`. addListener/removeListener additionally
// accept a handler-only form — the legacy MediaQueryList API and Chrome
// extension events register with `addListener(handler)` alone.
const RELEASE_METHOD_PAIRINGS = new Map<string, ListenerMethodPairing>([
  [
    "removeEventListener",
    {
      registerMethod: "addEventListener",
      requiresEventArgument: true,
      allowsHandlerOnlyForm: false,
    },
  ],
  [
    "removeListener",
    {
      registerMethod: "addListener",
      requiresEventArgument: true,
      allowsHandlerOnlyForm: true,
    },
  ],
  [
    "off",
    {
      registerMethod: "on",
      requiresEventArgument: true,
      allowsHandlerOnlyForm: false,
    },
  ],
  [
    "unsubscribe",
    {
      registerMethod: "subscribe",
      requiresEventArgument: false,
      allowsHandlerOnlyForm: false,
    },
  ],
  [
    "unsub",
    {
      registerMethod: "sub",
      requiresEventArgument: false,
      allowsHandlerOnlyForm: false,
    },
  ],
  [
    "unwatch",
    {
      registerMethod: "watch",
      requiresEventArgument: false,
      allowsHandlerOnlyForm: false,
    },
  ],
  [
    "unlisten",
    {
      registerMethod: "listen",
      requiresEventArgument: false,
      allowsHandlerOnlyForm: false,
    },
  ],
]);

const REGISTER_METHOD_PAIRINGS = new Map<string, ListenerMethodPairing>(
  [...RELEASE_METHOD_PAIRINGS.values()].map((pairing) => [pairing.registerMethod, pairing]),
);

const RELEASE_METHODS_COVERED_BY_INLINE_HANDLER_RULE = new Set([
  "off",
  "removeEventListener",
  "removeListener",
]);

const isFunctionLiteral = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node && isInlineFunctionExpression(stripParenExpression(node)));

// Purely syntactic reference key (node text equality, not aliasing
// analysis) so `window`/`window`, `el`/`el`, `this.emitter`/`this.emitter`
// match, and `a`/`b` do not. Returns null for shapes we can't compare.
const serializeReferenceKey = (node: EsTreeNode): string | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "Identifier")) return unwrappedNode.name;
  if (isNodeOfType(unwrappedNode, "ThisExpression")) return "this";
  if (isNodeOfType(unwrappedNode, "MemberExpression") && !unwrappedNode.computed) {
    const object = serializeReferenceKey(unwrappedNode.object);
    if (object === null || !isNodeOfType(unwrappedNode.property, "Identifier")) return null;
    return `${object}.${unwrappedNode.property.name}`;
  }
  return null;
};

interface ListenerUsage {
  method: string;
  receiverKey: string;
  eventKey: string | null;
  usesHandlerOnlyForm: boolean;
  handlerNode: EsTreeNode;
}

// String literals and expressionless template literals share the `literal:`
// namespace; identifiers and constant member chains (`EVENTS.RESIZE`) get a
// `reference:` key so they only match the identical source expression.
const serializeEventKey = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "string") {
    return `literal:${stripped.value}`;
  }
  if (isNodeOfType(stripped, "TemplateLiteral") && stripped.expressions.length === 0) {
    return `literal:${stripped.quasis[0]?.value.cooked ?? ""}`;
  }
  const referenceKey = serializeReferenceKey(stripped);
  return referenceKey === null ? null : `reference:${referenceKey}`;
};

const readListenerUsage = (
  call: EsTreeNodeOfType<"CallExpression">,
  pairing: ListenerMethodPairing,
  method: string,
  receiverKey: string,
): ListenerUsage | null => {
  if (!pairing.requiresEventArgument) {
    const handlerNode = call.arguments?.[0];
    if (!isFunctionLiteral(handlerNode)) return null;
    return { method, receiverKey, eventKey: null, usesHandlerOnlyForm: false, handlerNode };
  }
  const eventFormHandlerNode = call.arguments?.[1];
  if (isFunctionLiteral(eventFormHandlerNode)) {
    return {
      method,
      receiverKey,
      eventKey: serializeEventKey(call.arguments?.[0]),
      usesHandlerOnlyForm: false,
      handlerNode: eventFormHandlerNode,
    };
  }
  const handlerOnlyNode = call.arguments?.[0];
  if (pairing.allowsHandlerOnlyForm && isFunctionLiteral(handlerOnlyNode)) {
    return {
      method,
      receiverKey,
      eventKey: null,
      usesHandlerOnlyForm: true,
      handlerNode: handlerOnlyNode,
    };
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
        const callee = stripParenExpression(child.callee);
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
        if (!isNodeOfType(callee.property, "Identifier")) return;
        const method = callee.property.name;
        const receiverKey = serializeReferenceKey(callee.object);
        if (receiverKey === null) return;

        const releasePairing = RELEASE_METHOD_PAIRINGS.get(method);
        if (releasePairing) {
          if (RELEASE_METHODS_COVERED_BY_INLINE_HANDLER_RULE.has(method)) return;
          const usage = readListenerUsage(child, releasePairing, method, receiverKey);
          if (usage) releaseUsages.push(usage);
          return;
        }

        const registerPairing = REGISTER_METHOD_PAIRINGS.get(method);
        if (!registerPairing) return;
        const usage = readListenerUsage(child, registerPairing, method, receiverKey);
        if (usage) registerUsages.push(usage);
      });

      for (const releaseUsage of releaseUsages) {
        const pairing = RELEASE_METHOD_PAIRINGS.get(releaseUsage.method);
        if (!pairing) continue;
        const hasMatchingRegister = registerUsages.some((registerUsage) => {
          if (registerUsage.method !== pairing.registerMethod) return false;
          if (registerUsage.receiverKey !== releaseUsage.receiverKey) return false;
          if (registerUsage.usesHandlerOnlyForm !== releaseUsage.usesHandlerOnlyForm) {
            return false;
          }
          if (!pairing.requiresEventArgument || releaseUsage.usesHandlerOnlyForm) return true;
          return (
            registerUsage.eventKey !== null && registerUsage.eventKey === releaseUsage.eventKey
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
