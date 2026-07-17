import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const MOTION_REACT_MODULES: ReadonlySet<string> = new Set([
  "framer-motion",
  "framer-motion/client",
  "motion/react",
  "motion/react-client",
]);

const getImportSource = (symbol: SymbolDescriptor): string | null => {
  if (symbol.kind !== "import") return null;
  const declaration = symbol.declarationNode.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  return typeof declaration.source.value === "string" ? declaration.source.value : null;
};

const getMotionReactApiPathInternal = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): ReadonlyArray<string> | null => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "MemberExpression")) {
    const propertyName = getStaticPropertyName(node);
    if (!propertyName) return null;
    const objectPath = getMotionReactApiPathInternal(node.object, scopes, visitedSymbolIds);
    return objectPath ? [...objectPath, propertyName] : null;
  }
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  if (symbol.kind === "const" && symbol.initializer) {
    return getMotionReactApiPathInternal(symbol.initializer, scopes, visitedSymbolIds);
  }
  const source = getImportSource(symbol);
  if (!source || !MOTION_REACT_MODULES.has(source)) return null;
  if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return [];
  const importedName = getImportedName(symbol.declarationNode);
  return importedName ? [importedName] : null;
};

export const getMotionReactApiPath = (node: EsTreeNode, scopes: ScopeAnalysis): string | null =>
  getMotionReactApiPathInternal(node, scopes, new Set<number>())?.join(".") ?? null;
