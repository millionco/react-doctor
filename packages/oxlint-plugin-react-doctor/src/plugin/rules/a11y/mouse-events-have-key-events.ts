import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxProp } from "../../utils/has-jsx-prop.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMissingFocusMessage = (handler: string): string =>
  `Keyboard users miss this \`${handler}\` because it only fires with a mouse, so add an \`onFocus\` handler too.`;
const buildMissingBlurMessage = (handler: string): string =>
  `Keyboard users miss this \`${handler}\` because it only fires with a mouse, so add an \`onBlur\` handler too.`;

interface MouseEventsHaveKeyEventsSettings {
  hoverInHandlers?: ReadonlyArray<string>;
  hoverOutHandlers?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<MouseEventsHaveKeyEventsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { mouseEventsHaveKeyEvents?: MouseEventsHaveKeyEventsSettings })
          .mouseEventsHaveKeyEvents ?? {})
      : {};
  return {
    hoverInHandlers: ruleSettings.hoverInHandlers ?? ["onMouseOver"],
    hoverOutHandlers: ruleSettings.hoverOutHandlers ?? ["onMouseOut"],
  };
};

const isExplicitUndefinedExpression = (value: EsTreeNode): boolean => {
  if (!isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = value.expression;
  return (
    isNodeOfType(expression as EsTreeNode, "Identifier") &&
    (expression as { name: string }).name === "undefined"
  );
};

// Port of `oxc_linter::rules::jsx_a11y::mouse_events_have_key_events`.
export const mouseEventsHaveKeyEvents = defineRule<Rule>({
  id: "mouse-events-have-key-events",
  title: "Mouse handler missing focus handler",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Pair mouse events with keyboard ones so keyboard users are not left out.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);
        if (!HTML_TAGS.has(tag)) return;

        for (const handler of settings.hoverInHandlers) {
          const handlerAttribute = hasJsxProp(node.attributes, handler);
          if (!handlerAttribute) continue;
          if (!handlerAttribute.value) continue; // bare attr → no handler bound, skip
          const focusAttribute = hasJsxProp(node.attributes, "onFocus");
          if (!focusAttribute) {
            context.report({ node: handlerAttribute, message: buildMissingFocusMessage(handler) });
          } else if (
            focusAttribute.value &&
            isExplicitUndefinedExpression(focusAttribute.value as EsTreeNode)
          ) {
            context.report({ node: handlerAttribute, message: buildMissingFocusMessage(handler) });
          }
          break;
        }

        for (const handler of settings.hoverOutHandlers) {
          const handlerAttribute = hasJsxProp(node.attributes, handler);
          if (!handlerAttribute) continue;
          if (!handlerAttribute.value) continue;
          const blurAttribute = hasJsxProp(node.attributes, "onBlur");
          if (!blurAttribute) {
            context.report({ node: handlerAttribute, message: buildMissingBlurMessage(handler) });
          } else if (
            blurAttribute.value &&
            isExplicitUndefinedExpression(blurAttribute.value as EsTreeNode)
          ) {
            context.report({ node: handlerAttribute, message: buildMissingBlurMessage(handler) });
          }
          break;
        }
      },
    };
  },
});
