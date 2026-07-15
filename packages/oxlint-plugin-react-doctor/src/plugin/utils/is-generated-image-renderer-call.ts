import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const GENERATED_IMAGE_RENDERER_MODULES: ReadonlyArray<string> = [
  "next/og",
  "@vercel/og",
  "satori",
];

const IMAGE_RESPONSE_MODULES: ReadonlySet<string> = new Set(["next/og", "@vercel/og"]);

const getImportDeclaration = (node: EsTreeNode): EsTreeNodeOfType<"ImportDeclaration"> | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "ImportDeclaration")) return current;
    if (isNodeOfType(current, "Program")) return null;
    current = current.parent;
  }
  return null;
};

const getImportSource = (declaration: EsTreeNodeOfType<"ImportDeclaration">): string | null =>
  typeof declaration.source.value === "string" ? declaration.source.value : null;

const isNamedImport = (
  symbol: SymbolDescriptor,
  importedName: string,
  moduleSources: ReadonlySet<string>,
): boolean => {
  if (symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "ImportSpecifier")) return false;
  const importDeclaration = getImportDeclaration(declaration);
  const source = importDeclaration ? getImportSource(importDeclaration) : null;
  if (!source || !moduleSources.has(source)) return false;
  const imported = declaration.imported;
  return (
    (isNodeOfType(imported, "Identifier") && imported.name === importedName) ||
    (isNodeOfType(imported, "Literal") && imported.value === importedName)
  );
};

const isSatoriImport = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  const importDeclaration = getImportDeclaration(declaration);
  if (!importDeclaration || getImportSource(importDeclaration) !== "satori") return false;
  if (isNodeOfType(declaration, "ImportDefaultSpecifier")) return true;
  if (!isNodeOfType(declaration, "ImportSpecifier")) return false;
  const imported = declaration.imported;
  return (
    (isNodeOfType(imported, "Identifier") && imported.name === "satori") ||
    (isNodeOfType(imported, "Literal") && imported.value === "satori")
  );
};

export const isGeneratedImageRendererCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = scopes.referenceFor(callee)?.resolvedSymbol ?? null;
    return Boolean(
      symbol &&
      (isNamedImport(symbol, "ImageResponse", IMAGE_RESPONSE_MODULES) || isSatoriImport(symbol)),
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticPropertyName(callee) !== "ImageResponse") return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  const symbol = scopes.referenceFor(callee.object)?.resolvedSymbol ?? null;
  if (!symbol || symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "ImportNamespaceSpecifier")) return false;
  const importDeclaration = getImportDeclaration(declaration);
  const source = importDeclaration ? getImportSource(importDeclaration) : null;
  return Boolean(source && IMAGE_RESPONSE_MODULES.has(source));
};
