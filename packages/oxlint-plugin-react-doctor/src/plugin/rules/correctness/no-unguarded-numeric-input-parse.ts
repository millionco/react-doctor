import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
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

const FIXED_VALUE_INPUT_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio"]);

const isNumericParseCallee = (callee: EsTreeNode, context: RuleContext): boolean => {
  if (
    isNodeOfType(callee, "Identifier") &&
    (callee.name === "Number" || callee.name === "parseInt" || callee.name === "parseFloat") &&
    context.scopes.isGlobalReference(callee)
  ) {
    return true;
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    context.scopes.isGlobalReference(callee.object) &&
    (getStaticPropertyName(callee) === "parseInt" || getStaticPropertyName(callee) === "parseFloat")
  );
};

// Returns the root identifier name (the event parameter, e.g. `e`) when
// `argument` is an event-input value read: `e.target.value`,
// `e.currentTarget.value`, `e.target.valueAsNumber`. Otherwise null.
const getEventValueRootName = (argument: EsTreeNode): string | null => {
  const valueAccess = stripParenExpression(argument);
  if (
    !isNodeOfType(valueAccess, "MemberExpression") ||
    !EVENT_VALUE_PROPERTIES.has(getStaticPropertyName(valueAccess) ?? "")
  ) {
    return null;
  }
  const targetAccess = stripParenExpression(valueAccess.object);
  if (
    !isNodeOfType(targetAccess, "MemberExpression") ||
    !EVENT_TARGET_PROPERTIES.has(getStaticPropertyName(targetAccess) ?? "")
  ) {
    return null;
  }
  const root = stripParenExpression(targetAccess.object);
  return isNodeOfType(root, "Identifier") ? root.name : null;
};

const findEnclosingHandler = (call: EsTreeNode): EsTreeNode | null => {
  let ancestor = call.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
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

const isGuardedByRelatedAncestor = (call: EsTreeNode, eventRootName: string): boolean => {
  let child = call;
  let ancestor = call.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      ancestor.test !== child &&
      subtreeReferencesParsedValue(ancestor.test, eventRootName, null)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "LogicalExpression")) {
      if (ancestor.left === child && (ancestor.operator === "||" || ancestor.operator === "??")) {
        return true;
      }
      if (
        ancestor.right === child &&
        subtreeReferencesParsedValue(ancestor.left, eventRootName, null)
      ) {
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// Recognizes guards the ancestor walk cannot see: a preceding early-return
// (`if (e.target.value === "") return;`), a short-circuit whose left operand
// checks the value, and the guard-on-next-line the rule's own recommendation
// produces (`const next = Number(e.target.value); if (!Number.isNaN(next))
// setX(next);`). A guard counts only when its test actually reads the event
// value or the variable holding the parse result.
const handlerGuardsParsedValue = (
  handler: EsTreeNode,
  call: EsTreeNode,
  eventRootName: string,
  parseResultName: string | null,
): boolean => {
  let didFindGuard = false;
  walkAst(handler, (node) => {
    if (didFindGuard) return false;
    if (
      isNodeOfType(node, "IfStatement") &&
      node.range[1] <= call.range[0] &&
      subtreeReferencesParsedValue(node.test, eventRootName, null) &&
      (isNodeOfType(node.consequent, "ReturnStatement") ||
        isNodeOfType(node.consequent, "ThrowStatement") ||
        (isNodeOfType(node.consequent, "BlockStatement") &&
          node.consequent.body.some(
            (statement) =>
              isNodeOfType(statement, "ReturnStatement") ||
              isNodeOfType(statement, "ThrowStatement"),
          )))
    ) {
      didFindGuard = true;
      return false;
    }
    if (parseResultName !== null && isNanGuardCall(node) && node.range[0] > call.range[1]) {
      const guardArgument = node.arguments[0];
      if (guardArgument && subtreeReferencesParsedValue(guardArgument, "", parseResultName)) {
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

// True only when the inline handler is bound to an intrinsic `<input>` whose
// value can still coerce to zero or NaN. Range inputs and radio/checkbox
// inputs with a fixed numeric value are safe by construction.
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
  if (staticInputType === "range") return false;
  if (!staticInputType || !FIXED_VALUE_INPUT_TYPES.has(staticInputType)) return true;
  const valueAttribute = findJsxAttribute(openingElement.attributes ?? [], "value");
  if (!valueAttribute) return true;
  const staticValue = getJsxPropStringValue(valueAttribute);
  return staticValue === null || staticValue.trim() === "" || !Number.isFinite(Number(staticValue));
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
      if (!isNumericParseCallee(node.callee as EsTreeNode, context)) return;
      const argumentList = (node.arguments ?? []) as EsTreeNode[];
      const firstArgument = argumentList[0];
      if (!firstArgument) return;
      const rootName = getEventValueRootName(firstArgument);
      if (!rootName) return;

      const handler = findEnclosingHandler(node as EsTreeNode);
      if (!handler) return;
      if (isGuardedByRelatedAncestor(node as EsTreeNode, rootName)) return;
      if (firstParameterName(handler) !== rootName) return;
      if (!isTextualInputElementHandler(handler)) return;
      const parseResultName = getParseResultBindingName(node as EsTreeNode);
      if (handlerGuardsParsedValue(handler, node as EsTreeNode, rootName, parseResultName)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
