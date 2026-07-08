import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isAbstractRole } from "../../utils/is-abstract-role.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonInteractiveElement } from "../../utils/is-non-interactive-element.js";
import { isNonInteractiveRole } from "../../utils/is-non-interactive-role.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";
import { isPureEventBlockerHandler } from "../../utils/is-pure-event-blocker-handler.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";

const MESSAGE =
  "Screen reader users can't tell this click handler is interactive because it has no `role`, so add a `role` or use a button or link.";

const DEFAULT_HANDLERS: ReadonlyArray<string> = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyPress",
  "onKeyDown",
  "onKeyUp",
];

// Keyboard handlers on an element that can't take focus and has no
// pointer handler only receive events BUBBLING from focusable
// descendants (Escape shortcuts, composite-widget delegation) — the
// element isn't itself presented as a control, so demanding a role is
// noise.
const KEYBOARD_HANDLERS_LOWER: ReadonlySet<string> = new Set([
  "onkeypress",
  "onkeydown",
  "onkeyup",
]);

interface NoStaticElementInteractionsSettings {
  handlers?: ReadonlyArray<string>;
  allowExpressionValues?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoStaticElementInteractionsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noStaticElementInteractions?: NoStaticElementInteractionsSettings })
          .noStaticElementInteractions ?? {})
      : {};
  return {
    handlers: ruleSettings.handlers ?? DEFAULT_HANDLERS,
    allowExpressionValues: ruleSettings.allowExpressionValues ?? true,
  };
};

// A keyboard event can only be DELIVERED to this element (rather than
// bubble through it) when it takes focus (any tabIndex, including the
// programmatic -1, or contentEditable) or doubles as a pointer target.
const isDirectKeyboardEventTarget = (
  attributes: EsTreeNodeOfType<"JSXOpeningElement">["attributes"],
  handlersLower: ReadonlySet<string>,
): boolean => {
  if (hasJsxPropIgnoreCase(attributes, "tabIndex")) return true;
  if (hasJsxPropIgnoreCase(attributes, "contentEditable")) return true;
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    if (!attributeName) continue;
    const nameLower = attributeName.toLowerCase();
    if (KEYBOARD_HANDLERS_LOWER.has(nameLower)) continue;
    if (!handlersLower.has(nameLower)) continue;
    if (isNullValue(attribute)) continue;
    return true;
  }
  return false;
};

const isStaticNullishExpression = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Literal")) return expression.value === null;
  if (isNodeOfType(expression, "Identifier")) return expression.name === "undefined";
  return isNodeOfType(expression, "UnaryExpression") && expression.operator === "void";
};

interface StaticRoleBranch {
  known: boolean;
  role: string | null;
}

const resolveStaticRoleBranch = (expression: EsTreeNode): StaticRoleBranch => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return { known: true, role: expression.value };
  }
  if (isStaticNullishExpression(expression)) return { known: true, role: null };
  return { known: false, role: null };
};

const isRecognizedRoleString = (roleText: string): boolean => {
  const firstRole = roleText.toLowerCase().trim().split(/\s+/)[0];
  return Boolean(firstRole && (isInteractiveRole(firstRole) || isNonInteractiveRole(firstRole)));
};

// True when the attribute value is `={null}`.
const isNullValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return false;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = attribute.value.expression;
  return (
    isNodeOfType(expression as EsTreeNode, "Literal") &&
    (expression as { value: unknown }).value === null
  );
};

