import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: <button> is intentionally omitted. <button type="submit"> (the
// HTML default inside a form) has a real default action, so calling
// preventDefault() on it is legitimate. The narrow case of
// <button type="button"> would need attribute inspection plus form-scope
// detection to be reliable; out of scope until we have evidence of real
// false-negatives.
// HACK: Map (not plain object) so a JSX tag named after an
// Object.prototype property (`<constructor>`, `<toString>`) doesn't
// fall through to a truthy `Object.prototype.X` value and crash on
// `targetEventProps.includes(...)` later in the rule body.
const PREVENT_DEFAULT_ELEMENTS = new Map<string, string[]>([
  ["form", ["onSubmit"]],
  ["a", ["onClick"]],
]);

const containsPreventDefaultCall = (node: EsTreeNode): boolean => {
  let didFindPreventDefault = false;
  walkAst(node, (child) => {
    if (didFindPreventDefault) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
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
  return "preventDefault() on <a> onClick — use a <button> or routing component instead";
};

export const noPreventDefault = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Use `<form action={serverAction}>` (works without JS) or `<button>` instead of `<a>` with preventDefault",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const elementName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
      if (!elementName) return;

      const targetEventProps = PREVENT_DEFAULT_ELEMENTS.get(elementName);
      if (!targetEventProps) return;

      for (const targetEventProp of targetEventProps) {
        const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
        if (!eventAttribute?.value || !isNodeOfType(eventAttribute.value, "JSXExpressionContainer"))
          continue;

        const expression = eventAttribute.value.expression;
        if (
          !isNodeOfType(expression, "ArrowFunctionExpression") &&
          !isNodeOfType(expression, "FunctionExpression")
        )
          continue;

        if (!containsPreventDefaultCall(expression)) continue;

        context.report({ node, message: buildPreventDefaultMessage(elementName) });
        return;
      }
    },
  }),
});
