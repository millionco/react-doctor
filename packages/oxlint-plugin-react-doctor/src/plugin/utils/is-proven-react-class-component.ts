import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasStaticPropertyWriteBefore } from "./has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REACT_COMPONENT_CLASS_NAMES: ReadonlySet<string> = new Set(["Component", "PureComponent"]);

const isReactComponentClassValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedClassNodes: Set<EsTreeNode>,
  visitedSymbolIds: Set<number>,
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "MemberExpression")) {
    const propertyName = getStaticPropertyName(expression);
    const receiver = stripParenExpression(expression.object);
    return Boolean(
      propertyName &&
      REACT_COMPONENT_CLASS_NAMES.has(propertyName) &&
      isNodeOfType(receiver, "Identifier") &&
      !hasStaticPropertyWriteBefore(receiver, propertyName, expression, scopes) &&
      isReactNamespaceImport(receiver, scopes),
    );
  }
  if (isNodeOfType(expression, "ClassExpression")) {
    return isProvenReactClassComponent(expression, scopes, visitedClassNodes, visitedSymbolIds);
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    hasSymbolWriteBefore(symbol, expression, scopes)
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  if (isImportedFromReact(symbol)) {
    const importedName = getImportedName(symbol.declarationNode);
    return Boolean(importedName && REACT_COMPONENT_CLASS_NAMES.has(importedName));
  }
  if (
    isNodeOfType(symbol.declarationNode, "ClassDeclaration") ||
    isNodeOfType(symbol.declarationNode, "ClassExpression")
  ) {
    return isProvenReactClassComponent(
      symbol.declarationNode,
      scopes,
      visitedClassNodes,
      visitedSymbolIds,
    );
  }
  return Boolean(
    symbol.kind === "const" &&
    symbol.initializer &&
    isReactComponentClassValue(symbol.initializer, scopes, visitedClassNodes, visitedSymbolIds),
  );
};

export const isProvenReactClassComponent = (
  classNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedClassNodes = new Set<EsTreeNode>(),
  visitedSymbolIds = new Set<number>(),
): boolean => {
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    visitedClassNodes.has(classNode) ||
    !classNode.superClass
  ) {
    return false;
  }
  visitedClassNodes.add(classNode);
  return isReactComponentClassValue(
    classNode.superClass,
    scopes,
    visitedClassNodes,
    visitedSymbolIds,
  );
};
