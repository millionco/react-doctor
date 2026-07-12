import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REACT_COMPONENT_CLASS_NAMES: ReadonlySet<string> = new Set(["Component", "PureComponent"]);

export const isProvenReactClassComponent = (
  classNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedClassNodes = new Set<EsTreeNode>(),
): boolean => {
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    visitedClassNodes.has(classNode) ||
    !classNode.superClass
  ) {
    return false;
  }
  visitedClassNodes.add(classNode);
  const superClass = stripParenExpression(classNode.superClass);
  if (isNodeOfType(superClass, "MemberExpression")) {
    const propertyName = getStaticPropertyName(superClass);
    const receiver = stripParenExpression(superClass.object);
    return Boolean(
      propertyName &&
      REACT_COMPONENT_CLASS_NAMES.has(propertyName) &&
      isNodeOfType(receiver, "Identifier") &&
      isReactNamespaceImport(receiver, scopes),
    );
  }
  if (!isNodeOfType(superClass, "Identifier")) return false;
  const superClassSymbol = scopes.symbolFor(superClass);
  if (!superClassSymbol) return false;
  if (isImportedFromReact(superClassSymbol)) {
    const importedName = getImportedName(superClassSymbol.declarationNode);
    return Boolean(importedName && REACT_COMPONENT_CLASS_NAMES.has(importedName));
  }
  if (
    isNodeOfType(superClassSymbol.declarationNode, "ClassDeclaration") ||
    isNodeOfType(superClassSymbol.declarationNode, "ClassExpression")
  ) {
    return isProvenReactClassComponent(superClassSymbol.declarationNode, scopes, visitedClassNodes);
  }
  if (
    superClassSymbol.initializer &&
    isNodeOfType(stripParenExpression(superClassSymbol.initializer), "ClassExpression")
  ) {
    return isProvenReactClassComponent(
      stripParenExpression(superClassSymbol.initializer),
      scopes,
      visitedClassNodes,
    );
  }
  return false;
};
