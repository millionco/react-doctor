import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import { comparePackageVersions } from "../../../utils/compare-package-versions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { resolvePackageVersion } from "../../../utils/resolve-package-version.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  SLATE_CURRENT_FOCUS_DECLARED_RANGE,
  SLATE_CURRENT_FOCUS_SUPPORTED_VERSION,
  SLATE_CURRENT_FOCUS_UNSUPPORTED_IDENTIFIERS,
  SLATE_CURRENT_FOCUS_UNSUPPORTED_MEMBERS,
  SLATE_CURRENT_FOCUS_RUNTIME_TYPESCRIPT_NODES,
} from "./constants.js";

interface SlateCurrentFocusProviderContext {
  readonly filename?: string;
  readonly scopes: ScopeAnalysis;
}

const hasReadonlyFocusProviderReferences = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  getRuntimeSymbolReferences(symbol).every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );

const isOrdinaryFocusProviderRead = (identifier: EsTreeNode): boolean => {
  const member = identifier.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== identifier ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "isFocused"
  )
    return false;
  const call = member.parent;
  return Boolean(
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.callee === member &&
    call.arguments.length === 1 &&
    isNodeOfType(call.arguments[0], "Identifier"),
  );
};

const hasClosedReactNamespaceReferences = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  hasReadonlyFocusProviderReferences(symbol, scopes) &&
  getRuntimeSymbolReferences(symbol).every((reference) => {
    const member = reference.identifier.parent;
    const call = member?.parent;
    return Boolean(
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      !member.computed &&
      !member.optional &&
      isNodeOfType(member.property, "Identifier") &&
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === member,
    );
  });

const hasOrdinaryFocusProviderCapabilities = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      SLATE_CURRENT_FOCUS_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement")
    ) {
      supported = false;
      return false;
    }
    if (isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.referenceFor(node) &&
      SLATE_CURRENT_FOCUS_UNSUPPORTED_IDENTIFIERS.has(node.name)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "MemberExpression") &&
        (SLATE_CURRENT_FOCUS_UNSUPPORTED_MEMBERS.has(getStaticPropertyName(node) ?? "") ||
          (node.computed && getStaticPropertyName(node) === null))) ||
      (isNodeOfType(node, "Property") &&
        (((isNodeOfType(node.parent, "ObjectPattern") || node.computed || node.shorthand) &&
          SLATE_CURRENT_FOCUS_UNSUPPORTED_MEMBERS.has(getStaticKeyName(node.key) ?? "")) ||
          (node.computed && !isNodeOfType(node.key, "Literal"))))
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.source.value !== "react") return;
    for (const specifier of node.specifiers) {
      if (
        !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
        !isNodeOfType(specifier, "ImportNamespaceSpecifier")
      )
        continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol || !hasClosedReactNamespaceReferences(symbol, scopes)) {
        supported = false;
        return false;
      }
    }
  });
  return supported;
};

const hasSupportedSlateCurrentFocusMetadata = (filename: string): boolean => {
  const resolved = resolvePackageVersion(filename, "slate-dom", {
    rejectInvalidResolvedManifest: true,
  });
  return Boolean(
    resolved &&
    !resolved.version.isPrerelease &&
    comparePackageVersions(resolved.version, SLATE_CURRENT_FOCUS_SUPPORTED_VERSION) === 0 &&
    (resolved.declaredRange === null ||
      resolved.declaredRange === SLATE_CURRENT_FOCUS_DECLARED_RANGE),
  );
};

const isNamedRuntimeProviderImport = (symbol: SymbolDescriptor): boolean =>
  isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
  getValueImportSource(symbol) === "slate-dom" &&
  getImportedName(symbol.declarationNode) === "DOMEditor";

const hasUniqueRuntimeFocusBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.scope.symbols.every(
    (candidate) =>
      candidate === symbol ||
      candidate.name !== symbol.name ||
      candidate.kind === "ts-interface" ||
      candidate.kind === "ts-type-alias",
  );

const getSlateFocusFacadeOrigin = (filename: string, source: string, importedName: string) => {
  if (!source.startsWith(".")) return null;
  const immediatePath = resolveModulePath(filename, source);
  const resolved = resolveCrossFileValueExportWithFilePath(filename, source, importedName);
  if (!immediatePath || !resolved || resolved.filePath !== immediatePath) return null;
  const initializer = resolved.exportedNode;
  const declarator = initializer.parent;
  const declaration = declarator?.parent;
  const exported = declaration?.parent;
  if (
    !isNodeOfType(initializer, "Identifier") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== initializer ||
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.id.name !== importedName ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(exported, "ExportNamedDeclaration") ||
    exported.declaration !== declaration ||
    exported.parent !== resolved.programNode ||
    !isNodeOfType(resolved.programNode, "Program")
  )
    return null;
  const providerScopes = analyzeScopes(resolved.programNode);
  const facadeSymbol = providerScopes.symbolFor(declarator.id);
  const importedSymbol = providerScopes.symbolFor(initializer);
  if (!facadeSymbol || !importedSymbol || !isNamedRuntimeProviderImport(importedSymbol))
    return null;
  return {
    resolved,
    providerProgram: resolved.programNode,
    initializer,
    providerScopes,
    facadeSymbol,
    importedSymbol,
  };
};

