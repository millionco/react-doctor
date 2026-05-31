import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isPureEventBlockerHandler } from "../../utils/is-pure-event-blocker-handler.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const PRESENTATION_ROLES: ReadonlySet<string> = new Set(["presentation", "none"]);

const MESSAGE =
  "Keyboard users can't trigger this click handler because there's no keyboard one, so add `onKeyUp`, `onKeyDown`, or `onKeyPress`.";

const KEY_HANDLERS = ["onKeyUp", "onKeyDown", "onKeyPress"] as const;

// Port of `oxc_linter::rules::jsx_a11y::click_events_have_key_events`.
// Flags elements with `onClick` that lack a keyboard handler — only
// applies to non-interactive HTML elements (interactive ones already
// support keyboard activation). Non-React JSX dialect skipping is
// handled by the `react-jsx-only` tag via `defineRule`.
export const clickEventsHaveKeyEvents = defineRule<Rule>({
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
        const tag = getElementType(node, context.settings);
        if (!HTML_TAGS.has(tag)) return;
        if (isInteractiveElement(tag, node)) return;
        const onClick = hasJsxPropIgnoreCase(node.attributes, "onClick");
        if (!onClick) return;
        if (isPureEventBlockerHandler(onClick)) return;

        if (isHiddenFromScreenReader(node, context.settings)) return;

        // Presentational role (presentation / none) → not perceivable
        // by AT, so skip.
        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (roleAttribute) {
          const roleValue = getJsxPropStringValue(roleAttribute);
          if (roleValue && PRESENTATION_ROLES.has(roleValue)) return;
        }
        const hasKeyHandler = KEY_HANDLERS.some((handler) =>
          hasJsxPropIgnoreCase(node.attributes, handler),
        );
        if (hasKeyHandler) return;

        context.report({ node: node.name, message: MESSAGE });
      },
    };
  },
});
