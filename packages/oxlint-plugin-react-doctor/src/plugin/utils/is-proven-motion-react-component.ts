import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";

const MOTION_REACT_MODULES: ReadonlySet<string> = new Set([
  "framer-motion",
  "motion/react",
  "motion/react-client",
]);

const getMotionImportSource = (symbol: SymbolDescriptor): string | null => {
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

export const isProvenMotionReactComponent = (
  elementName: EsTreeNode,
  componentName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(elementName, scopes);
    const source = symbol ? getMotionImportSource(symbol) : null;
    return Boolean(
      symbol &&
      source &&
      MOTION_REACT_MODULES.has(source) &&
      getImportedName(symbol.declarationNode) === componentName,
    );
  }
  if (
    !isNodeOfType(elementName, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object, "JSXIdentifier") ||
    !isNodeOfType(elementName.property, "JSXIdentifier") ||
    elementName.property.name !== componentName
  ) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(elementName.object, scopes);
  const source = symbol ? getMotionImportSource(symbol) : null;
  return Boolean(
    symbol &&
    source &&
    MOTION_REACT_MODULES.has(source) &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};
