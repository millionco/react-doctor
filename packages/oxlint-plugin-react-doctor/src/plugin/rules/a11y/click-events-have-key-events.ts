import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";
import { isPureEventBlockerHandler } from "../../utils/is-pure-event-blocker-handler.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const MESSAGE =
  "Keyboard users can't trigger this click handler because there's no keyboard one, so add `onKeyUp`, `onKeyDown`, or `onKeyPress`.";

const KEY_HANDLERS = [
  "onKeyUp",
  "onKeyDown",
  "onKeyPress",
  "onKeyUpCapture",
  "onKeyDownCapture",
  "onKeyPressCapture",
] as const;

const CLICK_HANDLERS = ["onClick", "onClickCapture"] as const;
const TRANSPARENT_SPREAD_EVENT_NAMES: ReadonlySet<string> = new Set(
  [...CLICK_HANDLERS, ...KEY_HANDLERS].map((eventName) => eventName.toLowerCase()),
);
const CONSERVATIVE_SPREAD_PROP_NAMES: ReadonlySet<string> = new Set([
  "aria-hidden",
  "onmouseenter",
  "onmouseover",
  "role",
]);

const resolveSpreadObjectExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const innerExpression = stripParenExpression(expression);
  if (isNodeOfType(innerExpression, "ObjectExpression")) return innerExpression;
  if (!isNodeOfType(innerExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(innerExpression, scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "ObjectExpression") ? initializer : null;
};

const collectTransparentSpreadEventNames = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  eventValues: Map<string, EsTreeNode>,
  visitedObjectExpressions: Set<EsTreeNode>,
): boolean => {
  const objectExpression = resolveSpreadObjectExpression(expression, scopes);
  if (!objectExpression || visitedObjectExpressions.has(objectExpression)) return false;
  visitedObjectExpressions.add(objectExpression);
  let isTransparent = true;
  for (const property of objectExpression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      if (
        !collectTransparentSpreadEventNames(
          property.argument as EsTreeNode,
          scopes,
          eventValues,
          visitedObjectExpressions,
        )
      ) {
        isTransparent = false;
        break;
      }
      continue;
    }
    if (!isNodeOfType(property, "Property")) {
      isTransparent = false;
      break;
    }
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) {
      isTransparent = false;
      break;
    }
    const normalizedPropertyName = propertyName.toLowerCase();
    if (CONSERVATIVE_SPREAD_PROP_NAMES.has(normalizedPropertyName)) {
      isTransparent = false;
      break;
    }
    if (TRANSPARENT_SPREAD_EVENT_NAMES.has(normalizedPropertyName)) {
      eventValues.set(normalizedPropertyName, property.value as EsTreeNode);
    }
  }
  visitedObjectExpressions.delete(objectExpression);
  return isTransparent;
};

const getTransparentSpreadEventValues = (
  attributes: EsTreeNode[],
  scopes: ScopeAnalysis,
): Map<string, EsTreeNode> | null => {
  const eventValues = new Map<string, EsTreeNode>();
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    if (
      !collectTransparentSpreadEventNames(
        attribute.argument as EsTreeNode,
        scopes,
        eventValues,
        new Set(),
      )
    ) {
      return null;
    }
  }
  return eventValues;
};

// OXC's `is_interactive_element` treats these as interactive, but none
// of them takes focus or has native activation semantics — a
// `<tr onClick>` is exactly as keyboard-inaccessible as a
// `<div onClick>` (confirmed false negatives in the verify run).
const FOCUSLESS_CONTAINER_TAGS: ReadonlySet<string> = new Set(["tr", "td", "th", "canvas"]);

// Member-element factories that deterministically render the underlying
// DOM tag: framer-motion's `motion.div`, and `styled.div`-style JSX
// factories (Panda CSS, Chakra-style styled systems).
const MEMBER_ELEMENT_FACTORY_NAMES: ReadonlySet<string> = new Set(["motion", "styled"]);

const resolveMemberElementTag = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  const name = node.name as EsTreeNode;
  if (!isNodeOfType(name, "JSXMemberExpression")) return null;
  const objectName = name.object as EsTreeNode;
  if (
    !isNodeOfType(objectName, "JSXIdentifier") ||
    !MEMBER_ELEMENT_FACTORY_NAMES.has(objectName.name)
  ) {
    return null;
  }
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
  return resolveHandlerFunctionExpression(attribute.value.expression as EsTreeNode);
};

const resolveHandlerFunctionExpression = (handlerExpression: EsTreeNode): EsTreeNode | null => {
  let expression = handlerExpression;
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

// Items of ARIA composite widgets receive keyboard interaction from the
// composite container (roving tabindex or aria-activedescendant per the
// APG), not from their own key handlers — the doc's
// keyboard-handled-elsewhere FP shape.
const COMPOSITE_ITEM_ROLES: ReadonlySet<string> = new Set([
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "tab",
  "gridcell",
  "row",
]);

const hasCompositeItemRole = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
  if (!roleAttribute) return false;
  const roleValue = roleAttribute.value as EsTreeNode | null;
  if (!roleValue || !isNodeOfType(roleValue, "Literal") || typeof roleValue.value !== "string") {
    return false;
  }
  const firstRole = roleValue.value.split(/\s+/)[0];
  return Boolean(firstRole && COMPOSITE_ITEM_ROLES.has(firstRole.toLowerCase()));
};

// Natively keyboard-activatable tags: Enter/Space on them dispatches a
// click that bubbles to the wrapper's onClick.
const NATIVE_ACTIVATABLE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

