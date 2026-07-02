import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { NON_INTERACTIVE_ELEMENTS } from "../../constants/html-tags.js";
import { INTERACTIVE_ROLES } from "../../constants/aria-roles.js";

interface RoleExpressionBranches {
  stringValues: string[];
  // A runtime value that is provably NOT an interactive role can escape:
  // a nullish / `false` literal (`role={show ? "button" : null}`) or the
  // falsy short-circuit of `&&` (`role={enabled && "button"}` is `false`
  // when the guard is falsy). When set, we can't claim the element always
  // carries an interactive role, so suppression is unsafe.
  hasNonRoleBranch: boolean;
  // A branch the collector cannot resolve (`role={left || "button"}` with an
  // opaque `left`): a truthy left supplies an arbitrary runtime role, so the
  // string branches alone cannot prove the element is always interactive.
  hasOpaqueBranch: boolean;
}

// Collect every string-literal branch a `role={…}` expression can produce.
// A `cond ? "checkbox" : "radio"` ternary yields a concrete interactive role
// at runtime even though it isn't a plain Literal — the static
// `getJsxPropStringValue` reads it as null. Branches that can resolve to a
// non-role value flip `hasNonRoleBranch` so the caller stops trusting the
// string branches alone.
const collectRoleBranches = (expression: EsTreeNode, out: RoleExpressionBranches): void => {
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string") {
      out.stringValues.push(expression.value);
    } else {
      out.hasNonRoleBranch = true;
    }
    return;
  }
  // `undefined` is an Identifier, not a Literal, but resolves to no role just
  // like a `null`/`false` literal — so a branch that yields it leaves the
  // element sometimes role-less. A different identifier (`role={dynamicRole}`)
  // stays opaque, so it marks the opaque flag instead.
  if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") {
    out.hasNonRoleBranch = true;
    return;
  }
  // `void 0` (or `void anything`) always evaluates to `undefined`.
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    out.hasNonRoleBranch = true;
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectRoleBranches(expression.consequent as EsTreeNode, out);
    collectRoleBranches(expression.alternate as EsTreeNode, out);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      out.hasNonRoleBranch = true;
      collectRoleBranches(expression.right as EsTreeNode, out);
      return;
    }
    if (expression.operator === "??") {
      // Unlike `||`, a non-nullish falsy left (`false ?? "button"` → `false`)
      // passes through `??`, so an opaque left the collector can't resolve
      // means the element can end up role-less.
      const stringCountBeforeLeft = out.stringValues.length;
      collectRoleBranches(expression.left as EsTreeNode, out);
      const didLeftResolve =
        out.stringValues.length > stringCountBeforeLeft || out.hasNonRoleBranch;
      if (!didLeftResolve) out.hasNonRoleBranch = true;
      collectRoleBranches(expression.right as EsTreeNode, out);
      return;
    }
    // `||`: a truthy string-literal left always short-circuits, so the right
    // operand is unreachable and only the left branch matters.
    const leftOperand = expression.left as EsTreeNode;
    if (
      expression.operator === "||" &&
      isNodeOfType(leftOperand, "Literal") &&
      typeof leftOperand.value === "string" &&
      leftOperand.value.length > 0
    ) {
      out.stringValues.push(leftOperand.value);
      return;
    }
    collectRoleBranches(leftOperand, out);
    collectRoleBranches(expression.right as EsTreeNode, out);
    return;
  }
  // Anything else (`role={dynamicRole}`, `role={getRole()}`,
  // `role={roles[kind]}`, template literals, …) can supply an arbitrary
  // runtime role the collector cannot see.
  out.hasOpaqueBranch = true;
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
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const tag = getElementType(node, context.settings);
        if (!NON_INTERACTIVE_ELEMENTS.has(tag)) return;
        // Upstream jsx-a11y / oxc never flag <label> here: it has no mapped
        // ARIA role, and clicking a label forwards activation to its nested
        // keyboard-accessible input.
        if (tag === "label") return;
        const hasHandler = INTERACTIVE_HANDLERS.some((handler) =>
          hasJsxPropIgnoreCase(node.attributes, handler),
        );
        if (!hasHandler) return;
        if (isHiddenFromScreenReader(node, context.settings)) return;
        const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
        if (roleAttr) {
          const role = getJsxPropStringValue(roleAttr);
          if (role && INTERACTIVE_ROLES.has(role)) return;

          // Non-static role (`role={cond ? "checkbox" : "radio"}`): if every
          // string branch is an interactive role AND no branch can resolve to
          // a non-role value, the element always has one. When a role is
          // present but fully opaque (`role={x}`), we can't prove it is
          // non-interactive, so we stay quiet (the SolidJS-port idiom keeps
          // roles as ternaries). But a provable escape to `null`/`false`/
          // `undefined` (or the `&&` short-circuit) means it is sometimes role-less,
          // so we still report.
          const roleValue = roleAttr.value as EsTreeNode | null;
          if (roleValue && isNodeOfType(roleValue, "JSXExpressionContainer")) {
            const branches: RoleExpressionBranches = {
              stringValues: [],
              hasNonRoleBranch: false,
              hasOpaqueBranch: false,
            };
            collectRoleBranches(roleValue.expression as EsTreeNode, branches);
            const everyBranchIsInteractiveRole =
              branches.stringValues.length > 0 &&
              !branches.hasNonRoleBranch &&
              !branches.hasOpaqueBranch &&
              branches.stringValues.every((branch) => INTERACTIVE_ROLES.has(branch));
            if (everyBranchIsInteractiveRole) return;
            if (branches.stringValues.length === 0 && !branches.hasNonRoleBranch) return;
          }
        }
        context.report({ node: node.name, message: buildMessage(tag) });
      },
    };
  },
});
