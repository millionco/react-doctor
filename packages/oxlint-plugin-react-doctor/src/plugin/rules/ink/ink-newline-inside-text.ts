import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findNearestInkJsxElement } from "../../utils/find-nearest-ink-jsx-element.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

const TEXT_COMPONENT_NAMES = new Set(["Text", "Transform"]);

export const inkNewlineInsideText = defineRule({
  id: "ink-newline-inside-text",
  title: "Ink Newline outside text",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Render `<Newline>` inside Ink's `<Text>` or `<Transform>` component.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveInkJsxElementName(node, context.scopes) !== "Newline" || !node.parent) return;
      const parentInkElementName = findNearestInkJsxElement(node.parent, context.scopes);
      if (!parentInkElementName || TEXT_COMPONENT_NAMES.has(parentInkElementName)) return;
      context.report({
        node,
        message: "Ink `<Newline>` only has text semantics inside `<Text>` or `<Transform>`.",
      });
    },
  }),
});
