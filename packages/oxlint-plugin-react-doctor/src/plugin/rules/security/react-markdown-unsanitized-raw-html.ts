import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface StaticMemberParts {
  object: EsTreeNode;
  propertyName: string;
}

const MESSAGE =
  "React Markdown parses dynamic raw HTML when `rehype-raw` is enabled. Add `rehype-sanitize` to `rehypePlugins` or sanitize the markdown before rendering it.";

const REACT_MARKDOWN_MODULE = "react-markdown";
const REHYPE_RAW_MODULE = "rehype-raw";
const REHYPE_SANITIZE_MODULE = "rehype-sanitize";
const DOMPURIFY_MODULES = new Set(["dompurify", "isomorphic-dompurify"]);
const REACT_MARKDOWN_NAMED_EXPORTS = new Set(["MarkdownAsync", "MarkdownHooks"]);
const REACT_MARKDOWN_NAMESPACE_EXPORTS = new Set(["default", ...REACT_MARKDOWN_NAMED_EXPORTS]);
const DEFAULT_EXPORT_NAMES = new Set(["default"]);

const isImportFromModule = (symbol: SymbolDescriptor, moduleName: string): boolean =>
  getImportDeclarationForSymbol(symbol)?.source.value === moduleName;

const isDefaultImportSymbol = (symbol: SymbolDescriptor, moduleName: string): boolean => {
  if (!isImportFromModule(symbol, moduleName)) return false;
  return (
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    getImportedName(symbol.declarationNode) === "default"
  );
};

const resolveImportedIdentifier = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return null;
  const symbol = resolveConstIdentifierAlias(node, scopes);
  return symbol?.kind === "import" ? symbol : null;
};

const getStaticMemberParts = (node: EsTreeNode): StaticMemberParts | null => {
  if (isNodeOfType(node, "MemberExpression")) {
    if (node.computed || !isNodeOfType(node.property, "Identifier")) return null;
    return { object: node.object, propertyName: node.property.name };
  }
  if (isNodeOfType(node, "JSXMemberExpression")) {
    if (!isNodeOfType(node.property, "JSXIdentifier")) return null;
    return { object: node.object, propertyName: node.property.name };
  }
  return null;
};

const isNamespaceMemberFromModule = (
  node: EsTreeNode,
  moduleName: string,
  memberNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const memberParts = getStaticMemberParts(node);
  if (!memberParts || !memberNames.has(memberParts.propertyName)) return false;
  const namespaceSymbol = resolveImportedIdentifier(memberParts.object, scopes);
  return Boolean(
    namespaceSymbol &&
    isImportFromModule(namespaceSymbol, moduleName) &&
    isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const isReactMarkdownComponent = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "JSXIdentifier")) {
    const symbol = resolveImportedIdentifier(node, scopes);
    if (!symbol || !isImportFromModule(symbol, REACT_MARKDOWN_MODULE)) return false;
    if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return true;
    const importedName = getImportedName(symbol.declarationNode);
    return (
      importedName === "default" ||
      Boolean(importedName && REACT_MARKDOWN_NAMED_EXPORTS.has(importedName))
    );
  }
  return isNamespaceMemberFromModule(
    node,
    REACT_MARKDOWN_MODULE,
    REACT_MARKDOWN_NAMESPACE_EXPORTS,
    scopes,
  );
};

const isPluginFromModule = (
  rawNode: EsTreeNode,
  moduleName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(node, scopes);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    if (isDefaultImportSymbol(symbol, moduleName)) return true;
    if (symbol.kind !== "const" || !symbol.initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isPluginFromModule(symbol.initializer, moduleName, scopes, visitedSymbolIds);
  }
  if (isNamespaceMemberFromModule(node, moduleName, DEFAULT_EXPORT_NAMES, scopes)) return true;
  if (!isNodeOfType(node, "ArrayExpression")) return false;
  for (const element of node.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) continue;
    return isPluginFromModule(element, moduleName, scopes, visitedSymbolIds);
  }
  return false;
};

const collectPluginEntries = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode[] | null => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.referenceFor(node)?.resolvedSymbol;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return collectPluginEntries(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(node, "ArrayExpression")) return null;
  const entries: EsTreeNode[] = [];
  for (const element of node.elements) {
    if (!element) continue;
    if (isNodeOfType(element, "SpreadElement")) {
      const spreadEntries = collectPluginEntries(
        element.argument,
        scopes,
        new Set(visitedSymbolIds),
      );
      if (spreadEntries === null) return null;
      entries.push(...spreadEntries);
      continue;
    }
    entries.push(element);
  }
  return entries;
};

