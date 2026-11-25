import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getOwnedContextFunction } from "./get-owned-context-function.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import {
  inspectAmbientTimerGraph,
  type CertifiedDocumentBindings,
} from "./inspect-closed-ambient-timer-handles.js";
import { isVerifiedIsomorphicReactEffect } from "./is-verified-isomorphic-react-effect.js";
import { isNativeTimeoutCallbackDispatcher } from "./is-native-timeout-callback-dispatcher.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { ImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveOwnedReactContextFromGetter } from "./resolve-owned-react-context.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const getContextBindingInitializer = (
  symbol: SymbolDescriptor,
  propertyName: string,
): EsTreeNode | null => {
  const { bindingIdentifier, declarationNode } = symbol;
  if (
    symbol.kind !== "const" ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(declarationNode, "VariableDeclarator") ||
    !isNodeOfType(declarationNode.id, "ObjectPattern") ||
    !declarationNode.init
  )
    return null;
  const property = bindingIdentifier.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== bindingIdentifier ||
    getStaticPropertyKeyName(property) !== propertyName
  )
    return null;
  const call = stripParenExpression(declarationNode.init);
  return isNodeOfType(call, "CallExpression") && !call.optional && call.arguments.length === 0
    ? call.callee
    : null;
};

const getDocumentBinding = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  symbol: SymbolDescriptor,
  name: string,
) => {
  const callee = getContextBindingInitializer(symbol, name);
  if (!isNodeOfType(callee, "Identifier") || module.scopes.symbolFor(callee)?.kind !== "import")
    return null;
  const imported = resolveImportedApiReference(callee, module.scopes);
  return imported?.importedName && !imported.isNamespace
    ? resolveVerifiedViteExport(project, module, imported.source, imported.importedName)
    : null;
};

const certifyDocumentGetters = (
  project: NamedViteSourceProject,
): CertifiedDocumentBindings | null => {
  const documentGetters = new Set<SymbolDescriptor>();
  const windowGetters = new Set<SymbolDescriptor>();
  const contextCache = new Map<EsTreeNode, ReturnType<typeof resolveOwnedReactContextFromGetter>>();
  for (const module of project.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      if (!isNodeOfType(node, "VariableDeclarator") || !isNodeOfType(node.id, "ObjectPattern"))
        return;
      for (const property of node.id.properties) {
        if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier"))
          continue;
        const key = getStaticPropertyKeyName(property);
        if (key !== "getOwnerDocument" && key !== "getOwnerWindow") continue;
        const symbol = module.scopes.symbolFor(property.value);
        if (!symbol) continue;
        const getter = getDocumentBinding(project, module, symbol, key);
        if (!getter) continue;
        if (!contextCache.has(getter.exportedNode))
          contextCache.set(
            getter.exportedNode,
            resolveOwnedReactContextFromGetter(project, getter),
          );
        const context = contextCache.get(getter.exportedNode);
        if (!context) continue;
        const document = getOwnedContextFunction(context, "getOwnerDocument");
        const window = getOwnedContextFunction(context, "getOwnerWindow");
        if (!document || !window) continue;
        const nativeModule = context.value.module;
        const documentLocal = isNodeOfType(document.parent, "VariableDeclarator")
          ? nativeModule.scopes.symbolFor(document.parent.id)
          : null;
        const windowLocal = isNodeOfType(window.parent, "VariableDeclarator")
          ? nativeModule.scopes.symbolFor(window.parent.id)
          : null;
        if (!documentLocal || !windowLocal) continue;
        // The ambient scanner independently verifies the local forwarding
        // operation and all exact uses of the Window-producing getter.
        documentGetters.add(documentLocal);
        windowGetters.add(windowLocal);
        if (key === "getOwnerDocument") documentGetters.add(symbol);
        else windowGetters.add(symbol);
      }
    });
  }
  if (contextCache.size > 1) return null;
  const hasBinding = (
    symbols: ReadonlySet<SymbolDescriptor>,
    symbol: SymbolDescriptor | null,
    _module: SourceProjectModule,
  ) => symbol !== null && symbols.has(symbol);
  return {
    isAdditionalReadonlyHookDependency: (call, module) => {
      const selected = project.modulesByFilePath.get(module.filePath);
      return selected === module && isVerifiedIsomorphicReactEffect(project, selected, call);
    },
    isDocumentGetter: (symbol, module) => hasBinding(documentGetters, symbol, module),
    isWindowGetter: (symbol, module) => hasBinding(windowGetters, symbol, module),
  };
};

export const hasQualifiedViteContextTimer = (
  project: NamedViteSourceProject,
  focal: NamedViteSourceModule,
  getter: ImportedApiReference,
): boolean => {
  if (!getter.importedName || getter.isNamespace) return false;
  const resolved = resolveVerifiedViteExport(project, focal, getter.source, getter.importedName);
  if (!resolved) return false;
  const context = resolveOwnedReactContextFromGetter(project, resolved);
  const dispatcher = context && getOwnedContextFunction(context, "setTimeout");
  if (
    !context ||
    !dispatcher ||
    !isNativeTimeoutCallbackDispatcher(dispatcher, context.value.module.scopes)
  )
    return false;
  const bindings = certifyDocumentGetters(project);
  return Boolean(
    bindings && inspectAmbientTimerGraph(project.modulesByFilePath, bindings).size === 0,
  );
};
