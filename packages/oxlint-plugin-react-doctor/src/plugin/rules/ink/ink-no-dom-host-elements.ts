import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isInsideInkJsxTree } from "../../utils/is-inside-ink-jsx-tree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const inkNoDomHostElements = defineRule({
  id: "ink-no-dom-host-elements",
  title: "DOM element used in an Ink tree",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Use Ink primitives such as `<Box>` and `<Text>` instead of DOM host elements.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || !HTML_TAGS.has(node.name.name)) return;
      if (!isInsideInkJsxTree(node.parent, context.scopes)) return;
      context.report({
        node,
        message: `DOM host \`<${node.name.name}>\` cannot be rendered by Ink.`,
      });
    },
  }),
});
