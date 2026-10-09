import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolvePackageVersion } from "./resolve-package-version.js";

export const isStableXstateServiceSend = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  const declaration = symbol.declarationNode;
  if (
    !filename ||
    symbol.references.some((usage) => usage.flag !== "read") ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements[1] !== symbol.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression")
  )
    return false;
  const hook = resolveImportedApiReference(declaration.init.callee, scopes);
  if (hook?.source !== "@xstate/react" || hook.importedName !== "useService") return false;
  const version = resolvePackageVersion(filename, "@xstate/react");
  if (
    !version ||
    version.version.major !== 1 ||
    version.version.isPrerelease ||
    (version.declaredRange && !/^[~^]?1(?:\.\d+){1,2}$/.test(version.declaredRange))
  )
    return false;
  const argument = declaration.init.arguments[0];
  if (!isNodeOfType(argument, "Identifier")) return false;
  if (hasPossibleStaticPropertyWrite(argument, "send", scopes)) return false;
  let service = resolveConstIdentifierAlias(argument, scopes);
  let serviceScopes = scopes;
  if (service?.kind === "import") {
    const imported = resolveImportedApiReference(argument, scopes);
    const resolved =
      imported?.source.startsWith(".") && imported.importedName
        ? resolveCrossFileValueExportWithFilePath(filename, imported.source, imported.importedName)
        : null;
    const declarator = resolved?.exportedNode.parent;
    if (
      !resolved ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "Identifier")
    )
      return false;
    serviceScopes = analyzeScopes(resolved.programNode);
    service = serviceScopes.symbolFor(declarator.id);
  }
  if (
    !service ||
    service.kind !== "const" ||
    service.scope.kind !== "module" ||
    service.references.some((usage) => usage.flag !== "read") ||
    !isNodeOfType(service.initializer, "CallExpression")
  )
    return false;
  const factory = resolveImportedApiReference(service.initializer.callee, serviceScopes);
  if (factory?.source !== "xstate" || factory.importedName !== "interpret") return false;
  if (hasPossibleStaticPropertyWrite(service.bindingIdentifier, "send", serviceScopes))
    return false;
  return service.references.every((usage) => {
    const member = usage.identifier.parent;
    if (!isNodeOfType(member, "MemberExpression")) return true;
    const consumer: EsTreeNode | null | undefined = member.parent;
    return (
      !(isNodeOfType(consumer, "AssignmentExpression") && consumer.left === member) &&
      !(
        isNodeOfType(consumer, "UpdateExpression") ||
        (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "delete")
      )
    );
  });
};
