import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE =
  "Autoplaying media with sound is hostile to your users (and browsers block it). Add `muted` (with `playsInline`) to the autoplaying `<video>` / `<audio>`, or drop `autoPlay`.";

// Resolve a boolean JSX attribute to its static value, or null when it's
// dynamic: a bare attr (`autoPlay`) is true; `={true}`/`="true"` is true;
// `={false}`/`="false"` is false; anything else (`={shouldPlay}`) is null.
const resolveStaticBoolean = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean | null => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  const literal = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  if (isNodeOfType(literal, "Literal")) {
    if (literal.value === true || literal.value === "true") return true;
    if (literal.value === false || literal.value === "false") return false;
  }
  return null;
};

export const noAutoplayWithoutMuted = defineRule({
  id: "no-autoplay-without-muted",
  title: "Autoplaying media without muted",
  severity: "warn",
  recommendation:
    "Always pair `autoPlay` with `muted` (and `playsInline`): `<video autoPlay muted loop playsInline />`. If the sound matters, drop `autoPlay` and let users start it.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (tagName !== "video" && tagName !== "audio") return;

      // A spread (`{...props}`) could supply `muted`; don't risk a false positive.
      if (hasJsxSpreadAttribute(node.attributes)) return;

      const autoPlay = hasJsxPropIgnoreCase(node.attributes, "autoplay");
      // Only flag autoplay we can prove is on; dynamic `autoPlay={cond}` is skipped.
      if (!autoPlay || resolveStaticBoolean(autoPlay) !== true) return;

      const muted = hasJsxPropIgnoreCase(node.attributes, "muted");
      // muted absent → flag. muted present: only flag when it is provably
      // false; a truthy or dynamic `muted` gets the benefit of the doubt.
      if (muted && resolveStaticBoolean(muted) !== false) return;

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
