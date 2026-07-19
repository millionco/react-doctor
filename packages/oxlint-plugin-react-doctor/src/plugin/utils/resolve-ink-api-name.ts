import { INK_MODULE } from "../constants/ink.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "./find-import-source-for-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const resolveInkApiName = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (isNodeOfType(node, "Identifier")) {
    if (scopes.symbolFor(node)?.kind !== "import") return null;
    return getImportedNameFromModule(node, node.name, INK_MODULE);
  }
  if (
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.object, "Identifier") &&
    scopes.symbolFor(node.object)?.kind === "import" &&
    isNamespaceImportFromModule(node, node.object.name, INK_MODULE)
  ) {
    return getStaticPropertyName(node);
  }
  return null;
};

export const resolveInkJsxElementName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): string | null => {
  const elementName = openingElement.name;
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    if (scopes.symbolFor(elementName)?.kind !== "import") return null;
    return getImportedNameFromModule(openingElement, elementName.name, INK_MODULE);
  }
  if (
    isNodeOfType(elementName, "JSXMemberExpression") &&
    isNodeOfType(elementName.object, "JSXIdentifier") &&
    scopes.symbolFor(elementName.object)?.kind === "import" &&
    isNamespaceImportFromModule(openingElement, elementName.object.name, INK_MODULE)
  ) {
    return elementName.property.name;
  }
  return null;
};
