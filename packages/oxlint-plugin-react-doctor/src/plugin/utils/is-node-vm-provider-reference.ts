import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isRuntimeGlobalReference } from "./is-runtime-global-reference.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NODE_VM_MODULE_SOURCES = new Set(["vm", "node:vm"]);

const getRuntimeImportSource = (symbol: SymbolDescriptor): string | null => {
  if (symbol.kind !== "import" && symbol.kind !== "ts-import-equals") return null;
  if (isErasedTypeScriptBinding(symbol)) return null;
  const declaration = symbol.declarationNode;
  if (
    symbol.kind === "ts-import-equals" &&
    isNodeOfType(declaration, "TSImportEqualsDeclaration") &&
    isNodeOfType(declaration.moduleReference, "TSExternalModuleReference")
  ) {
    return declaration.moduleReference.expression.value;
  }
  return getValueImportSource(symbol);
};

const isRuntimeNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isProvenGlobalNamespaceReference(candidate, namespaceName, scopes)) return true;
  if (isNodeOfType(candidate, "CallExpression")) {
    const source = candidate.arguments[0];
    return (
      isNodeOfType(source, "Literal") &&
      (source.value === namespaceName || source.value === `node:${namespaceName}`) &&
      isNodeModuleLoader(candidate.callee, scopes, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (candidate.name === namespaceName && isRuntimeGlobalReference(candidate, scopes)) return true;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    visitedSymbolIds.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  )
    return false;
  visitedSymbolIds.add(symbol.id);
  const source = getRuntimeImportSource(symbol);
  const imported = resolveImportedApiReference(candidate, scopes);
  if (
    (source === namespaceName || source === `node:${namespaceName}`) &&
    (symbol.kind === "ts-import-equals" ||
      imported?.isNamespace ||
      imported?.importedName === "default")
  )
    return true;
  const initializer = getDirectConstInitializer(symbol);
  return Boolean(
    initializer &&
    isRuntimeNamespaceReference(initializer, namespaceName, scopes, visitedSymbolIds),
  );
};

const isNodeModuleLoader = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  const imported = resolveImportedApiReference(candidate, scopes);
  if (
    imported?.importedName === "getBuiltinModule" &&
    (imported.source === "process" || imported.source === "node:process")
  )
    return true;
  if (isNodeOfType(candidate, "MemberExpression")) {
    const property = getStaticPropertyName(candidate);
    return (
      (property === "getBuiltinModule" &&
        isRuntimeNamespaceReference(candidate.object, "process", scopes, visitedSymbolIds)) ||
      (property === "require" &&
        isRuntimeNamespaceReference(candidate.object, "module", scopes, visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const factory = resolveImportedApiReference(candidate.callee, scopes);
    const factorySymbol = isNodeOfType(candidate.callee, "Identifier")
      ? scopes.symbolFor(candidate.callee)
      : null;
    return (
      Boolean(
        factorySymbol?.kind === "const" &&
        factorySymbol.initializer &&
        getDestructuredBindingPropertyName(factorySymbol.bindingIdentifier) === "createRequire" &&
        isRuntimeNamespaceReference(factorySymbol.initializer, "module", scopes, visitedSymbolIds),
      ) ||
      (factory?.importedName === "createRequire" &&
        (factory.source === "module" || factory.source === "node:module")) ||
      (isNodeOfType(candidate.callee, "MemberExpression") &&
        getStaticPropertyName(candidate.callee) === "createRequire" &&
        isRuntimeNamespaceReference(candidate.callee.object, "module", scopes, visitedSymbolIds))
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (candidate.name === "require" && isRuntimeGlobalReference(candidate, scopes)) return true;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    visitedSymbolIds.has(symbol.id) ||
    visitedSymbolIds.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  )
    return false;
  visitedSymbolIds.add(symbol.id);
  const property = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (property && symbol.initializer) {
    return (
      (property === "getBuiltinModule" &&
        isRuntimeNamespaceReference(symbol.initializer, "process", scopes, visitedSymbolIds)) ||
      (property === "require" &&
        isRuntimeNamespaceReference(symbol.initializer, "module", scopes, visitedSymbolIds))
    );
  }
  const initializer = getDirectConstInitializer(symbol);
  return Boolean(initializer && isNodeModuleLoader(initializer, scopes, visitedSymbolIds));
};

export const isNodeVmProviderReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.referenceFor(node)?.resolvedSymbol;
    return Boolean(symbol && NODE_VM_MODULE_SOURCES.has(getRuntimeImportSource(symbol) ?? ""));
  }
  if (isNodeOfType(node, "ImportExpression"))
    return (
      isNodeOfType(node.source, "Literal") &&
      typeof node.source.value === "string" &&
      NODE_VM_MODULE_SOURCES.has(node.source.value)
    );
  if (!isNodeOfType(node, "CallExpression")) return false;
  const source = node.arguments[0];
  return (
    isNodeOfType(source, "Literal") &&
    typeof source.value === "string" &&
    NODE_VM_MODULE_SOURCES.has(source.value) &&
    isNodeModuleLoader(node.callee, scopes, new Set())
  );
};
