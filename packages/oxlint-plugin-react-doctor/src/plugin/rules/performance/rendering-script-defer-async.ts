import { EXECUTABLE_SCRIPT_TYPES, SCRIPT_LOADING_ATTRIBUTES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Theme-init / runtime-env bootstrap scripts are deliberately
// render-blocking: they must run before first paint (FOUC prevention) or
// before any other script reads their globals. Deferring them breaks the
// reason they exist.
const RENDER_BLOCKING_BOOTSTRAP_SRC_PATTERN =
  /(?:^|\/)(?:theme[-_.]?init[^/]*|__env[^/]*|env[-_.]?config[^/]*|runtime[-_.]?env[^/]*)$/i;

// SSR HTML builders (Gatsby's `postBodyComponents`) place these scripts at
// the end of `<body>` — the document is fully parsed before they load, so
// they don't block rendering and their sync ordering is deliberate.
const POST_BODY_NAME_PATTERN = /postBody/i;

const isPostBodyPlacedScript = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "Property") &&
      isNodeOfType(cursor.key, "Identifier") &&
      POST_BODY_NAME_PATTERN.test(cursor.key.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "CallExpression") &&
      isNodeOfType(cursor.callee, "MemberExpression") &&
      isNodeOfType(cursor.callee.object, "Identifier") &&
      POST_BODY_NAME_PATTERN.test(cursor.callee.object.name)
    ) {
      return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

export const renderingScriptDeferAsync = defineRule({
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
      const srcAttribute = attributes.find(
        (attr: EsTreeNode) =>
          isNodeOfType(attr, "JSXAttribute") &&
          isNodeOfType(attr.name, "JSXIdentifier") &&
          attr.name.name === "src",
      );

      if (!srcAttribute) return;

      const srcAttributeValue = isNodeOfType(srcAttribute, "JSXAttribute")
        ? srcAttribute.value
        : null;
      const srcValue = isNodeOfType(srcAttributeValue, "Literal") ? srcAttributeValue.value : null;
      if (typeof srcValue === "string" && RENDER_BLOCKING_BOOTSTRAP_SRC_PATTERN.test(srcValue)) {
        return;
      }

      const hasNoModule = attributes.some(
        (attr: EsTreeNode) =>
          isNodeOfType(attr, "JSXAttribute") &&
          isNodeOfType(attr.name, "JSXIdentifier") &&
          attr.name.name === "noModule",
      );
      // Legacy-only polyfills: module-supporting browsers skip them
      // entirely, and legacy browsers need them before the app bundles.
      if (hasNoModule) return;

      if (isPostBodyPlacedScript(node)) return;

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
