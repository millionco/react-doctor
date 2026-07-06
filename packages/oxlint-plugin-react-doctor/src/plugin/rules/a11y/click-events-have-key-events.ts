import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";
import { isPureEventBlockerHandler } from "../../utils/is-pure-event-blocker-handler.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const MESSAGE =
  "Keyboard users can't trigger this click handler because there's no keyboard one, so add `onKeyUp`, `onKeyDown`, or `onKeyPress`.";

const KEY_HANDLERS = ["onKeyUp", "onKeyDown", "onKeyPress"] as const;

// OXC's `is_interactive_element` treats these as interactive, but none
// of them takes focus or has native activation semantics — a
// `<tr onClick>` is exactly as keyboard-inaccessible as a
// `<div onClick>` (confirmed false negatives in the verify run).
const FOCUSLESS_CONTAINER_TAGS: ReadonlySet<string> = new Set(["tr", "td", "th", "canvas"]);

// framer-motion's `motion.div` etc. deterministically render the
// underlying DOM tag.
const resolveMotionTag = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  const name = node.name as EsTreeNode;
  if (!isNodeOfType(name, "JSXMemberExpression")) return null;
  const objectName = name.object as EsTreeNode;
  if (!isNodeOfType(objectName, "JSXIdentifier") || objectName.name !== "motion") return null;
  const tag = name.property.name;
  return tag && HTML_TAGS.has(tag) ? tag : null;
};

// `.click()` is deliberately NOT here: forwarding a click to a hidden
// file input (`fileInputRef.current?.click()`) is a real keyboard gap
// because a display:none input can't be focused.
const FOCUS_FORWARDING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "focus",
  "select",
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const isFocusForwardingCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const inner = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee as EsTreeNode;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return FOCUS_FORWARDING_METHOD_NAMES.has(callee.property.name);
};

const isFocusForwardingFunctionBody = (body: EsTreeNode | null | undefined): boolean => {
  if (!body) return false;
  if (isFocusForwardingCall(body)) return true;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    if (statements.length === 0) return false;
    for (const statement of statements) {
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      if (!isFocusForwardingCall(statement.expression as EsTreeNode)) return false;
    }
    return true;
  }
  return false;
};

const resolveHandlerFunction = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  let expression = attribute.value.expression as EsTreeNode;
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer) return null;
    expression = binding.initializer;
  }
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return expression;
  }
  return null;
};

// `onClick={() => inputRef.current?.focus()}` (and same-file named
// handlers with that shape) only forward focus to a real control
// keyboard users already reach via Tab — the wrapper isn't a
// keyboard-inaccessible action.
const isFocusForwardingHandler = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const handlerFunction = resolveHandlerFunction(attribute);
  if (!handlerFunction) return false;
  return isFocusForwardingFunctionBody((handlerFunction as { body?: EsTreeNode }).body ?? null);
};

// Port of `oxc_linter::rules::jsx_a11y::click_events_have_key_events`.
// Flags elements with `onClick` that lack a keyboard handler — only
// applies to non-interactive HTML elements (interactive ones already
// support keyboard activation). Non-React JSX dialect skipping is
// handled by the `react-jsx-only` tag via `defineRule`.
export const clickEventsHaveKeyEvents = defineRule({
  id: "click-events-have-key-events",
  title: "Click handler missing keyboard handler",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Pair `onClick` with a key handler so keyboard users can trigger it.",
  category: "Accessibility",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const tag = resolveMotionTag(node) ?? getElementType(node, context.settings);
        if (!HTML_TAGS.has(tag)) return;
        // Clicking a <label> forwards activation to its control, which
        // keyboard users operate directly (Space on the native input
        // also dispatches a click that bubbles to the label).
        if (tag === "label") return;
        if (!FOCUSLESS_CONTAINER_TAGS.has(tag) && isInteractiveElement(tag, node)) return;
        const onClick = hasJsxPropIgnoreCase(node.attributes, "onClick");
        if (!onClick) return;
        if (isPureEventBlockerHandler(onClick)) return;
        if (isFocusForwardingHandler(onClick)) return;

        if (isHiddenFromScreenReader(node, context.settings)) return;
        // Presentational role (presentation / none) → not perceivable by AT.
        if (isPresentationRole(node)) return;
        const hasKeyHandler = KEY_HANDLERS.some((handler) =>
          hasJsxPropIgnoreCase(node.attributes, handler),
        );
        if (hasKeyHandler) return;

        context.report({ node: node.name, message: MESSAGE });
      },
    };
  },
});
