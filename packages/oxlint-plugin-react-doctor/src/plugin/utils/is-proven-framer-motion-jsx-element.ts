import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const MOTION_FACTORY_MODULES: ReadonlySet<string> = new Set(["framer-motion", "motion/react"]);
const MOTION_TAG_NAMESPACE_MODULES: ReadonlySet<string> = new Set([
  "framer-motion/client",
  "framer-motion/m",
  "motion/react-client",
  "motion/react-m",
]);
const MOTION_FACTORY_EXPORTS: ReadonlySet<string> = new Set(["m", "motion"]);

const getValueImportSource = (symbol: SymbolDescriptor): string | null => {
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

const getMemberParts = (node: EsTreeNode): [EsTreeNode, string] | null => {
  if (isNodeOfType(node, "MemberExpression")) {
    const propertyName = getStaticPropertyName(node);
    return propertyName ? [node.object, propertyName] : null;
  }
  if (isNodeOfType(node, "JSXMemberExpression")) {
    return isNodeOfType(node.property, "JSXIdentifier") ? [node.object, node.property.name] : null;
  }
  return null;
};

const resolveSymbol = (node: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return null;
  return resolveConstIdentifierAlias(node, scopes);
};

const isNamespaceFrom = (
  node: EsTreeNode,
  sources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = resolveSymbol(stripParenExpression(node), scopes);
  const source = symbol ? getValueImportSource(symbol) : null;
  return Boolean(
    source &&
    sources.has(source) &&
    symbol &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const isMotionFactory = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (isNamespaceFrom(node, MOTION_TAG_NAMESPACE_MODULES, scopes)) return true;
  const symbol = resolveSymbol(node, scopes);
  if (symbol?.kind === "import") {
    const source = getValueImportSource(symbol);
    const importedName = getImportedName(symbol.declarationNode);
    return Boolean(
      source &&
      MOTION_FACTORY_MODULES.has(source) &&
      importedName &&
      MOTION_FACTORY_EXPORTS.has(importedName),
    );
  }
  if (symbol?.kind === "const" && symbol.initializer) {
    if (visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    return isMotionFactory(symbol.initializer, scopes, visitedSymbolIds);
  }
  const memberParts = getMemberParts(node);
  return Boolean(
    memberParts &&
    MOTION_FACTORY_EXPORTS.has(memberParts[1]) &&
    isNamespaceFrom(memberParts[0], MOTION_FACTORY_MODULES, scopes),
  );
};

const isMotionComponent = (rawNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return isMotionComponentWithVisitedSymbols(rawNode, scopes, new Set());
};

const isMotionComponentWithVisitedSymbols = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  const symbol = resolveSymbol(node, scopes);
  if (symbol?.kind === "const" && symbol.initializer) {
    if (visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    return isMotionComponentWithVisitedSymbols(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (symbol?.kind === "import") {
    const source = getValueImportSource(symbol);
    return Boolean(
      source &&
      MOTION_TAG_NAMESPACE_MODULES.has(source) &&
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) !== "create",
    );
  }
  const memberParts = getMemberParts(node);
  if (memberParts && isMotionFactory(memberParts[0], scopes, visitedSymbolIds)) return true;
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isMotionFactory(node.callee, scopes, visitedSymbolIds)) return true;
  const calleeMemberParts = getMemberParts(stripParenExpression(node.callee));
  return Boolean(
    calleeMemberParts &&
    calleeMemberParts[1] === "create" &&
    isMotionFactory(calleeMemberParts[0], scopes, visitedSymbolIds),
  );
};

export const isProvenFramerMotionJsxElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const elementName = openingElement.name;
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    if (/^[a-z]/.test(elementName.name)) return false;
    return isMotionComponent(elementName, scopes);
  }
  const memberParts = getMemberParts(elementName);
  return Boolean(memberParts && isMotionFactory(memberParts[0], scopes, new Set()));
};
