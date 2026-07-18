import { EXECUTABLE_SCRIPT_TYPES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasEnabledBooleanAttribute = (attributes: EsTreeNode[], attributeName: string): boolean => {
  const attribute = findJsxAttribute(attributes, attributeName);
  if (!attribute) return false;
  if (attribute.value === null) return true;
  if (isNodeOfType(attribute.value, "Literal")) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  return (
    isNodeOfType(attribute.value.expression, "Literal") && Boolean(attribute.value.expression.value)
  );
};

export const nextjsNoNativeScript = defineRule({
  id: "nextjs-no-native-script",
  title: "Plain script can block Next.js rendering",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    'Use `next/script` with `strategy="afterInteractive"` or `"lazyOnload"` so third-party scripts do not block rendering.',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "script") return;

      const typeAttribute = findJsxAttribute(node.attributes ?? [], "type");
      const typeValue = isNodeOfType(typeAttribute?.value, "Literal")
        ? typeAttribute.value.value
        : null;
      if (typeof typeValue === "string" && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;

      // `async` / `defer` / `type="module"` scripts never block rendering,
      // so the message's premise doesn't hold — same exemptions as
      // `no-undeferred-third-party`.
      if (hasEnabledBooleanAttribute(node.attributes ?? [], "async")) return;
      if (hasEnabledBooleanAttribute(node.attributes ?? [], "defer")) return;
      if (typeValue === "module") return;

      // Inline scripts (dangerouslySetInnerHTML, no src) are render-blocking
      // by design — theme/env bootstraps must run before first paint, and
      // next/script cannot guarantee pre-paint execution. Only external
      // scripts have a loading strategy to miss.
      const hasSrcAttribute = Boolean(findJsxAttribute(node.attributes ?? [], "src"));
      const hasInlineHtml = Boolean(
        findJsxAttribute(node.attributes ?? [], "dangerouslySetInnerHTML"),
      );
      if (hasInlineHtml && !hasSrcAttribute) return;

      context.report({
        node,
        message: "Plain <script> has no Next.js loading strategy, so it can block rendering.",
      });
    },
  }),
});
