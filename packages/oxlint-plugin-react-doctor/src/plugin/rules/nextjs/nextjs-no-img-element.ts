import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { createExportedJsxGeneratedImageOwnershipAnalyzer } from "../../utils/is-exported-jsx-owned-by-generated-image-renderers.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const NON_OPTIMIZABLE_SRC_PREFIX_PATTERN = /^\s*(data:|blob:)/i;
const GENERATED_URL_NAME_PATTERN = /(data|object|blob)_?url/i;
const LOCAL_IMAGE_URL_FACTORY_METHODS = new Set<string>([
  "createObjectURL",
  "revokeObjectURL",
  "toDataURL",
]);

const localImageUrlFactoryCache = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

const usesLocalImageUrlFactory = (programRoot: EsTreeNodeOfType<"Program">): boolean => {
  const cached = localImageUrlFactoryCache.get(programRoot);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(programRoot, (descendantNode) => {
    if (found) return false;
    if (!isNodeOfType(descendantNode, "MemberExpression")) return;
    const property = descendantNode.property;
    if (!isNodeOfType(property, "Identifier")) return;
    if (!LOCAL_IMAGE_URL_FACTORY_METHODS.has(property.name)) return;
    found = true;
    return false;
  });
  localImageUrlFactoryCache.set(programRoot, found);
  return found;
};

// Analytics tracking pixels must be fetched by the visitor's browser from
// the vendor host; proxying through the next/image optimizer server-side
// destroys the tracking semantics (the doc's third-party-embed carve-out).
const TRACKING_PIXEL_HOST_PATTERN = /^https:\/\/[^/]*\bscarf\.sh\//i;

const isNonOptimizableSrcString = (srcValue: string): boolean => {
  if (NON_OPTIMIZABLE_SRC_PREFIX_PATTERN.test(srcValue)) return true;
  if (TRACKING_PIXEL_HOST_PATTERN.test(srcValue)) return true;
  const pathname = srcValue.split(/[?#]/)[0] ?? "";
  return pathname.toLowerCase().endsWith(".svg");
};

const referencesGeneratedUrlName = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Identifier")) {
    return GENERATED_URL_NAME_PATTERN.test(unwrapped.name);
  }
  if (isNodeOfType(unwrapped, "MemberExpression")) {
    const property = unwrapped.property;
    return isNodeOfType(property, "Identifier") && GENERATED_URL_NAME_PATTERN.test(property.name);
  }
  if (isNodeOfType(unwrapped, "ConditionalExpression")) {
    return (
      referencesGeneratedUrlName(unwrapped.consequent) ||
      referencesGeneratedUrlName(unwrapped.alternate)
    );
  }
  if (isNodeOfType(unwrapped, "LogicalExpression")) {
    return (
      referencesGeneratedUrlName(unwrapped.left) || referencesGeneratedUrlName(unwrapped.right)
    );
  }
  if (isNodeOfType(unwrapped, "CallExpression")) {
    const callee = stripParenExpression(unwrapped.callee);
    if (isNodeOfType(callee, "Identifier")) {
      return GENERATED_URL_NAME_PATTERN.test(callee.name);
    }
    if (isNodeOfType(callee, "MemberExpression")) {
      const property = callee.property;
      return isNodeOfType(property, "Identifier") && GENERATED_URL_NAME_PATTERN.test(property.name);
    }
  }
  return false;
};

const getStaticSrcValue = (expression: EsTreeNode): string | null => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Literal") && typeof unwrapped.value === "string") {
    return unwrapped.value;
  }
  if (isNodeOfType(unwrapped, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(unwrapped);
  }
  return null;
};

const isNonOptimizableTemplateSrc = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (!isNodeOfType(unwrapped, "TemplateLiteral")) return false;
  const firstQuasiValue = unwrapped.quasis[0]?.value.cooked ?? "";
  if (NON_OPTIMIZABLE_SRC_PREFIX_PATTERN.test(firstQuasiValue)) return true;
  const lastQuasiValue = unwrapped.quasis[unwrapped.quasis.length - 1]?.value.cooked ?? "";
  const trailingPathname = lastQuasiValue.split(/[?#]/)[0] ?? "";
  return trailingPathname.toLowerCase().endsWith(".svg");
};

const isNonOptimizableSrcAttribute = (
  srcAttribute: EsTreeNodeOfType<"JSXAttribute">,
  programRoot: EsTreeNodeOfType<"Program"> | null,
): boolean => {
  const literalValue = getJsxPropStringValue(srcAttribute);
  if (literalValue !== null) return isNonOptimizableSrcString(literalValue);

  const value = srcAttribute.value;
  if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return false;
  const expression = value.expression;

  const staticValue = getStaticSrcValue(expression);
  if (staticValue !== null) return isNonOptimizableSrcString(staticValue);

  if (isNonOptimizableTemplateSrc(expression)) return true;
  if (referencesGeneratedUrlName(expression)) return true;
  return Boolean(programRoot && usesLocalImageUrlFactory(programRoot));
};

// An <img> returned from the `img:` entry of a renderer's `components` map
// (ReactMarkdown, MDXProvider) must stay a native img: the renderer feeds it
// arbitrary author-supplied URLs that next/image's loader cannot resolve —
// the doc's markdown-renderer carve-out.
const isMarkdownImgComponentOverride = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "Property")) {
      const key = cursor.key;
      const keyName = isNodeOfType(key, "Identifier")
        ? key.name
        : isNodeOfType(key, "Literal") && typeof key.value === "string"
          ? key.value
          : null;
      if (keyName === "img") {
        let outer: EsTreeNode | null | undefined = cursor.parent;
        while (outer) {
          if (isNodeOfType(outer, "JSXAttribute")) {
            return isNodeOfType(outer.name, "JSXIdentifier") && outer.name.name === "components";
          }
          outer = outer.parent ?? null;
        }
        return false;
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

export const nextjsNoImgElement = defineRule({
  id: "nextjs-no-img-element",
  title: "Plain img ships unoptimized images",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Use `next/image` so users get optimized formats, responsive srcsets, and lazy loading instead of oversized image downloads.",
  create: (context: RuleContext): RuleVisitors => {
    if (isGeneratedImageRenderContext(context)) return {};
    const generatedImageOwnershipByFunction = new WeakMap<EsTreeNode, boolean>();
    const isExportedJsxGeneratedImageOwned =
      createExportedJsxGeneratedImageOwnershipAnalyzer(context);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (resolveJsxElementType(node) !== "img") return;
        if (isGeneratedImageRenderContext(context, node)) return;

        const enclosingFunction = findEnclosingFunction(node);
        if (enclosingFunction) {
          let isGeneratedImageOwned = generatedImageOwnershipByFunction.get(enclosingFunction);
          if (isGeneratedImageOwned === undefined) {
            isGeneratedImageOwned = isExportedJsxGeneratedImageOwned(node);
            generatedImageOwnershipByFunction.set(enclosingFunction, isGeneratedImageOwned);
          }
          if (isGeneratedImageOwned) return;
        }

        const programRoot = findProgramRoot(node);
        if (programRoot && hasEmailTemplateImport(programRoot)) return;

        const srcAttribute = findJsxAttribute(node.attributes, "src");
        if (srcAttribute && isNonOptimizableSrcAttribute(srcAttribute, programRoot)) return;
        if (!srcAttribute && findJsxAttribute(node.attributes, "ref")) return;
        if (isMarkdownImgComponentOverride(node)) return;

        context.report({
          node,
          message: "Plain <img> ships unoptimized, oversized images.",
        });
      },
    };
  },
});
