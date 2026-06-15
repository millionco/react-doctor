import { defineRule } from "../../utils/define-rule.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MESSAGE =
  '`<img loading="lazy">` defers the request while `fetchPriority="high"` asks the browser to rush it, so the two directives contradict each other. Drop one: keep `fetchPriority="high"` (and eager loading) for an LCP image, or `loading="lazy"` for a below-the-fold one.';

export const noImgLazyWithHighFetchpriority = defineRule({
  id: "no-img-lazy-with-high-fetchpriority",
  title: "Lazy image with high fetchPriority",
  severity: "warn",
  recommendation:
    'Don\'t combine `loading="lazy"` with `fetchPriority="high"`. A high-priority image (usually the LCP) should load eagerly; a lazy image is by definition not high priority.',
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "img") return;

      const loadingAttribute = hasJsxPropIgnoreCase(node.attributes, "loading");
      if (!loadingAttribute || getJsxPropStringValue(loadingAttribute)?.toLowerCase() !== "lazy") {
        return;
      }

      const fetchPriorityAttribute = hasJsxPropIgnoreCase(node.attributes, "fetchPriority");
      if (
        !fetchPriorityAttribute ||
        getJsxPropStringValue(fetchPriorityAttribute)?.toLowerCase() !== "high"
      ) {
        return;
      }

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
