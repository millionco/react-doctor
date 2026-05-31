import { EXECUTABLE_SCRIPT_TYPES, SCRIPT_LOADING_ATTRIBUTES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const renderingScriptDeferAsync = defineRule<Rule>({
  id: "rendering-script-defer-async",
  title: "Script without defer or async",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    'Add `defer` for scripts that need the page, or `async` for standalone ones like analytics. In Next.js, use `<Script strategy="afterInteractive" />`',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "script") return;

      const attributes = node.attributes ?? [];
      const hasSrc = attributes.some(
        (attr: EsTreeNode) =>
          isNodeOfType(attr, "JSXAttribute") &&
          isNodeOfType(attr.name, "JSXIdentifier") &&
          attr.name.name === "src",
      );

      if (!hasSrc) return;

      const typeAttribute = attributes.find(
        (attr) =>
          isNodeOfType(attr, "JSXAttribute") &&
          isNodeOfType(attr.name, "JSXIdentifier") &&
          attr.name.name === "type",
      );
      const typeAttributeValue =
        typeAttribute && isNodeOfType(typeAttribute, "JSXAttribute") ? typeAttribute.value : null;
      const typeValue = isNodeOfType(typeAttributeValue, "Literal")
        ? typeAttributeValue.value
        : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;
      if (typeValue === "module") return;

      const hasLoadingStrategy = attributes.some(
        (attr: EsTreeNode) =>
          isNodeOfType(attr, "JSXAttribute") &&
          isNodeOfType(attr.name, "JSXIdentifier") &&
          SCRIPT_LOADING_ATTRIBUTES.has(attr.name.name),
      );

      if (!hasLoadingStrategy) {
        context.report({
          node,
          message:
            "This blocks the page from loading until the script downloads because <script src> has no defer or async, so add defer for scripts that need the page, or async for standalone ones",
        });
      }
    },
  }),
});
