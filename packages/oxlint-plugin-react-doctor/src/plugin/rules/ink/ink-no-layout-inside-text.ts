import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findNearestInkJsxElement } from "../../utils/find-nearest-ink-jsx-element.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

const LAYOUT_COMPONENT_NAMES = new Set(["Box", "Spacer", "Static"]);
const TEXT_COMPONENT_NAMES = new Set(["Text", "Transform"]);

export const inkNoLayoutInsideText = defineRule({
  id: "ink-no-layout-inside-text",
  title: "Layout component nested in Ink Text",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.textLayoutGuard,
  recommendation: "Move Ink layout components outside `<Text>` and `<Transform>` boundaries.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveInkJsxElementName(node, context.scopes);
      if (!elementName || !LAYOUT_COMPONENT_NAMES.has(elementName) || !node.parent) return;
      const parentInkElementName = findNearestInkJsxElement(node.parent, context.scopes);
      if (!parentInkElementName || !TEXT_COMPONENT_NAMES.has(parentInkElementName)) return;
      context.report({
        node,
        message: `Ink \`<${elementName}>\` cannot render inside \`<${parentInkElementName}>\`.`,
      });
    },
  }),
});
