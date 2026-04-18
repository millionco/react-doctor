import { INDEX_PARAMETER_NAMES } from "../constants.js";
import { findJsxAttribute, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

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
    node.callee.name === "String" &&
    node.arguments?.[0]?.type === "Identifier" &&
    INDEX_PARAMETER_NAMES.has(node.arguments[0].name)
  )
    return node.arguments[0].name;

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

const PREVENT_DEFAULT_ELEMENTS: Record<string, string> = {
  form: "onSubmit",
  a: "onClick",
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

export const noPreventDefault: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!elementName) return;

      const targetEventProp = PREVENT_DEFAULT_ELEMENTS[elementName];
      if (!targetEventProp) return;

      const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
      if (!eventAttribute?.value || eventAttribute.value.type !== "JSXExpressionContainer") return;

      const expression = eventAttribute.value.expression;
      if (
        expression?.type !== "ArrowFunctionExpression" &&
        expression?.type !== "FunctionExpression"
      )
        return;

      if (!containsPreventDefaultCall(expression)) return;

      const message =
        elementName === "form"
          ? "preventDefault() on <form> onSubmit — form won't work without JavaScript. Consider using a server action for progressive enhancement"
          : "preventDefault() on <a> onClick — use a <button> or routing component instead";

      context.report({ node, message });
    },
  }),
};

export const renderingConditionalRender: Rule = {
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNode) {
      if (node.operator !== "&&") return;

      const isRightJsx = node.right?.type === "JSXElement" || node.right?.type === "JSXFragment";
      if (!isRightJsx) return;

      if (
        node.left?.type === "MemberExpression" &&
        node.left.property?.type === "Identifier" &&
        node.left.property.name === "length"
      ) {
        context.report({
          node,
          message:
            "Conditional rendering with .length can render '0' — use .length > 0 or Boolean(.length)",
        });
      }
    },
  }),
};
