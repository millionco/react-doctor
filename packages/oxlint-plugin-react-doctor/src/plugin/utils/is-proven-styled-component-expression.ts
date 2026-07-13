import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const findFactoryRoot = (node: EsTreeNode): EsTreeNode | null => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "Identifier")) return candidate;
  if (isNodeOfType(candidate, "MemberExpression")) return findFactoryRoot(candidate.object);
  if (isNodeOfType(candidate, "CallExpression")) return findFactoryRoot(candidate.callee);
  return null;
};

const findFactoryPropertyName = (node: EsTreeNode): string | null => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "MemberExpression")) {
    return findFactoryPropertyName(candidate.object) ?? getStaticPropertyName(candidate);
  }
  if (isNodeOfType(candidate, "CallExpression")) return findFactoryPropertyName(candidate.callee);
  return null;
};

export const isProvenStyledComponentExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "TaggedTemplateExpression")) return false;
  const factoryRoot = findFactoryRoot(candidate.tag);
  if (!factoryRoot) return false;
  const factoryPropertyName = findFactoryPropertyName(candidate.tag);
  if (
    factoryPropertyName &&
    hasStaticPropertyWriteBefore(factoryRoot, factoryPropertyName, candidate, scopes)
  ) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(factoryRoot, scopes);
  if (!symbol || symbol.kind !== "import") return false;
  const isStyledFactoryImport =
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    getImportedName(symbol.declarationNode) === "styled";
  if (!isStyledFactoryImport) return false;
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.source.value === "styled-components",
  );
};