const INTERACTIVE_COMPONENT_NAME_PATTERN = /button|link|nav|anchor/i;

// The doc's FP example: a wrapper whose onClick only catches clicks
// bubbling from an inner control that already handles keyboard —
// keyboard activation of the inner button/link dispatches a click that
// bubbles to the wrapper, so the handler IS keyboard-reachable.
const containsKeyboardActivatableDescendant = (element: EsTreeNode | null | undefined): boolean => {
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  for (const child of element.children) {
    const childNode = child as EsTreeNode;
    if (!isNodeOfType(childNode, "JSXElement")) continue;
    const name = flattenJsxName(childNode.openingElement.name as EsTreeNode);
    if (name) {
      if (NATIVE_ACTIVATABLE_TAGS.has(name)) return true;
      if (/^[A-Z]/.test(name) && INTERACTIVE_COMPONENT_NAME_PATTERN.test(name)) return true;
    }
    if (containsKeyboardActivatableDescendant(childNode)) return true;
  }
  return false;
};

const isTargetCurrentTargetComparison = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (node.operator !== "===" && node.operator !== "==" && node.operator !== "!==") return false;
  const propertyNames = [node.left as EsTreeNode, node.right as EsTreeNode].map((side) => {
    if (!isNodeOfType(side, "MemberExpression")) return null;
    const property = side.property as EsTreeNode;
    return isNodeOfType(property, "Identifier") ? property.name : null;
  });
  return propertyNames.includes("target") && propertyNames.includes("currentTarget");
};

const containsBackdropDismissComparison = (node: EsTreeNode | null | undefined): boolean => {
  if (!node || typeof node !== "object") return false;
  if (isTargetCurrentTargetComparison(node)) return true;
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { type?: unknown }).type === "string" &&
          containsBackdropDismissComparison(item as EsTreeNode)
        ) {
          return true;
        }
      }
    } else if (
      value &&
      typeof value === "object" &&
      typeof (value as { type?: unknown }).type === "string" &&
      containsBackdropDismissComparison(value as EsTreeNode)
    ) {
      return true;
    }
  }
  return false;
};

// A handler gated on `e.target === e.currentTarget` is the
// click-outside/backdrop-dismiss idiom: it only reacts to clicks on the
// backdrop itself, an action keyboard users perform via Escape instead
// (the backdrop is never focusable).
const isBackdropDismissHandler = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const handlerFunction = resolveHandlerFunction(attribute);
  if (!handlerFunction) return false;
  return containsBackdropDismissComparison((handlerFunction as { body?: EsTreeNode }).body ?? null);
};

// A list item wired with hover-highlight (`onMouseEnter`) plus
// click-select is the mouse path of a combobox/suggestion list — the
// paired text input handles ArrowUp/Down/Enter selection.
const isHoverSelectionListItem = (
  tag: string,
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean =>
  tag === "li" &&
  Boolean(
    hasJsxPropIgnoreCase(node.attributes, "onMouseEnter") ||
    hasJsxPropIgnoreCase(node.attributes, "onMouseOver"),
  );

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
        const tag = resolveMemberElementTag(node) ?? getElementType(node, context.settings);
        if (!HTML_TAGS.has(tag)) return;
        // Clicking a <label> forwards activation to its control, which
        // keyboard users operate directly (Space on the native input
        // also dispatches a click that bubbles to the label).
        if (tag === "label") return;
        if (!FOCUSLESS_CONTAINER_TAGS.has(tag) && isInteractiveElement(tag, node)) return;
        // `onClickCapture` is the same click affordance on the capture
        // phase — equally unreachable from the keyboard.
        const spreadEventValues = getTransparentSpreadEventValues(node.attributes, context.scopes);
        if (!spreadEventValues) return;
        const onClick =
          hasJsxPropIgnoreCase(node.attributes, "onClick") ??
          hasJsxPropIgnoreCase(node.attributes, "onClickCapture");
        const spreadOnClickExpression = CLICK_HANDLERS.map((name) =>
          spreadEventValues.get(name.toLowerCase()),
        ).find((expression) => expression !== undefined);
        if (!onClick && !spreadOnClickExpression) {
          return;
        }
        if (onClick && isPureEventBlockerHandler(onClick)) return;
        if (onClick && isFocusForwardingHandler(onClick)) return;
        const spreadHandlerFunction = spreadOnClickExpression
          ? resolveHandlerFunctionExpression(spreadOnClickExpression)
          : null;
        if (
          spreadHandlerFunction &&
          (isFocusForwardingFunctionBody(
            (spreadHandlerFunction as { body?: EsTreeNode }).body ?? null,
          ) ||
            containsBackdropDismissComparison(
              (spreadHandlerFunction as { body?: EsTreeNode }).body ?? null,
            ))
        ) {
          return;
        }
        if (hasCompositeItemRole(node)) return;
        if (isHoverSelectionListItem(tag, node)) return;
        if (onClick && isBackdropDismissHandler(onClick)) return;
        if (containsKeyboardActivatableDescendant(node.parent)) return;

        if (isHiddenFromScreenReader(node, context.settings)) return;
        // Presentational role (presentation / none) → not perceivable by AT.
        if (isPresentationRole(node)) return;
        const hasKeyHandler = KEY_HANDLERS.some(
          (handler) =>
            hasJsxPropIgnoreCase(node.attributes, handler) ||
            spreadEventValues.has(handler.toLowerCase()),
        );
        if (hasKeyHandler) return;

        context.report({ node: node.name, message: MESSAGE });
      },
    };
  },
});
