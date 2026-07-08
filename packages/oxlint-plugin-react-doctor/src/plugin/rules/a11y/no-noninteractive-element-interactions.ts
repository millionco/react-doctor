import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";
import { isPureEventBlockerHandler } from "../../utils/is-pure-event-blocker-handler.js";
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

// Mouse events that imply the element itself is a pointer-interaction
// target. Keyboard handlers (onKeyDown/onKeyPress/onKeyUp) alone don't
// count: on a non-interactive element they only ever fire via events
// bubbling from focusable descendants (roving-focus / Enter-and-Escape
// delegation), so keyboard users are exactly who they serve.
const MOUSE_HANDLERS_LOWER: ReadonlySet<string> = new Set(
  ["onClick", "onMouseDown", "onMouseUp"].map((handlerName) => handlerName.toLowerCase()),
);

// A presentation-role element is a passive delegation wrapper only when
// the real interaction target lives inside it: a native interactive
// element or a descendant with an interactive role. Without one, the
// wrapper's own click handler IS the interaction, and role="presentation"
// hides it from assistive tech instead of marking delegation.
const hasInteractiveDescendant = (element: EsTreeNode | null | undefined): boolean => {
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  for (const child of element.children) {
    const childNode = child as EsTreeNode;
    if (!isNodeOfType(childNode, "JSXElement")) continue;
    const opening = childNode.openingElement as EsTreeNodeOfType<"JSXOpeningElement">;
    const name = flattenJsxName(opening.name as EsTreeNode);
    if (name && isInteractiveElement(name, opening)) return true;
    const roleAttribute = hasJsxPropIgnoreCase(opening.attributes, "role");
    if (roleAttribute) {
      const role = getJsxPropStringValue(roleAttribute);
      if (role && INTERACTIVE_ROLES.has(role)) return true;
    }
    if (hasInteractiveDescendant(childNode)) return true;
  }
  return false;
};

const isContentEditableTrue = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, "contenteditable");
  if (!attribute) return false;
  if (!attribute.value) return true;
  const stringValue = getJsxPropStringValue(attribute);
  if (stringValue !== null) return stringValue === "true" || stringValue === "";
  const value = attribute.value as EsTreeNode;
  return (
    isNodeOfType(value, "JSXExpressionContainer") &&
    isNodeOfType(value.expression as EsTreeNode, "Literal") &&
    (value.expression as { value: unknown }).value === true
  );
};

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
        // Pure event-blocker handlers (`onClick={(e) => e.stopPropagation()}`,
        // the modal-content shield idiom) don't make the element an
        // interaction target, so they don't count.
        let hasActionableMouseHandler = false;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = getJsxAttributeName(attribute.name);
          if (!attributeName || !MOUSE_HANDLERS_LOWER.has(attributeName.toLowerCase())) continue;
          if (isPureEventBlockerHandler(attribute)) continue;
          hasActionableMouseHandler = true;
          break;
        }
        if (!hasActionableMouseHandler) return;
        if (isHiddenFromScreenReader(node, context.settings)) return;
        // `role="presentation"`/`"none"` marks a delegation wrapper in a
        // composite widget only when an interactive descendant exists to
        // receive the interaction. A presentation-role element whose click
        // handler is the sole interaction target is the keyboard-
        // inaccessibility hazard this rule documents, so it still fires.
        // contentEditable elements are keyboard-editable already.
        if (isPresentationRole(node) && hasInteractiveDescendant(node.parent)) {
          return;
        }
        if (isContentEditableTrue(node)) return;
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
            const everyStringBranchIsInteractiveRole =
              branches.stringValues.length > 0 &&
              branches.stringValues.every((branch) => INTERACTIVE_ROLES.has(branch));
            if (
              everyStringBranchIsInteractiveRole &&
              !branches.hasNonRoleBranch &&
              !branches.hasOpaqueBranch
            ) {
              return;
            }
            if (branches.stringValues.length === 0 && !branches.hasNonRoleBranch) return;
            // Conditional interactivity: `role={x ? "button" : undefined}`
            // alongside a tabIndex means the element toggles between a
            // proper widget and an inert item — the role-less branch is
            // the state where the handler does nothing.
            if (
              everyStringBranchIsInteractiveRole &&
              branches.hasNonRoleBranch &&
              hasJsxPropIgnoreCase(node.attributes, "tabindex")
            ) {
              return;
            }
          }
        }
        context.report({ node: node.name, message: buildMessage(tag) });
      },
    };
  },
});
