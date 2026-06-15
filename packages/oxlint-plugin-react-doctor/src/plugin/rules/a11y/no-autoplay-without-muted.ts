import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE =
  "Autoplaying media with sound is hostile to your users (and browsers block it). Add `muted` (with `playsInline`) to the autoplaying `<video>` / `<audio>`, or drop `autoPlay`.";

// Statically true: bare attr (`autoPlay`), `={true}`, or `="true"`.
const isStaticallyTrue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  if (isNodeOfType(value, "Literal")) return value.value === "true";
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      return expression.value === true || expression.value === "true";
    }
  }
  return false;
};

// Statically false: `={false}` or `="false"`.
const isStaticallyFalse = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return false;
  if (isNodeOfType(value, "Literal")) return value.value === "false";
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      return expression.value === false || expression.value === "false";
    }
  }
  return false;
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
      if (!autoPlay || !isStaticallyTrue(autoPlay)) return;

      const muted = hasJsxPropIgnoreCase(node.attributes, "muted");
      // muted absent → flag. muted present: only flag when it is provably
      // false; a truthy or dynamic `muted` gets the benefit of the doubt.
      if (muted && !isStaticallyFalse(muted)) return;

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
