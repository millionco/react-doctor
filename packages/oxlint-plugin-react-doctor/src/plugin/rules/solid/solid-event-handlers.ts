import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface SolidEventHandlersSettings {
  ignoreCase?: boolean;
  warnOnSpread?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): SolidEventHandlersSettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  const solidSettings = (reactDoctor as { solidEventHandlers?: unknown }).solidEventHandlers;
  if (typeof solidSettings !== "object" || solidSettings === null) return {};
  return solidSettings as SolidEventHandlersSettings;
};

const COMMON_EVENTS: ReadonlyArray<string> = [
  "onAnimationEnd",
  "onAnimationIteration",
  "onAnimationStart",
  "onBeforeInput",
  "onBlur",
  "onChange",
  "onClick",
  "onContextMenu",
  "onCopy",
  "onCut",
  "onDblClick",
  "onDrag",
  "onDragEnd",
  "onDragEnter",
  "onDragExit",
  "onDragLeave",
  "onDragOver",
  "onDragStart",
  "onDrop",
  "onError",
  "onFocus",
  "onFocusIn",
  "onFocusOut",
  "onGotPointerCapture",
  "onInput",
  "onInvalid",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onLoad",
  "onLostPointerCapture",
  "onMouseDown",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
  "onMouseUp",
  "onPaste",
  "onPointerCancel",
  "onPointerDown",
  "onPointerEnter",
  "onPointerLeave",
  "onPointerMove",
  "onPointerOut",
  "onPointerOver",
  "onPointerUp",
  "onReset",
  "onScroll",
  "onSelect",
  "onSubmit",
  "onToggle",
  "onTouchCancel",
  "onTouchEnd",
  "onTouchMove",
  "onTouchStart",
  "onTransitionEnd",
  "onWheel",
];

const COMMON_EVENTS_BY_LOWERCASE_NAME = new Map<string, string>();
for (const event of COMMON_EVENTS) {
  COMMON_EVENTS_BY_LOWERCASE_NAME.set(event.toLowerCase(), event);
}

const NONSTANDARD_EVENT_BY_LOWERCASE_NAME: Record<string, string> = {
  ondoubleclick: "onDblClick",
};

const isDomElementName = (name: string): boolean => /^[a-z]/.test(name);

const isStaticStringOrNumberValue = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" || typeof node.value === "number";
  }
  if (isNodeOfType(node, "TemplateLiteral") && node.expressions.length === 0) return true;
  return false;
};

// Port of `solid/event-handlers` — Solid distinguishes
// `onclick` (DOM event property — invalid handler) from `onClick`
// (delegated event listener). Solid's compiler also inlines string
// values starting with `on`, so an attribute like `onClick="..."`
// becomes a string attribute, never a listener. We flag the most
// dangerous mismatches: nonstandard names (`onDoubleClick`),
// lowercase third character (`onfoo`), and static string values
// for handler-named props.
export const solidEventHandlers = defineRule<Rule>({
  id: "solid-event-handlers",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Use camelCase event names (`onClick`, not `onclick`). Solid distinguishes the two — only camelCase forms install listeners.",
  create: (context: RuleContext) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const opening = node.parent;
        if (!opening || !isNodeOfType(opening, "JSXOpeningElement")) return;
        if (!isNodeOfType(opening.name, "JSXIdentifier")) return;
        if (!isDomElementName(opening.name.name)) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const attributeName = node.name.name;
        if (!/^on[a-zA-Z]/.test(attributeName)) return;
        if (node.value && isNodeOfType(node.value, "JSXExpressionContainer")) {
          const expression = node.value.expression as EsTreeNode;
          if (
            !isNodeOfType(expression, "JSXEmptyExpression") &&
            !isNodeOfType(expression, "ArrayExpression") &&
            isStaticStringOrNumberValue(expression)
          ) {
            context.report({
              node,
              message: `The \`${attributeName}\` prop has a static string/number value, so Solid will treat it as a string attribute, not a handler. Rename it (or use \`attr:${attributeName}\`).`,
            });
            return;
          }
        } else if (node.value === null || (node.value && isNodeOfType(node.value, "Literal"))) {
          context.report({
            node,
            message: `The \`${attributeName}\` prop has a literal value, so Solid will treat it as a string attribute, not a handler.`,
          });
          return;
        }
        if (settings.ignoreCase) return;
        const lowercaseName = attributeName.toLowerCase();
        const nonstandardName = NONSTANDARD_EVENT_BY_LOWERCASE_NAME[lowercaseName];
        if (nonstandardName) {
          context.report({
            node: node.name,
            message: `\`${attributeName}\` is non-standard — rename to \`${nonstandardName}\`.`,
          });
          return;
        }
        const commonName = COMMON_EVENTS_BY_LOWERCASE_NAME.get(lowercaseName);
        if (commonName && commonName !== attributeName) {
          context.report({
            node: node.name,
            message: `\`${attributeName}\` should be renamed to \`${commonName}\` for readability.`,
          });
          return;
        }
        if (attributeName[2] === attributeName[2].toLowerCase()) {
          const handlerName = `on${attributeName[2].toUpperCase()}${attributeName.slice(3)}`;
          context.report({
            node: node.name,
            message: `The \`${attributeName}\` prop is ambiguous. Use \`${handlerName}\` for an event handler, or \`attr:${attributeName}\` for an attribute.`,
          });
        }
      },
      Property(node: EsTreeNodeOfType<"Property">) {
        if (!settings.warnOnSpread) return;
        const objectExpression = node.parent;
        if (!objectExpression || !isNodeOfType(objectExpression, "ObjectExpression")) return;
        const spreadAttribute = objectExpression.parent;
        if (!spreadAttribute || !isNodeOfType(spreadAttribute, "JSXSpreadAttribute")) return;
        const opening = spreadAttribute.parent;
        if (!opening || !isNodeOfType(opening, "JSXOpeningElement")) return;
        if (!isNodeOfType(opening.name, "JSXIdentifier")) return;
        if (!isDomElementName(opening.name.name)) return;
        if (!isNodeOfType(node.key, "Identifier")) return;
        if (!/^on/.test(node.key.name)) return;
        context.report({
          node,
          message: `The \`${node.key.name}\` prop should be set as a JSX attribute, not spread in. Solid doesn't add listeners when spreading into JSX.`,
        });
      },
    };
  },
});
