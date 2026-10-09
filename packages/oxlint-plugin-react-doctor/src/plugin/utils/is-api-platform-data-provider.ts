import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

export const isApiPlatformDataProvider = (receiver: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  const binding = symbol?.bindingIdentifier;
  const initializer = symbol?.initializer;
  if (
    !symbol ||
    symbol.references.some((usage) => usage.flag !== "read") ||
    !isNodeOfType(binding, "Identifier") ||
    !isNodeOfType(initializer, "CallExpression")
  )
    return false;
  const hook = resolveImportedApiReference(initializer.callee, context.scopes);
  if (hook?.source !== "react-admin" || hook.importedName !== "useDataProvider") return false;
  const annotation = binding.typeAnnotation;
  const reference = isNodeOfType(annotation, "TSTypeAnnotation") ? annotation.typeAnnotation : null;
  if (
    !isNodeOfType(reference, "TSTypeReference") ||
    !isNodeOfType(reference.typeName, "Identifier")
  )
    return false;
  const typeSymbol = findVisibleSymbol(reference.typeName, context.scopes);
  const declaration = typeSymbol ? getImportDeclarationForSymbol(typeSymbol) : null;
  if (
    !typeSymbol ||
    getImportedName(typeSymbol.declarationNode) !== "ApiPlatformAdminDataProvider" ||
    !declaration
  )
    return false;
  const source = declaration.source.value;
  return (
    source === "@api-platform/admin" ||
    (typeof source === "string" &&
      source.startsWith(".") &&
      Boolean(
        context.filename &&
        readNearestPackageManifest(context.filename)?.name === "@api-platform/admin",
      ))
  );
};
