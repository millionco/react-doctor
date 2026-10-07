import {
  LONG_DISPLAY_HEADING_MIN_CHARACTERS,
  OVERSIZED_DISPLAY_HEADING_MIN_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStaticEffectiveFontSize } from "./utils/get-static-effective-font-size.js";

export const noOversizedLongHeading = defineRule({
  id: "no-oversized-long-heading",
  title: "Long headline uses an oversized display scale",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reduce the display size for sentence-length headlines, or tighten the copy before using a hero scale.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        !isNodeOfType(openingElement.name, "JSXIdentifier") ||
        openingElement.name.name !== "h1"
      ) {
        return;
      }
      const headingText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (headingText.length < LONG_DISPLAY_HEADING_MIN_CHARACTERS) return;

      const fontSizePx = getStaticEffectiveFontSize(
        openingElement,
        hasCapabilityOrUnspecified(context.settings, "tailwind"),
      );
      if (fontSizePx === null || fontSizePx < OVERSIZED_DISPLAY_HEADING_MIN_PX) return;
      context.report({
        node: openingElement,
        message:
          "This sentence-length headline is set at a hero display scale and can dominate the viewport. Reduce the size or shorten the copy.",
      });
    },
  }),
});
