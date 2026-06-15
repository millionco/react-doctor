import { defineRule } from "../../utils/define-rule.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  "This `<img>` sets no `width`/`height` and no CSS sizing, so the browser reserves no space for it and the page reflows when it loads (layout shift / CLS). Add `width` and `height` attributes, or size it with CSS.";

// Conservative v1: only the "naked" `<img src=...>` with no `width`, no
// `height`, AND no `className`/`style` is flagged. The moment any sizing hook
// is present (an explicit dimension attribute, a class, or an inline style) we
// assume the author sized it deliberately — CSS aspect-ratio, Tailwind `w-*`/
// `h-*`, etc. — and stay quiet. A spread could supply any of these, so bail.
export const imgMissingDimensions = defineRule({
  id: "img-missing-dimensions",
  title: "Image missing dimensions",
  severity: "warn",
  recommendation:
    "Give every `<img>` an intrinsic `width` and `height` (or size it with CSS) so the browser can reserve space before the image loads and avoid layout shift.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return;
      if (hasJsxSpreadAttribute(node.attributes)) return;

      if (!hasJsxPropIgnoreCase(node.attributes, "src")) return;
      if (hasJsxPropIgnoreCase(node.attributes, "width")) return;
      if (hasJsxPropIgnoreCase(node.attributes, "height")) return;
      if (hasJsxPropIgnoreCase(node.attributes, "className")) return;
      if (hasJsxPropIgnoreCase(node.attributes, "style")) return;
      // Responsive images (`srcSet`/`sizes`) are intentionally fluid-width and
      // sized by the layout, so a missing intrinsic width/height is expected.
      if (hasJsxPropIgnoreCase(node.attributes, "srcSet")) return;
      if (hasJsxPropIgnoreCase(node.attributes, "sizes")) return;

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
