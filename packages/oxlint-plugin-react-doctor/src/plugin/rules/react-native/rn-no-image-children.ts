import { defineRule } from "../../utils/define-rule.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A child counts only if it would actually try to render content. We skip
// whitespace-only `JSXText`, `{/* comments */}` (JSXEmptyExpression), and
// the conditional-render escape hatches `{null}` / `{false}` / `{undefined}`,
// which produce nothing — matching what RN's `Image` silently drops anyway.
const isMeaningfulImageChild = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment")) return true;
  if (isNodeOfType(child, "JSXText")) return (child.value ?? "").trim().length > 0;
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    const expression = child.expression;
    if (isNodeOfType(expression, "JSXEmptyExpression")) return false;
    if (
      isNodeOfType(expression, "Literal") &&
      (expression.value === null || expression.value === false)
    ) {
      return false;
    }
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return false;
    return true;
  }
  return false;
};

// HACK: React Native's `<Image>` does not render children — the
// documented way to layer content over an image is `<ImageBackground>`.
// Passing children to `<Image>` makes them silently disappear at runtime
// (no error). We resolve the JSX element name back to the `Image` export
// of `react-native` specifically, so `expo-image`'s `<Image>` (which is a
// different component) and any same-named local/custom `Image` never trip
// the rule — the OSS corpus showed `next/image` and Skia's `<Image>` are
// the dominant same-name false positives.
export const rnNoImageChildren = defineRule<Rule>({
  id: "rn-no-image-children",
  title: "Children inside react-native <Image>",
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "React Native's `<Image>` can't render children. Use `<ImageBackground>` (same `source`/`style` props) to layer content over an image.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (!openingElement) return;
      const localName = resolveJsxElementName(openingElement);
      if (!localName) return;
      if (getImportedNameFromModule(openingElement, localName, "react-native") !== "Image") return;
      if (!(node.children ?? []).some(isMeaningfulImageChild)) return;
      context.report({
        node: openingElement,
        message:
          "React Native's <Image> does not render children, so this content silently disappears. Use <ImageBackground> to layer content over an image.",
      });
    },
  }),
});
