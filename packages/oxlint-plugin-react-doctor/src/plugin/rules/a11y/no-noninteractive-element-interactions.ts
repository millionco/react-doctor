import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { NON_INTERACTIVE_ELEMENTS } from "../../constants/html-tags.js";
import { INTERACTIVE_ROLES } from "../../constants/aria-roles.js";

// Collect every string-literal branch a `role={…}` expression can
// produce. A `cond ? "checkbox" : "radio"` ternary (or `a && "button"`)
// yields a concrete interactive role at runtime even though it isn't a
// plain Literal — the static `getJsxPropStringValue` reads it as null.
const collectRoleStringBranches = (expression: EsTreeNode, out: string[]): void => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    out.push(expression.value);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectRoleStringBranches(expression.consequent as EsTreeNode, out);
    collectRoleStringBranches(expression.alternate as EsTreeNode, out);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    collectRoleStringBranches(expression.left as EsTreeNode, out);
    collectRoleStringBranches(expression.right as EsTreeNode, out);
  }
};

const buildMessage = (tag: string): string =>
  `Keyboard & screen reader users can't trigger this \`<${tag}>\` because it isn't interactive, so use a button or link or add an interactive role.`;

// Mouse / pointer / keyboard events that imply interaction.
const INTERACTIVE_HANDLERS: ReadonlyArray<string> = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
];

// Port of `oxc_linter::rules::jsx_a11y::no_noninteractive_element_interactions`.
// Reports interactive event handlers attached to non-interactive HTML
// elements without an interactive role.
export const noNoninteractiveElementInteractions = defineRule({
  id: "no-noninteractive-element-interactions",
  title: "Handler on non-interactive element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Put interactions on a button or link, or add an interactive role.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (!NON_INTERACTIVE_ELEMENTS.has(tag)) return;
      const hasHandler = INTERACTIVE_HANDLERS.some((handler) =>
        hasJsxPropIgnoreCase(node.attributes, handler),
      );
      if (!hasHandler) return;
      const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
      if (roleAttr) {
        const role = getJsxPropStringValue(roleAttr);
        if (role && INTERACTIVE_ROLES.has(role)) return;

        // Non-static role (`role={cond ? "checkbox" : "radio"}`): if every
        // string branch is an interactive role, the element always has
        // one. More generally, when a role is present but its value can't
        // be read statically, we can't prove it is non-interactive, so we
        // don't report (the SolidJS-port idiom keeps roles as ternaries).
        const roleValue = roleAttr.value as EsTreeNode | null;
        if (roleValue && isNodeOfType(roleValue, "JSXExpressionContainer")) {
          const branches: string[] = [];
          collectRoleStringBranches(roleValue.expression as EsTreeNode, branches);
          if (branches.length > 0 && branches.every((branch) => INTERACTIVE_ROLES.has(branch))) {
            return;
          }
          if (branches.length === 0) return;
        }
      }
      context.report({ node: node.name, message: buildMessage(tag) });
    },
  }),
});