// Port of `oxc_linter::rules::jsx_a11y::no_static_element_interactions`.
// Non-React JSX dialect skipping is handled by the `react-jsx-only`
// tag via `defineRule`.
export const noStaticElementInteractions = defineRule({
  id: "no-static-element-interactions",
  title: "Interaction on static element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Give clickable static elements a `role`, or use a button or link.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const handlersLower: ReadonlySet<string> = new Set(
      settings.handlers.map((handlerName) => handlerName.toLowerCase()),
    );
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        // Find any active handler — but pure event-blocker handlers
        // (`onClick={(e) => e.stopPropagation()}`) don't count as
        // "interactive": the element isn't a user-interaction target,
        // it's stopping a bubble. If EVERY active handler is a pure
        // blocker, the element is non-interactive and the rule should
        // pass through.
        let hasNonBlockerHandler = false;
        let hasAnyHandler = false;
        let isKeyboardTarget: boolean | null = null;
        // Only the FIRST attribute per handler name counts (mirrors the
        // per-handler `hasJsxPropIgnoreCase` first-match this replaces).
        let seenHandlerNames: Set<string> | null = null;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = getJsxAttributeName(attribute.name);
          if (!attributeName) continue;
          const handlerNameLower = attributeName.toLowerCase();
          if (!handlersLower.has(handlerNameLower)) continue;
          if (seenHandlerNames?.has(handlerNameLower)) continue;
          (seenHandlerNames ??= new Set()).add(handlerNameLower);
          if (isNullValue(attribute)) continue;
          if (KEYBOARD_HANDLERS_LOWER.has(handlerNameLower)) {
            isKeyboardTarget ??= isDirectKeyboardEventTarget(node.attributes, handlersLower);
            if (!isKeyboardTarget) continue;
          }
          hasAnyHandler = true;
          if (!isPureEventBlockerHandler(attribute)) {
            hasNonBlockerHandler = true;
            break;
          }
        }
        if (!hasAnyHandler) return;
        if (!hasNonBlockerHandler) return;

        const elementType = getElementType(node, context.settings);
        // Custom JSX elements pass through.
        if (!HTML_TAGS.has(elementType)) return;
        // <svg> has the implicit `graphics-document` role, so it isn't
        // static; upstream skips it too.
        if (elementType === "svg") return;
        if (isHiddenFromScreenReader(node, context.settings)) return;
        if (isPresentationRole(node)) return;
        if (isInteractiveElement(elementType, node)) return;
        if (isNonInteractiveElement(elementType, node)) return;
        if (isAbstractRole(node, context.settings)) return;

        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute || !roleAttribute.value) {
          context.report({ node: node.name, message: MESSAGE });
          return;
        }

        let attributeValue = roleAttribute.value as EsTreeNode;
        if (
          isNodeOfType(attributeValue, "JSXExpressionContainer") &&
          isNodeOfType(attributeValue.expression, "Literal") &&
          typeof attributeValue.expression.value === "string"
        ) {
          attributeValue = attributeValue.expression;
        }
        if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
          if (isRecognizedRoleString(attributeValue.value)) return;
          context.report({ node: node.name, message: MESSAGE });
          return;
        }
        if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
          if (!settings.allowExpressionValues) {
            context.report({ node: node.name, message: MESSAGE });
            return;
          }
          const expression = attributeValue.expression as EsTreeNode;
          // `role={undefined}` / `role={null}` render no role at all.
          if (isStaticNullishExpression(expression)) {
            context.report({ node: node.name, message: MESSAGE });
            return;
          }
          // `role={isClickable ? "button" : undefined}` — a role is
          // present exactly when the element acts as a control, so the
          // semantics are provided. Report only when EVERY statically
          // known branch is a non-role string or nullish.
          if (isNodeOfType(expression, "ConditionalExpression")) {
            const branches = [
              resolveStaticRoleBranch(expression.consequent as EsTreeNode),
              resolveStaticRoleBranch(expression.alternate as EsTreeNode),
            ];
            if (branches.some((branch) => !branch.known)) return;
            const providesRole = branches.some(
              (branch) => branch.role !== null && isRecognizedRoleString(branch.role),
            );
            if (providesRole) return;
            context.report({ node: node.name, message: MESSAGE });
            return;
          }
          // Any other expression computes the role at runtime — trust it.
          return;
        }
        context.report({ node: node.name, message: MESSAGE });
      },
    };
  },
});
