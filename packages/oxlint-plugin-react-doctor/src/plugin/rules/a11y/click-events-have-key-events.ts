import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasKeyboardActivatableDescendant } from "../../utils/has-keyboard-activatable-descendant.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
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
const DOM_QUERY_METHOD_NAMES: ReadonlySet<string> = new Set(["getElementById", "querySelector"]);
const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(["global", "globalThis", "window"]);

const isFocusForwardingCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const inner = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee as EsTreeNode;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return FOCUS_FORWARDING_METHOD_NAMES.has(callee.property.name);
};

const isGlobalDocumentExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    return candidate.name === "document" && scopes.isGlobalReference(candidate);
  }
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !isNodeOfType(candidate.object, "Identifier") ||
    !isNodeOfType(candidate.property, "Identifier") ||
    candidate.property.name !== "document"
  ) {
    return false;
  }
  return (
    GLOBAL_OBJECT_NAMES.has(candidate.object.name) && scopes.isGlobalReference(candidate.object)
  );
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

const resolveHandlerFunction = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | null => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  return resolveHandlerFunctionExpression(attribute.value.expression as EsTreeNode);
};

const resolveHandlerFunctionExpression = (
  handlerExpression: EsTreeNode,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | null => {
  let expression = stripParenExpression(handlerExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer) return null;
    expression = stripParenExpression(binding.initializer);
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

const isEmptyReturn = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ReturnStatement") && statement.argument === null;

const isClosestEarlyReturn = (statement: EsTreeNode): boolean => {
  if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
  const consequent = statement.consequent;
  const hasEmptyReturn = isNodeOfType(consequent, "BlockStatement")
    ? consequent.body.length === 1 && isEmptyReturn(consequent.body[0] as EsTreeNode)
    : isEmptyReturn(consequent);
  if (!hasEmptyReturn) return false;
  const test = stripParenExpression(statement.test);
  const call = isNodeOfType(test, "ChainExpression") ? test.expression : test;
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 1) return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object as EsTreeNode)
    : null;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "closest" &&
    isNodeOfType(receiver, "MemberExpression") &&
    isNodeOfType(receiver.object, "Identifier") &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "target" &&
    isNodeOfType(call.arguments[0], "Literal") &&
    typeof call.arguments[0].value === "string"
  );
};

const isStaticSelectorExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "Literal")) return true;
  return (
    isNodeOfType(candidate, "TemplateLiteral") &&
    candidate.expressions.every((innerExpression) =>
      isStaticSelectorExpression(innerExpression as EsTreeNode),
    )
  );
};

const getDomQueryVariableName = (statement: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== 1
  ) {
    return null;
  }
  const declaration = statement.declarations[0];
  if (!declaration || !isNodeOfType(declaration.id, "Identifier") || !declaration.init) return null;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== 1 ||
    isNodeOfType(initializer.arguments[0], "SpreadElement") ||
    !isStaticSelectorExpression(initializer.arguments[0] as EsTreeNode)
  ) {
    return null;
  }
  const callee = stripParenExpression(initializer.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_QUERY_METHOD_NAMES.has(callee.property.name) ||
    !isGlobalDocumentExpression(callee.object as EsTreeNode, scopes)
  ) {
    return null;
  }
  return declaration.id.name;
};

const isFocusCallOnVariable = (statement: EsTreeNode, variableName: string): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression as EsTreeNode);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === variableName &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "focus" &&
    expression.arguments.length === 0
  );
};

const isConditionalFocusForwardingHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = stripParenExpression(attribute.value.expression as EsTreeNode);
  if (!isNodeOfType(expression, "ConditionalExpression")) return false;
  const consequent = stripParenExpression(expression.consequent as EsTreeNode);
  const alternate = stripParenExpression(expression.alternate as EsTreeNode);
  const nullishBranch = isNullishExpression(consequent) ? consequent : alternate;
  if (
    !isNullishExpression(nullishBranch) ||
    (isNodeOfType(nullishBranch, "Identifier") && !scopes.isGlobalReference(nullishBranch))
  ) {
    return false;
  }
  const handlerExpression = nullishBranch === consequent ? alternate : consequent;
  const handlerFunction = resolveHandlerFunctionExpression(handlerExpression);
  if (!handlerFunction || !isNodeOfType(handlerFunction.body, "BlockStatement")) return false;
  const [guard, query, focus, ...rest] = handlerFunction.body.body;
  if (!guard || !query || !focus || rest.length > 0 || !isClosestEarlyReturn(guard as EsTreeNode)) {
    return false;
  }
  const queryVariableName = getDomQueryVariableName(query as EsTreeNode, scopes);
  return Boolean(
    queryVariableName && isFocusCallOnVariable(focus as EsTreeNode, queryVariableName),
  );
};

// `onClick={() => inputRef.current?.focus()}` (and same-file named
// handlers with that shape) only forward focus to a real control
// keyboard users already reach via Tab — the wrapper isn't a
// keyboard-inaccessible action.
const isFocusForwardingHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (isConditionalFocusForwardingHandler(attribute, scopes)) return true;
  const handlerFunction = resolveHandlerFunction(attribute);
  return Boolean(
    handlerFunction &&
    isFocusForwardingFunctionBody((handlerFunction as { body?: EsTreeNode }).body ?? null),
  );
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
        if (onClick && isFocusForwardingHandler(onClick, context.scopes)) return;
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
        if (hasKeyboardActivatableDescendant(node.parent, null, context.scopes, context.settings)) {
          return;
        }
        if (
          onClick &&
          hasKeyboardActivatableDescendant(node.parent, onClick, context.scopes, context.settings)
        ) {
          return;
        }

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