const getAttributeExpression = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  return isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
    ? null
    : attribute.value.expression;
};

const isDomPurifyNamespace = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = resolveImportedIdentifier(node, scopes);
  if (!symbol) return false;
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (!importDeclaration || !DOMPURIFY_MODULES.has(String(importDeclaration.source.value))) {
    return false;
  }
  return (
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
    getImportedName(symbol.declarationNode) === "default"
  );
};

const isDomPurifySanitizeCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const memberParts = getStaticMemberParts(stripParenExpression(node.callee));
  return Boolean(
    memberParts &&
    memberParts.propertyName === "sanitize" &&
    isDomPurifyNamespace(memberParts.object, scopes),
  );
};

const isStaticOrSanitizedMarkdownExpression = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "TemplateLiteral")) {
    return node.expressions.every((expression) =>
      isStaticOrSanitizedMarkdownExpression(expression, scopes, new Set(visitedSymbolIds)),
    );
  }
  if (isDomPurifySanitizeCall(node, scopes)) return true;
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isStaticOrSanitizedMarkdownExpression(node.consequent, scopes, new Set(visitedSymbolIds)) &&
      isStaticOrSanitizedMarkdownExpression(node.alternate, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(node, "BinaryExpression") && node.operator === "+") {
    return (
      isStaticOrSanitizedMarkdownExpression(node.left, scopes, new Set(visitedSymbolIds)) &&
      isStaticOrSanitizedMarkdownExpression(node.right, scopes, new Set(visitedSymbolIds))
    );
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.referenceFor(node)?.resolvedSymbol;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isStaticOrSanitizedMarkdownExpression(symbol.initializer, scopes, visitedSymbolIds);
};

const hasDynamicUnsanitizedChildren = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const jsxElement = openingElement.parent;
  if (!isNodeOfType(jsxElement, "JSXElement")) return false;
  const meaningfulChildren = jsxElement.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim().length > 0,
  );
  if (meaningfulChildren.length > 0) {
    return meaningfulChildren.some((child) => {
      if (isNodeOfType(child, "JSXText")) return false;
      if (!isNodeOfType(child, "JSXExpressionContainer")) return true;
      if (isNodeOfType(child.expression, "JSXEmptyExpression")) return false;
      return !isStaticOrSanitizedMarkdownExpression(child.expression, scopes, new Set());
    });
  }
  const childrenAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "children");
  if (!childrenAttribute) return false;
  const childrenExpression = getAttributeExpression(childrenAttribute);
  return Boolean(
    childrenExpression &&
    !isStaticOrSanitizedMarkdownExpression(childrenExpression, scopes, new Set()),
  );
};

export const reactMarkdownUnsanitizedRawHtml = defineRule({
  id: "react-markdown-unsanitized-raw-html",
  title: "Unsanitized raw HTML in React Markdown",
  severity: "warn",
  recommendation:
    "Add `rehype-sanitize` to `rehypePlugins` or sanitize dynamic markdown before rendering. `skipHtml` does not disable HTML already parsed by `rehype-raw`.",
  create: skipNonProductionFiles((context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isReactMarkdownComponent(node.name, context.scopes)) return;
      const pluginsAttribute = getAuthoritativeJsxAttribute(node.attributes, "rehypePlugins");
      if (!pluginsAttribute) return;
      const pluginsExpression = getAttributeExpression(pluginsAttribute);
      if (!pluginsExpression) return;
      const pluginEntries = collectPluginEntries(pluginsExpression, context.scopes, new Set());
      if (pluginEntries === null) return;
      const hasRawPlugin = pluginEntries.some((entry) =>
        isPluginFromModule(entry, REHYPE_RAW_MODULE, context.scopes, new Set()),
      );
      if (!hasRawPlugin) return;
      const hasSanitizePlugin = pluginEntries.some((entry) =>
        isPluginFromModule(entry, REHYPE_SANITIZE_MODULE, context.scopes, new Set()),
      );
      if (hasSanitizePlugin || !hasDynamicUnsanitizedChildren(node, context.scopes)) return;
      context.report({ node, message: MESSAGE });
    },
  })),
});
