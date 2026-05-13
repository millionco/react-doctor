import { EXECUTABLE_SCRIPT_TYPES, SCRIPT_LOADING_ATTRIBUTES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const renderingScriptDeferAsync = defineRule<Rule>({
  recommendation:
    'Add `defer` for DOM-dependent scripts or `async` for independent ones (analytics). In Next.js, use `<Script strategy="afterInteractive" />` instead',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "script") return;

      const attributes = node.attributes ?? [];
      const hasSrc = attributes.some(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          attr.name.name === "src",
      );

      if (!hasSrc) return;

      const typeAttribute = attributes.find(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          attr.name.name === "type",
      );
      const typeValue = typeAttribute?.value?.type === "Literal" ? typeAttribute.value.value : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;
      if (typeValue === "module") return;

      const hasLoadingStrategy = attributes.some(
        (attr: EsTreeNode) =>
          attr.type === "JSXAttribute" &&
          attr.name?.type === "JSXIdentifier" &&
          SCRIPT_LOADING_ATTRIBUTES.has(attr.name.name),
      );

      if (!hasLoadingStrategy) {
        context.report({
          node,
          message:
            "<script src> without defer or async — blocks HTML parsing and delays First Contentful Paint. Add defer for DOM-dependent scripts or async for independent ones",
        });
      }
    },
  }),
});
