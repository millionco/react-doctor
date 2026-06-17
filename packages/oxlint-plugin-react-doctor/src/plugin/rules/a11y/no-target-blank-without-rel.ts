import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE =
  '`<a target="_blank">` without `rel="noopener"` lets the opened page script your tab via `window.opener` (reverse tabnabbing). Add `rel="noopener noreferrer"`.';

export const noTargetBlankWithoutRel = defineRule({
  id: "no-target-blank-without-rel",
  title: "target=_blank without rel=noopener",
  severity: "warn",
  recommendation:
    'Add `rel="noopener noreferrer"` to every `target="_blank"` link. `noopener` blocks reverse tabnabbing; `noreferrer` also strips the `Referer` header.',
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (tagName !== "a" && tagName !== "area") return;

      // A spread (`{...props}`) could supply `rel`; don't risk a false positive.
      if (hasJsxSpreadAttribute(node.attributes)) return;

      const targetAttribute = findJsxAttribute(node.attributes, "target");
      if (!targetAttribute || getStringLiteralAttributeValue(targetAttribute) !== "_blank") return;

      const relAttribute = findJsxAttribute(node.attributes, "rel");
      if (relAttribute) {
        const relValue = getStringLiteralAttributeValue(relAttribute);
        // Dynamic rel (`rel={rel}`) — assume it's handled; don't flag.
        if (relValue === null) return;
        const tokens = relValue.toLowerCase().split(/\s+/);
        if (tokens.includes("noopener") || tokens.includes("noreferrer")) return;
      }

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
