import { EXECUTABLE_SCRIPT_TYPES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { resolveStaticJsxAttribute } from "../../utils/resolve-static-jsx-attribute.js";
import type { StaticJsxAttributeResolution } from "../../utils/resolve-static-jsx-attribute.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getScriptAttributeExpression = (
  resolution: StaticJsxAttributeResolution,
): EsTreeNode | null => {
  if (resolution.expression) return resolution.expression;
  if (!resolution.attribute?.value) return null;
  return isNodeOfType(resolution.attribute.value, "JSXExpressionContainer")
    ? resolution.attribute.value.expression
    : resolution.attribute.value;
};

const getStaticScriptAttributeString = (resolution: StaticJsxAttributeResolution): string | null =>
  getStaticStringExpression(getScriptAttributeExpression(resolution));

const hasEnabledBooleanAttribute = (resolution: StaticJsxAttributeResolution): boolean => {
  if (!resolution.isPresent) return false;
  if (resolution.attribute && !resolution.attribute.value) return true;
  if (resolution.attribute && isNodeOfType(resolution.attribute.value, "Literal")) return true;
  const expression = getScriptAttributeExpression(resolution);
  if (!expression) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    if (candidate.value === null) return false;
    return Boolean(candidate.value);
  }
  return false;
};

const attributeHasRuntimeValue = (
  resolution: StaticJsxAttributeResolution,
  context: RuleContext,
): boolean => {
  if (!resolution.isPresent) return false;
  if (resolution.attribute && !resolution.attribute.value) return true;
  const expression = getScriptAttributeExpression(resolution);
  if (!expression) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    return candidate.value !== null && candidate.value !== false;
  }
  if (isLiteralVoidExpression(candidate)) return false;
  if (
    isNodeOfType(candidate, "Identifier") &&
    candidate.name === "undefined" &&
    context.scopes.isGlobalReference(candidate)
  ) {
    return false;
  }
  return true;
};

const isNextHeadElement = (candidate: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(candidate, "JSXElement") ||
    !isNodeOfType(candidate.openingElement.name, "JSXIdentifier")
  ) {
    return false;
  }
  const elementName = candidate.openingElement.name;
  if (elementName.name === "head") return true;
  const resolvedSymbol = context.scopes.referenceFor(elementName)?.resolvedSymbol;
  if (resolvedSymbol?.kind !== "import") return false;
  const importBinding = getImportBindingForName(elementName, resolvedSymbol.name);
  return importBinding?.source === "next/head" && importBinding.exportedName === "default";
};

const isInsideDocumentHead = (openingElement: EsTreeNode, context: RuleContext): boolean => {
  let ancestorNode = openingElement.parent?.parent;
  while (ancestorNode) {
    if (isNodeOfType(ancestorNode, "JSXAttribute")) return false;
    if (isNextHeadElement(ancestorNode, context)) return true;
    ancestorNode = ancestorNode.parent ?? null;
  }
  return false;
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

      const typeAttribute = resolveStaticJsxAttribute(node.attributes, "type", false);
      if (typeAttribute.isUnknown) return;
      const typeValue = getStaticScriptAttributeString(typeAttribute)?.trim().toLowerCase() ?? null;
      if (typeValue !== null && !EXECUTABLE_SCRIPT_TYPES.has(typeValue)) return;

      const blockingAttribute = resolveStaticJsxAttribute(node.attributes, "blocking", false);
      const blockingValue = getStaticScriptAttributeString(blockingAttribute);
      const hasRenderBlockingToken =
        blockingValue
          ?.toLowerCase()
          .split(/\s+/)
          .some((token) => token === "render") ?? false;
      const hasExplicitRenderBlocking =
        hasRenderBlockingToken && isInsideDocumentHead(node, context);
      if (!hasExplicitRenderBlocking) {
        const asyncAttribute = resolveStaticJsxAttribute(node.attributes, "async", false);
        const deferAttribute = resolveStaticJsxAttribute(node.attributes, "defer", false);
        if (asyncAttribute.isUnknown || deferAttribute.isUnknown) return;
        if (hasEnabledBooleanAttribute(asyncAttribute)) return;
        if (hasEnabledBooleanAttribute(deferAttribute)) return;
        if (typeValue === "module") return;
      }

      const srcAttribute = resolveStaticJsxAttribute(node.attributes, "src", false);
      const inlineHtmlAttribute = resolveStaticJsxAttribute(
        node.attributes,
        "dangerouslySetInnerHTML",
      );
      if (srcAttribute.isUnknown) return;
      const hasSrcAttribute = attributeHasRuntimeValue(srcAttribute, context);
      if (!hasSrcAttribute && inlineHtmlAttribute.isUnknown) return;
      const hasInlineHtml = attributeHasRuntimeValue(inlineHtmlAttribute, context);
      if (srcAttribute.isPresent && !hasSrcAttribute && !hasInlineHtml) return;
      if (hasInlineHtml && !hasSrcAttribute) return;

      context.report({
        node,
        message: "Plain <script> has no Next.js loading strategy, so it can block rendering.",
      });
    },
  }),
});
