import { INDEX_PARAMETER_NAMES } from "../constants.js";
import { findJsxAttribute, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const extractIndexName = (node: EsTreeNode): string | null => {
  if (node.type === "Identifier" && INDEX_PARAMETER_NAMES.has(node.name)) return node.name;

  if (node.type === "TemplateLiteral") {
    const indexExpression = node.expressions?.find(
      (expression: EsTreeNode) =>
        expression.type === "Identifier" && INDEX_PARAMETER_NAMES.has(expression.name),
    );
    if (indexExpression) return indexExpression.name;
  }

  if (
    node.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    INDEX_PARAMETER_NAMES.has(node.callee.object.name) &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "toString"
  )
    return node.callee.object.name;

  if (
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    node.arguments?.[0]?.type === "Identifier" &&
    INDEX_PARAMETER_NAMES.has(node.arguments[0].name)
  )
    return node.arguments[0].name;

  if (
    node.type === "BinaryExpression" &&
    node.operator === "+" &&
    ((node.left?.type === "Identifier" &&
      INDEX_PARAMETER_NAMES.has(node.left.name) &&
      node.right?.type === "Literal" &&
      node.right.value === "") ||
      (node.right?.type === "Identifier" &&
        INDEX_PARAMETER_NAMES.has(node.right.name) &&
        node.left?.type === "Literal" &&
        node.left.value === ""))
  ) {
    return node.left?.type === "Identifier" ? node.left.name : node.right.name;
  }

  return null;
};

const isInsideStaticPlaceholderMap = (node: EsTreeNode): boolean => {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (
      current.type === "CallExpression" &&
      current.callee?.type === "MemberExpression" &&
      current.callee.property?.name === "map"
    ) {
      const receiver = current.callee.object;
      if (receiver?.type === "CallExpression") {
        const callee = receiver.callee;
        if (
          callee?.type === "MemberExpression" &&
          callee.object?.type === "Identifier" &&
          callee.object.name === "Array" &&
          callee.property?.name === "from"
        )
          return true;
      }
      if (
        receiver?.type === "NewExpression" &&
        receiver.callee?.type === "Identifier" &&
        receiver.callee.name === "Array"
      )
        return true;
    }
  }
  return false;
};

export const noArrayIndexAsKey: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "key") return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const indexName = extractIndexName(node.value.expression);
      if (!indexName) return;
      if (isInsideStaticPlaceholderMap(node)) return;

      context.report({
        node,
        message: `Array index "${indexName}" used as key — causes bugs when list is reordered or filtered`,
      });
    },
  }),
};

const PREVENT_DEFAULT_ELEMENTS: Record<string, string[]> = {
  form: ["onSubmit"],
  a: ["onClick"],
  button: ["onClick"],
};

const containsPreventDefaultCall = (node: EsTreeNode): boolean => {
  let didFindPreventDefault = false;
  walkAst(node, (child) => {
    if (didFindPreventDefault) return;
    if (
      child.type === "CallExpression" &&
      child.callee?.type === "MemberExpression" &&
      child.callee.property?.type === "Identifier" &&
      child.callee.property.name === "preventDefault"
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

const buildPreventDefaultMessage = (elementName: string): string => {
  if (elementName === "form") {
    return "preventDefault() on <form> onSubmit — form won't work without JavaScript. Consider using a server action for progressive enhancement";
  }
  if (elementName === "a") {
    return "preventDefault() on <a> onClick — use a <button> or routing component instead";
  }
  return "preventDefault() on a button click handler — buttons don't have a default action; remove the call or switch the element if you needed to suppress a real default";
};

export const noPreventDefault: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!elementName) return;

      const targetEventProps = PREVENT_DEFAULT_ELEMENTS[elementName];
      if (!targetEventProps) return;

      for (const targetEventProp of targetEventProps) {
        const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
        if (!eventAttribute?.value || eventAttribute.value.type !== "JSXExpressionContainer")
          continue;

        const expression = eventAttribute.value.expression;
        if (
          expression?.type !== "ArrowFunctionExpression" &&
          expression?.type !== "FunctionExpression"
        )
          continue;

        if (!containsPreventDefaultCall(expression)) continue;

        context.report({ node, message: buildPreventDefaultMessage(elementName) });
        return;
      }
    },
  }),
};

const NUMERIC_NAME_HINTS = ["count", "length", "total", "size", "num"];

// HACK: word-boundary aware to avoid false positives like `discount` /
// `account` matching "count" or `strength` matching "length". The hint
// must be either the entire identifier OR appear at the end with a
// case/underscore boundary (`userCount`, `user_count`, `USER_COUNT`).
const isNumericName = (name: string): boolean => {
  for (const hint of NUMERIC_NAME_HINTS) {
    if (name === hint) return true;
    const camelSuffix = hint.charAt(0).toUpperCase() + hint.slice(1);
    if (name.endsWith(camelSuffix)) return true;
    if (name.endsWith(`_${hint}`)) return true;
    if (name.endsWith(`_${hint.toUpperCase()}`)) return true;
  }
  return false;
};

export const renderingConditionalRender: Rule = {
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNode) {
      if (node.operator !== "&&") return;

      const isRightJsx = node.right?.type === "JSXElement" || node.right?.type === "JSXFragment";
      if (!isRightJsx) return;

      const left = node.left;
      if (!left) return;

      const isLengthMemberAccess =
        left.type === "MemberExpression" &&
        left.property?.type === "Identifier" &&
        left.property.name === "length";

      const isNumericIdentifier = left.type === "Identifier" && isNumericName(left.name);

      if (isLengthMemberAccess || isNumericIdentifier) {
        context.report({
          node,
          message:
            "Conditional rendering with a numeric value can render '0' — use `value > 0`, `Boolean(value)`, or a ternary",
        });
      }
    },
  }),
};