const hasClosedSlateFocusImports = (
  program: EsTreeNode,
  filename: string,
  selectedSymbol: SymbolDescriptor,
  selectedFacadeFile: string | null = null,
  selectedFacadeExport: string | null = null,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration") || isTypeOnlyImport(statement)) continue;
    const source = statement.source.value;
    if (typeof source !== "string") continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier === selectedSymbol.declarationNode ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
      )
        continue;
      const importedName = getImportedName(specifier);
      if (source === "slate-dom") {
        if (
          !isNodeOfType(specifier, "ImportSpecifier") ||
          importedName === "DOMEditor" ||
          importedName === "default"
        )
          return false;
        continue;
      }
      if (!source.startsWith(".")) continue;
      if (
        selectedFacadeFile &&
        (!isNodeOfType(specifier, "ImportSpecifier") ||
          importedName === selectedFacadeExport ||
          importedName === "default") &&
        resolveModulePath(filename, source) === selectedFacadeFile
      )
        return false;
      if (importedName && getSlateFocusFacadeOrigin(filename, source, importedName)) return false;
    }
  }
  return true;
};

export const isSlateCurrentFocusProvider = (
  context: SlateCurrentFocusProviderContext,
  receiver: EsTreeNode,
): boolean => {
  try {
    if (!context.filename || !isNodeOfType(receiver, "Identifier")) return false;
    const scopes = context.scopes;
    const program = scopes.rootScope.node;
    const symbol = scopes.symbolFor(receiver);
    if (
      !symbol ||
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      !hasUniqueRuntimeFocusBinding(symbol) ||
      !hasReadonlyFocusProviderReferences(symbol, scopes) ||
      !getRuntimeSymbolReferences(symbol).every((reference) =>
        isOrdinaryFocusProviderRead(reference.identifier),
      ) ||
      !hasOrdinaryFocusProviderCapabilities(program, scopes)
    )
      return false;
    if (isNamedRuntimeProviderImport(symbol)) {
      return (
        hasClosedSlateFocusImports(program, context.filename, symbol) &&
        hasSupportedSlateCurrentFocusMetadata(context.filename)
      );
    }
    const source = getValueImportSource(symbol);
    const importedName = getImportedName(symbol.declarationNode);
    if (!source?.startsWith(".") || !importedName) return false;
    const origin = getSlateFocusFacadeOrigin(context.filename, source, importedName);
    if (
      !origin ||
      !hasClosedSlateFocusImports(
        program,
        context.filename,
        symbol,
        origin.resolved.filePath,
        importedName,
      )
    )
      return false;
    const { resolved, providerProgram, initializer, providerScopes, facadeSymbol, importedSymbol } =
      origin;
    const importedRuntimeReferences = getRuntimeSymbolReferences(importedSymbol);
    if (
      !facadeSymbol ||
      !importedSymbol ||
      getDirectConstInitializer(facadeSymbol) !== initializer ||
      !hasUniqueRuntimeFocusBinding(facadeSymbol) ||
      !hasUniqueRuntimeFocusBinding(importedSymbol) ||
      !isNamedRuntimeProviderImport(importedSymbol) ||
      !hasReadonlyFocusProviderReferences(facadeSymbol, providerScopes) ||
      !hasReadonlyFocusProviderReferences(importedSymbol, providerScopes) ||
      getRuntimeSymbolReferences(facadeSymbol).length !== 0 ||
      importedRuntimeReferences.length !== 1 ||
      importedRuntimeReferences[0]?.identifier !== initializer ||
      !hasOrdinaryFocusProviderCapabilities(providerProgram, providerScopes) ||
      !hasClosedSlateFocusImports(providerProgram, resolved.filePath, importedSymbol)
    )
      return false;
    let exportedNames = 0;
    for (const statement of providerProgram.body) {
      if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.exportKind === "type")
        continue;
      const candidate = statement.declaration;
      if (isNodeOfType(candidate, "VariableDeclaration")) {
        for (const binding of candidate.declarations) {
          if (isNodeOfType(binding.id, "Identifier") && binding.id.name === importedName)
            exportedNames += 1;
        }
      }
      for (const specifier of statement.specifiers) {
        if (
          isNodeOfType(specifier, "ExportSpecifier") &&
          specifier.exportKind !== "type" &&
          ((isNodeOfType(specifier.exported, "Identifier") &&
            specifier.exported.name === importedName) ||
            (isNodeOfType(specifier.exported, "Literal") &&
              specifier.exported.value === importedName))
        )
          exportedNames += 1;
      }
    }
    return exportedNames === 1 && hasSupportedSlateCurrentFocusMetadata(resolved.filePath);
  } catch {
    return false;
  }
};
