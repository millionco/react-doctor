import { EXECUTABLE_SCRIPT_TYPES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasJsxAttribute } from "../../utils/has-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noUndeferredThirdParty = defineRule({
  id: "no-undeferred-third-party",
  title: "Render-blocking third-party script",
  tags: ["test-noise"],
  severity: "warn",
  recommendation: 'Use `next/script` with `strategy="lazyOnload"`, or add the `defer` attribute.',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "script") return;
      const attributes = node.attributes ?? [];
      if (!findJsxAttribute(attributes, "src")) return;

      // `type="module"` scripts are deferred by default, and any
      // non-executable `type` (e.g. JSON, importmap) never blocks
      // rendering — neither needs `defer`/`async`.
      const typeAttribute = findJsxAttribute(attributes, "type");
      const typeValue =
        typeAttribute && isNodeOfType(typeAttribute.value, "Literal")
          ? typeAttribute.value.value
          : null;
      if (typeValue === "module") return;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;

      if (!hasJsxAttribute(attributes, "defer") && !hasJsxAttribute(attributes, "async")) {
        context.report({
          node,
          message:
            "This <script> blocks the page from showing to your users until it loads. Add defer or async so it loads in the background.",
        });
      }
    },
  }),
});
