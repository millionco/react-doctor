import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Coercing an input's value with this parse stores `0` for a cleared field and `NaN` for partial input, which then flows into state or a request body; guard the empty and NaN cases (for example `value ? Number(value) : undefined`) before using it.";

const EVENT_VALUE_PROPERTIES: ReadonlySet<string> = new Set(["value", "valueAsNumber"]);
const EVENT_TARGET_PROPERTIES: ReadonlySet<string> = new Set(["target", "currentTarget"]);
const HANDLER_ATTRIBUTE_PATTERN = /^on[A-Z]/;
const NAN_GUARD_FUNCTION_NAMES: ReadonlySet<string> = new Set(["isNaN", "isFinite"]);

// The browser's value-sanitization algorithm guarantees these input types
// never yield a partially-typed string (a range slider is always clamped to
// a valid in-bounds number; radio/checkbox carry a fixed literal value; a
// type="number" field's .value is "" whenever the field holds partial or
// invalid text, so a numeric parse can never see NaN — only the empty->0
// case remains, which real-world code guards downstream), so the harm this
// rule warns about cannot occur on them.
const BROWSER_SANITIZED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "number",
  "range",
  "checkbox",
  "radio",
  "color",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

const isNumericParseCallee = (callee: EsTreeNode): boolean => {
  if (
    isNodeOfType(callee, "Identifier") &&
    (callee.name === "Number" || callee.name === "parseInt" || callee.name === "parseFloat")
  ) {
    return true;
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier") &&
    (callee.property.name === "parseInt" || callee.property.name === "parseFloat")
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
// whether a guard (`?:` ternary or `||`/`??`/`&&` short-circuit) sits
// between them. That nearest function is the handler candidate.
const findEnclosingHandlerAndGuard = (call: EsTreeNode): HandlerLookup => {
  let ancestor = call.parent;
  let isGuarded = false;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return { handler: ancestor, isGuarded };
    if (isNodeOfType(ancestor, "ConditionalExpression")) isGuarded = true;
    if (isNodeOfType(ancestor, "LogicalExpression")) isGuarded = true;
    ancestor = ancestor.parent ?? null;
  }
  return { handler: null, isGuarded };
};

const isNanGuardCall = (node: EsTreeNode): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return NAN_GUARD_FUNCTION_NAMES.has(callee.name);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier") &&
    (NAN_GUARD_FUNCTION_NAMES.has(callee.property.name) || callee.property.name === "isInteger")
  );
};

const subtreeReferencesParsedValue = (
  subtree: EsTreeNode,
  eventRootName: string,
  parseResultName: string | null,
): boolean => {
  let didFindReference = false;
  walkAst(subtree, (child) => {
    if (didFindReference) return false;
    if (getEventValueRootName(child) === eventRootName) {
      didFindReference = true;
      return false;
    }
    if (
      parseResultName !== null &&
      isNodeOfType(child, "Identifier") &&
      child.name === parseResultName
    ) {
      didFindReference = true;
      return false;
    }
  });
  return didFindReference;
};

// Recognizes guards the ancestor walk cannot see: a preceding early-return
// (`if (e.target.value === "") return;`), a short-circuit whose left operand
// checks the value, and the guard-on-next-line the rule's own recommendation
// produces (`const next = Number(e.target.value); if (!Number.isNaN(next))
// setX(next);`). A guard counts only when its test actually reads the event
// value or the variable holding the parse result.
const handlerGuardsParsedValue = (
  handler: EsTreeNode,
  eventRootName: string,
  parseResultName: string | null,
): boolean => {
  let didFindGuard = false;
  walkAst(handler, (node) => {
    if (didFindGuard) return false;
    if (isNodeOfType(node, "IfStatement") || isNodeOfType(node, "ConditionalExpression")) {
      if (subtreeReferencesParsedValue(node.test, eventRootName, parseResultName)) {
        didFindGuard = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "LogicalExpression") &&
      subtreeReferencesParsedValue(node.left, eventRootName, parseResultName)
    ) {
      didFindGuard = true;
      return false;
    }
    if (isNanGuardCall(node)) {
      const guardArgument = node.arguments[0];
      if (
        guardArgument &&
        subtreeReferencesParsedValue(guardArgument, eventRootName, parseResultName)
      ) {
        didFindGuard = true;
        return false;
      }
    }
  });
  return didFindGuard;
};

// Resolves the variable the parse result lands in, walking up through pure
// wrapper calls so `const v = Math.floor(Number(e.target.value))` still binds
// `v` and a later `if (!isNaN(v))` counts as a guard.
const getParseResultBindingName = (call: EsTreeNode): string | null => {
  let wrappedExpression: EsTreeNode = call;
  let ancestor = call.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclarator")) {
      return isNodeOfType(ancestor.id, "Identifier") ? ancestor.id.name : null;
    }
    const isCallArgumentWrapper =
      isNodeOfType(ancestor, "CallExpression") &&
      ancestor.arguments.some((callArgument) => callArgument === wrappedExpression);
    if (!isCallArgumentWrapper) return null;
    wrappedExpression = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const getStaticInputType = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  const typeAttribute = findJsxAttribute(openingElement.attributes ?? [], "type");
  if (!typeAttribute) return null;
  const literalValue = getJsxPropStringValue(typeAttribute);
  if (literalValue !== null) return literalValue;
  const attributeValue = typeAttribute.value;
  if (!attributeValue || !isNodeOfType(attributeValue, "JSXExpressionContainer")) return null;
  let expression: EsTreeNode = attributeValue.expression;
  // `type={AMOUNT_INPUT_TYPE}` — resolve a const binding one hop so a
  // named literal type is as good as an inline one.
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer) return null;
    expression = stripParenExpression(binding.initializer);
  }
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  return null;
};

const firstParameterName = (handler: EsTreeNode): string | null => {
  const params = (handler as EsTreeNodeOfType<"ArrowFunctionExpression">).params ?? [];
  const first = params[0];
  return first && isNodeOfType(first, "Identifier") ? first.name : null;
};

// True only when the inline handler is bound to an `onX` attribute of an
// intrinsic `<input>` element whose `type` can hold free text. A `<select>`,
// `<textarea>`, a component (`<TextField>`, MUI pagination props), or an
// input type the browser sanitizes (`type="range"` sliders, radio/checkbox)
// cannot yield an empty or partially-typed value, so we bail — a false
// negative over a false positive.
const isTextualInputElementHandler = (handler: EsTreeNode): boolean => {
  const container = handler.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  if (
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !HANDLER_ATTRIBUTE_PATTERN.test(attribute.name.name)
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  if (!isNodeOfType(openingElement.name, "JSXIdentifier") || openingElement.name.name !== "input") {
    return false;
  }
  const staticInputType = getStaticInputType(openingElement);
  return staticInputType === null || !BROWSER_SANITIZED_INPUT_TYPES.has(staticInputType);
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
      const firstArgument = argumentList[0];
      if (!firstArgument) return;
      const rootName = getEventValueRootName(firstArgument);
      if (!rootName) return;

      const { handler, isGuarded } = findEnclosingHandlerAndGuard(node as EsTreeNode);
      if (isGuarded || !handler) return;
      if (firstParameterName(handler) !== rootName) return;
      if (!isTextualInputElementHandler(handler)) return;
      const parseResultName = getParseResultBindingName(node as EsTreeNode);
      if (handlerGuardsParsedValue(handler, rootName, parseResultName)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
