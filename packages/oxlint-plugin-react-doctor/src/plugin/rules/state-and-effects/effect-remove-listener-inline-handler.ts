import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Removal verbs that deregister a listener by reference equality on the
// handler argument. Excludes `addEventListener` on purpose — a fresh
// literal is only a bug on the REMOVE side. Excludes `unsubscribe`
// because APIs like MQTT.js use `unsubscribe(topic, completionCallback)`,
// where an inline second argument is idiomatic and not a leak.
const REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES = new Set([
  "removeEventListener",
  "removeListener",
  "off",
]);

// `light.off(FADE_DURATION_MS, completionCallback)` — a numeric first
// argument means this `off` is a device/animation API (duration +
// completion callback), not an event-emitter deregistration.
const NUMERIC_ARGUMENT_NAME_PATTERN = /(?:duration|delay|timeout|ms)$/i;

const isNumericFirstArgument = (argument: EsTreeNode): boolean => {
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "Literal") && typeof inner.value === "number") return true;
  if (!isNodeOfType(inner, "Identifier")) return false;
  if (NUMERIC_ARGUMENT_NAME_PATTERN.test(inner.name)) return true;
  const binding = findVariableInitializer(inner, inner.name);
  if (!binding?.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  return isNodeOfType(initializer, "Literal") && typeof initializer.value === "number";
};

const isFreshFunctionReference = (node: EsTreeNode): boolean => {
  const handler = stripParenExpression(node);
  if (isInlineFunctionExpression(handler)) return true;
  return (
    isNodeOfType(handler, "CallExpression") &&
    isMemberProperty(handler.callee, "bind") &&
    !handler.callee.computed
  );
};

const serializeReferenceKey = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) return expression.name;
  if (isNodeOfType(expression, "ThisExpression")) return "this";
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiverKey = serializeReferenceKey(expression.object);
  const propertyName = getStaticPropertyName(expression);
  return receiverKey && propertyName ? `${receiverKey}.${propertyName}` : null;
};

const serializeEventKey = (node: EsTreeNode | undefined): string | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return `literal:${expression.value}`;
  }
  const referenceKey = serializeReferenceKey(expression);
  return referenceKey ? `reference:${referenceKey}` : null;
};

const hasMatchingOnRegistration = (
  removalCall: EsTreeNodeOfType<"CallExpression">,
  receiverKey: string,
  eventKey: string,
): boolean => {
  let searchRoot: EsTreeNode | null | undefined = removalCall.parent;
  while (searchRoot && searchRoot.parent && !isNodeOfType(searchRoot, "Program")) {
    searchRoot = searchRoot.parent;
  }
  if (!searchRoot) return false;
  let didFindRegistration = false;
  walkAst(searchRoot, (node: EsTreeNode) => {
    if (didFindRegistration) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    if (getStaticPropertyName(callee) !== "on") return;
    if (serializeReferenceKey(callee.object) !== receiverKey) return;
    if (serializeEventKey(node.arguments?.[0]) !== eventKey) return;
    didFindRegistration = true;
    return false;
  });
  return didFindRegistration;
};

export const effectRemoveListenerInlineHandler = defineRule({
  id: "effect-remove-listener-inline-handler",
  title: "removeEventListener called with a fresh inline handler",
  severity: "error",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Removal APIs match the listener by reference equality, so a fresh inline arrow, function expression, or `.bind(...)` result can never equal the registered handler; hoist the handler into a named const and pass that same reference to both the add and remove calls.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const methodName = getStaticPropertyName(callee);
      if (!methodName || !REFERENCE_EQUALITY_REMOVAL_METHOD_NAMES.has(methodName)) return;

      const args = node.arguments;
      const handlerIndex = methodName === "removeListener" && args.length === 1 ? 0 : 1;
      const handlerArgument = args[handlerIndex];
      if (!handlerArgument) return;
      if (handlerIndex === 1 && isNumericFirstArgument(args[0] as EsTreeNode)) return;
      if (!isFreshFunctionReference(handlerArgument)) return;
      if (methodName === "off") {
        const receiverKey = serializeReferenceKey(callee.object);
        const eventKey = serializeEventKey(args[0]);
        if (!receiverKey || !eventKey || !hasMatchingOnRegistration(node, receiverKey, eventKey)) {
          return;
        }
      }

      context.report({
        node: handlerArgument,
        message: `\`${methodName}\` gets a brand-new function reference here that never equals the registered listener, so the removal silently no-ops and the listener leaks; pass the same named handler to both the add and remove calls.`,
      });
    },
  }),
});
