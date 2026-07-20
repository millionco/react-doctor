import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isRemotionModuleSource } from "./is-remotion-module-source.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface RemotionApiBinding {
  apiName: string;
  moduleSource: string;
}

export const resolveRemotionApi = (
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): RemotionApiBinding | null => {
  const candidate = stripParenExpression(referenceNode);
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "JSXIdentifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (symbol?.kind !== "import") return null;
    const importBinding = getImportBindingForName(candidate, symbol.name);
    if (
      !importBinding ||
      importBinding.isNamespace ||
      importBinding.exportedName === null ||
      !isRemotionModuleSource(importBinding.source)
    ) {
      return null;
    }
    return { apiName: importBinding.exportedName, moduleSource: importBinding.source };
  }

  if (isNodeOfType(candidate, "MemberExpression")) {
    const apiName = getStaticPropertyKeyName(candidate, { allowComputedString: true });
    const namespaceObject = stripParenExpression(candidate.object);
    if (!apiName || !isNodeOfType(namespaceObject, "Identifier")) return null;
    const symbol = scopes.symbolFor(namespaceObject);
    if (symbol?.kind !== "import") return null;
    const importBinding = getImportBindingForName(namespaceObject, symbol.name);
    if (!importBinding?.isNamespace || !isRemotionModuleSource(importBinding.source)) return null;
    return { apiName, moduleSource: importBinding.source };
  }

  if (
    !isNodeOfType(candidate, "JSXMemberExpression") ||
    !isNodeOfType(candidate.object, "JSXIdentifier") ||
    !isNodeOfType(candidate.property, "JSXIdentifier")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(candidate.object);
  if (symbol?.kind !== "import") return null;
  const importBinding = getImportBindingForName(candidate.object, symbol.name);
  if (!importBinding?.isNamespace || !isRemotionModuleSource(importBinding.source)) return null;
  return { apiName: candidate.property.name, moduleSource: importBinding.source };
};
