import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Coercing an input's value with this parse stores `0` for a cleared field and `NaN` for partial input, which then flows into state or a request body; guard the empty and NaN cases (for example `value ? Number(value) : undefined`) before using it.";

const EVENT_VALUE_PROPERTIES: ReadonlySet<string> = new Set([
  "value",
  "valueAsNumber",
]);
const EVENT_TARGET_PROPERTIES: ReadonlySet<string> = new Set([
  "target",
  "currentTarget",
]);
const HANDLER_ATTRIBUTE_PATTERN = /^on[A-Z]/;

const isNumericParseCallee = (callee: EsTreeNode): boolean => {
  if (
    isNodeOfType(callee, "Identifier") &&
    (callee.name === "Number" ||
      callee.name === "parseInt" ||
      callee.name === "parseFloat")
  ) {
    return true;
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier") &&
    (callee.property.name === "parseInt" ||
      callee.property.name === "parseFloat")
  );
};

// A radix-less `parseInt(x)` / `Number.parseInt(x)` is already owned by
// `no-parseint-without-radix` (which fires on exactly one non-spread
// argument), so reporting it here too would double-warn the same call.
// Defer to that rule and keep this rule's niche: `Number(...)`,
// `parseFloat(...)`, and radix-carrying `parseInt(x, 10)`.
const isRadixlessParseInt = (
  callee: EsTreeNode,
  argumentList: readonly EsTreeNode[]
): boolean => {
  if (
    argumentList.length !== 1 ||
    isNodeOfType(argumentList[0] as EsTreeNode, "SpreadElement")
  ) {
    return false;
  }
  if (isNodeOfType(callee, "Identifier")) return callee.name === "parseInt";
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "parseInt"
  );
};

// Returns the root identifier name (the event parameter, e.g. `e`) when
// `argument` is an event-input value read: `e.target.value`,
// `e.currentTarget.value`, `e.target.valueAsNumber`. Otherwise null.
const getEventValueRootName = (argument: EsTreeNode): string | null => {
  const valueAccess = stripParenExpression(argument);
  if (
    !isNodeOfType(valueAccess, "MemberExpression") ||
    valueAccess.computed ||
    !isNodeOfType(valueAccess.property, "Identifier") ||
    !EVENT_VALUE_PROPERTIES.has(valueAccess.property.name)
  ) {
    return null;
  }
  const targetAccess = stripParenExpression(valueAccess.object);
  if (
    !isNodeOfType(targetAccess, "MemberExpression") ||
    targetAccess.computed ||
    !isNodeOfType(targetAccess.property, "Identifier") ||
    !EVENT_TARGET_PROPERTIES.has(targetAccess.property.name)
  ) {
    return null;
  }
  const root = stripParenExpression(targetAccess.object);
  return isNodeOfType(root, "Identifier") ? root.name : null;
};

interface HandlerLookup {
  handler: EsTreeNode | null;
  isGuarded: boolean;
}

// Walk from the call up to the nearest enclosing function, recording
// whether a guard (`?:` ternary or `||`/`??` fallback) sits between them.
// That nearest function is the handler candidate.
const findEnclosingHandlerAndGuard = (call: EsTreeNode): HandlerLookup => {
  let ancestor = call.parent;
  let isGuarded = false;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return { handler: ancestor, isGuarded };
    if (isNodeOfType(ancestor, "ConditionalExpression")) isGuarded = true;
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      (ancestor.operator === "||" || ancestor.operator === "??")
    ) {
      isGuarded = true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return { handler: null, isGuarded };
};

const firstParameterName = (handler: EsTreeNode): string | null => {
  const params =
    (handler as EsTreeNodeOfType<"ArrowFunctionExpression">).params ?? [];
  const first = params[0];
  return first && isNodeOfType(first, "Identifier") ? first.name : null;
};

// True only when the inline handler is bound to an `onX` attribute of an
// intrinsic `<input>` element. A `<select>`, `<textarea>`, or a component
// (`<TextField>`, MUI pagination props) cannot be resolved to a free-text
// input, so we bail — a false negative over a false positive.
const isInputElementHandler = (handler: EsTreeNode): boolean => {
  const container = handler.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer"))
    return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  if (
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !HANDLER_ATTRIBUTE_PATTERN.test(attribute.name.name)
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement"))
    return false;
  return (
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    openingElement.name.name === "input"
  );
};

export const noUnguardedNumericInputParse = defineRule({
  id: "no-unguarded-numeric-input-parse",
  title: "Unguarded numeric parse of an input value",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Guard `Number(e.target.value)` / `parseInt(e.target.value)` against empty and NaN before storing it. `Number('')` is `0` and `Number('abc')` is `NaN`, both of which silently ship a wrong value.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNumericParseCallee(node.callee as EsTreeNode)) return;
      const argumentList = (node.arguments ?? []) as EsTreeNode[];
      if (isRadixlessParseInt(node.callee as EsTreeNode, argumentList)) return;
      const firstArgument = argumentList[0];
      if (!firstArgument) return;
      const rootName = getEventValueRootName(firstArgument);
      if (!rootName) return;

      const { handler, isGuarded } = findEnclosingHandlerAndGuard(
        node as EsTreeNode
      );
      if (isGuarded || !handler) return;
      if (firstParameterName(handler) !== rootName) return;
      if (!isInputElementHandler(handler)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
