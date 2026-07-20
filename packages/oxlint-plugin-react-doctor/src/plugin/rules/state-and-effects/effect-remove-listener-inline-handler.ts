import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { serializeEventKey } from "../../utils/serialize-event-key.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { serializeReferenceKey } from "../../utils/serialize-reference-key.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

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
    isNodeOfType(handler.callee, "MemberExpression") &&
    getStaticPropertyName(handler.callee) === "bind"
  );
};

const EVENT_REGISTRATION_METHOD_NAMES = new Set(["addEventListener", "addListener", "on", "once"]);
const HANDLER_ONLY_EVENT_KEY = "handler-only";

const collectRegistrationKeys = (program: EsTreeNode, scopes: ScopeAnalysis): Set<string> => {
  const registrationKeys = new Set<string>();
  walkAst(program, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    if (!methodName || !EVENT_REGISTRATION_METHOD_NAMES.has(methodName)) return;
    const receiverKey = serializeReferenceKey({ node: callee.object, scopes });
    const eventKey =
      methodName === "addListener" && node.arguments.length === 1
        ? HANDLER_ONLY_EVENT_KEY
        : serializeEventKey(node.arguments?.[0], scopes);
    if (receiverKey && eventKey) registrationKeys.add(JSON.stringify([receiverKey, eventKey]));
  });
  return registrationKeys;
};

export const effectRemoveListenerInlineHandler = defineRule({
  id: "effect-remove-listener-inline-handler",
  title: "removeEventListener called with a fresh inline handler",
  severity: "error",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Removal APIs match the listener by reference equality, so a fresh inline arrow, function expression, or `.bind(...)` result can never equal the registered handler; hoist the handler into a named const and pass that same reference to both the add and remove calls.",
  create: (context: RuleContext) => {
    const registrationKeysByProgram = new WeakMap<EsTreeNode, Set<string>>();
    return {
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
        const receiverKey = serializeReferenceKey({
          node: callee.object,
          scopes: context.scopes,
        });
        const eventKey =
          methodName === "removeListener" && args.length === 1
            ? HANDLER_ONLY_EVENT_KEY
            : serializeEventKey(args[0], context.scopes);
        const program = findProgramRoot(node);
        if (!receiverKey || !eventKey || !program) return;
        let registrationKeys = registrationKeysByProgram.get(program);
        if (!registrationKeys) {
          registrationKeys = collectRegistrationKeys(program, context.scopes);
          registrationKeysByProgram.set(program, registrationKeys);
        }
        if (!registrationKeys.has(JSON.stringify([receiverKey, eventKey]))) {
          return;
        }

        context.report({
          node: handlerArgument,
          message: `\`${methodName}\` gets a brand-new function reference here that never equals the registered listener, so this removal silently no-ops; pass the same named handler to both the add and remove calls.`,
        });
      },
    };
  },
});
