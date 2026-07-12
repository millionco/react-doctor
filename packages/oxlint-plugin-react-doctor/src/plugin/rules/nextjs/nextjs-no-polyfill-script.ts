import { POLYFILL_SCRIPT_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const ABSOLUTE_URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export const nextjsNoPolyfillScript = defineRule({
  id: "nextjs-no-polyfill-script",
  title: "Redundant polyfill script",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Next.js includes polyfills for fetch, Promise, Object.assign, Array.from, and 50+ others automatically",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementType(node);
      if (elementName !== "script" && elementName !== "Script") return;

      const srcAttribute = findJsxAttribute(node.attributes ?? [], "src");
      if (!srcAttribute?.value) return;

      const srcValue = isNodeOfType(srcAttribute.value, "Literal")
        ? srcAttribute.value.value
        : null;

      const requestUrl = typeof srcValue === "string" ? srcValue.split("#", 1)[0] : null;
      const requestScheme = requestUrl
        ?.trimStart()
        .match(ABSOLUTE_URL_SCHEME_PATTERN)?.[0]
        .toLowerCase();

      if (
        requestUrl &&
        (!requestScheme || requestScheme === "http:" || requestScheme === "https:") &&
        POLYFILL_SCRIPT_PATTERN.test(requestUrl)
      ) {
        context.report({
          node,
          message:
            "This polyfill CDN script makes your users download polyfills Next.js already includes.",
        });
      }
    },
  }),
});
