import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { PAGE_OR_LAYOUT_FILE_PATTERN } from "../../constants/nextjs.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";

interface StaticObjectProperty {
  property: EsTreeNode;
  value: EsTreeNode;
}

const getStaticObjectProperty = (
  objectExpression: EsTreeNode,
  propertyName: string,
): StaticObjectProperty | null => {
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return null;
  for (
    let propertyIndex = objectExpression.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = objectExpression.properties[propertyIndex];
    if (!isNodeOfType(property, "Property")) return null;
    const currentPropertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (currentPropertyName === null) return null;
    if (currentPropertyName !== propertyName) continue;
    return { property, value: stripParenExpression(property.value) };
  }
  return null;
};

const getStaticString = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const normalizeComparableUrl = (value: string): string => {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.pathname.length > 1 && parsedUrl.pathname.endsWith("/")) {
      parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
    }
    return parsedUrl.href;
  } catch {
    if (value === "/") return value;
    return value.endsWith("/") ? value.slice(0, -1) : value;
  }
};

const isExportedMetadataDeclarator = (node: EsTreeNodeOfType<"VariableDeclarator">): boolean => {
  if (!isNodeOfType(node.id, "Identifier") || node.id.name !== "metadata") return false;
  const declaration = node.parent;
  return Boolean(declaration?.parent && isNodeOfType(declaration.parent, "ExportNamedDeclaration"));
};

export const nextjsMetadataUrlConsistency = defineRule({
  id: "nextjs-metadata-url-consistency",
  title: "Canonical and Open Graph URLs disagree",
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Use the same preferred page URL for alternates.canonical and openGraph.url so search and social previews identify one page.",
  create: (context) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!PAGE_OR_LAYOUT_FILE_PATTERN.test(normalizeFilename(context.filename ?? ""))) return;
      if (!isExportedMetadataDeclarator(node) || !node.init) return;
      const metadataObject = stripParenExpression(node.init);
      if (!isNodeOfType(metadataObject, "ObjectExpression")) return;
      const alternates = getStaticObjectProperty(metadataObject, "alternates");
      const openGraph = getStaticObjectProperty(metadataObject, "openGraph");
      if (!alternates || !openGraph) return;
      const canonical = getStaticObjectProperty(alternates.value, "canonical");
      const openGraphUrl = getStaticObjectProperty(openGraph.value, "url");
      if (!canonical || !openGraphUrl) return;
      const canonicalValue = getStaticString(canonical.value);
      const openGraphValue = getStaticString(openGraphUrl.value);
      if (canonicalValue === null || openGraphValue === null) return;
      if (normalizeComparableUrl(canonicalValue) === normalizeComparableUrl(openGraphValue)) return;

      context.report({
        node: openGraphUrl.property,
        message: `openGraph.url is "${openGraphValue}" but the canonical URL is "${canonicalValue}", so social previews and search metadata identify different pages.`,
      });
    },
  }),
});
