import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { createRemotionRenderEvidenceChecker } from "../../utils/create-remotion-render-evidence-checker.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveRemotionApi } from "../../utils/resolve-remotion-api.js";
import { walkAst } from "../../utils/walk-ast.js";

const CSS_URL_ASSET_PROPERTY_NAMES = new Set(["backgroundImage", "maskImage", "WebkitMaskImage"]);
const CSS_URL_PATTERN = /\burl\(\s*(["']?)([^"')]+)\1\s*\)/i;

const isEmbeddedAssetSource = (assetSource: string): boolean =>
  assetSource.startsWith("data:") || assetSource.startsWith("#");

const getStaticStringExpression = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (
    isNodeOfType(node, "TemplateLiteral") &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.raw;
  }
  return null;
};

const isReactUseMemoCallback = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = node.parent;
  return Boolean(
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === node &&
    isReactApiCall(parent, "useMemo", scopes, { resolveNamedAliases: true }),
  );
};

const componentPreloadsStaticImage = (
  componentNode: EsTreeNode,
  assetSource: string,
  scopes: ScopeAnalysis,
): boolean => {
  let hasPreload = false;
  walkAst(componentNode, (child) => {
    if (hasPreload) return false;
    if (
      child !== componentNode &&
      isFunctionLike(child) &&
      !isReactUseMemoCallback(child, scopes)
    ) {
      return false;
    }
    if (!isNodeOfType(child, "JSXOpeningElement")) return;
    const apiBinding = resolveRemotionApi(child.name, scopes);
    if (apiBinding?.apiName !== "Img" || apiBinding.moduleSource !== "remotion") return;
    const sourceAttribute = findJsxAttribute(child.attributes, "src");
    if (sourceAttribute && getStringLiteralAttributeValue(sourceAttribute) === assetSource) {
      hasPreload = true;
      return false;
    }
  });
  return hasPreload;
};

export const remotionNoCssUrlAssets = defineRule({
  id: "remotion-no-css-url-assets",
  title: "CSS URL asset can flicker in Remotion",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Render the asset with `Img` inside an `AbsoluteFill`, or preload the same source with a hidden `Img` when a CSS mask is required.",
  create: (context) => {
    const renderEvidence = createRemotionRenderEvidenceChecker(context);
    return {
      Property(node: EsTreeNodeOfType<"Property">) {
        if (!CSS_URL_ASSET_PROPERTY_NAMES.has(getStaticPropertyKeyName(node) ?? "")) {
          return;
        }
        const styleObject = node.parent;
        const expressionContainer = styleObject?.parent;
        const styleAttribute = expressionContainer?.parent;
        if (
          !isNodeOfType(styleObject, "ObjectExpression") ||
          !isNodeOfType(expressionContainer, "JSXExpressionContainer") ||
          expressionContainer.expression !== styleObject ||
          !isNodeOfType(styleAttribute, "JSXAttribute") ||
          !isNodeOfType(styleAttribute.name, "JSXIdentifier") ||
          styleAttribute.name.name !== "style"
        ) {
          return;
        }
        const cssValue = getStaticStringExpression(node.value);
        const urlMatch = cssValue ? CSS_URL_PATTERN.exec(cssValue) : null;
        if (!urlMatch) return;
        const assetSource = urlMatch[2].trim();
        if (isEmbeddedAssetSource(assetSource)) return;
        const componentNode = findRenderPhaseComponentOrHook(node, context.scopes);
        if (
          !componentNode ||
          !renderEvidence.functionHasEvidence(componentNode) ||
          componentPreloadsStaticImage(componentNode, assetSource, context.scopes)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Remotion cannot detect when a CSS `url()` asset has loaded, so the rendered frame can flicker. Render or preload the source with <Img> instead.",
        });
      },
    };
  },
});
