import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { ResolvedCrossFileValueExport } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  IMPORTED_IMAGE_FIRST_ITEM_INDEX,
  IMPORTED_IMAGE_RUNTIME_TYPESCRIPT_NODES,
  IMPORTED_IMAGE_SINGLE_ITEM_COUNT,
  IMPORTED_IMAGE_UNSUPPORTED_GLOBAL_NAMES,
  IMPORTED_IMAGE_UNSUPPORTED_MEMBER_NAMES,
} from "./constants.js";

interface ImportedBundledImageSourcesInput {
  specifier: EsTreeNode;
  context: RuleContext;
  bundledAssetSourcePattern: RegExp;
}

interface ImportedAssetAliasIndex {
  named: ReadonlyMap<string, ReadonlyMap<string, readonly SymbolDescriptor[]>>;
  exposedModules: ReadonlySet<string>;
}

const runtimeBindingCounts = new WeakMap<ScopeAnalysis, ReadonlyMap<string, number>>();
const importedAliasIndexes = new WeakMap<ScopeAnalysis, ImportedAssetAliasIndex>();

const getRuntimeBindingCounts = (scopes: ScopeAnalysis): ReadonlyMap<string, number> => {
  const cached = runtimeBindingCounts.get(scopes);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const symbol of scopes.rootScope.symbols) {
    if (!isErasedTypeScriptBinding(symbol))
      counts.set(symbol.name, (counts.get(symbol.name) ?? 0) + 1);
  }
  runtimeBindingCounts.set(scopes, counts);
  return counts;
};

const getImportedAssetAliasIndex = (
  filename: string,
  scopes: ScopeAnalysis,
): ImportedAssetAliasIndex => {
  const cached = importedAliasIndexes.get(scopes);
  if (cached) return cached;
  const named = new Map<string, Map<string, SymbolDescriptor[]>>();
  const exposedModules = new Set<string>();
  for (const alias of scopes.rootScope.symbols) {
    const declaration = getValueImportDeclaration(alias);
    if (
      !isNodeOfType(declaration, "ImportDeclaration") ||
      typeof declaration.source.value !== "string"
    )
      continue;
    const filePath = resolveModulePath(filename, declaration.source.value);
    if (!filePath) continue;
    const binding = alias.declarationNode;
    if (!isNodeOfType(binding, "ImportSpecifier")) {
      if (alias.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
        exposedModules.add(filePath);
      continue;
    }
    const exportedName = getImportedName(binding);
    if (!exportedName) continue;
    let byExportName = named.get(filePath);
    if (!byExportName) {
      byExportName = new Map();
      named.set(filePath, byExportName);
    }
    const aliases = byExportName.get(exportedName);
    if (aliases) aliases.push(alias);
    else byExportName.set(exportedName, [alias]);
  }
  const index = { named, exposedModules };
  importedAliasIndexes.set(scopes, index);
  return index;
};

const supportedAssetPrograms = new WeakMap<ScopeAnalysis, boolean>();
const exporterAnalyses = new WeakMap<EsTreeNode, ScopeAnalysis>();
const exportedMapKeys = new WeakMap<EsTreeNode, ReadonlySet<string> | null>();
const importedMapKeys = new WeakMap<SymbolDescriptor, ReadonlySet<string> | null>();
const importedMapProofs = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlySet<string> | null>
>();

const hasSupportedAssetProgram = (scopes: ScopeAnalysis): boolean => {
  let supported = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    const isPropertyRead =
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"));
    const propertyName = isPropertyRead
      ? getResolvedStaticPropertyName(node, scopes, { stringifyNonStringLiterals: true })
      : null;
    if (
      ("declare" in node && node.declare === true) ||
      node.type === "WithStatement" ||
      node.type === "ImportExpression" ||
      IMPORTED_IMAGE_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      (isPropertyRead &&
        (IMPORTED_IMAGE_UNSUPPORTED_MEMBER_NAMES.has(propertyName ?? "") ||
          ("computed" in node && node.computed && propertyName === null)))
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      !scopes.referenceFor(node)
    )
      return undefined;
    const symbol = scopes.symbolFor(node);
    if (
      (symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol)) ||
      node.name === "arguments" ||
      (IMPORTED_IMAGE_UNSUPPORTED_GLOBAL_NAMES.has(node.name) && scopes.isGlobalReference(node))
    ) {
      supported = false;
      return false;
    }
    return undefined;
  });
  if (!supported) return false;
  for (const provider of scopes.rootScope.symbols) {
    const declaration = getValueImportDeclaration(provider);
    if (
      !isNodeOfType(declaration, "ImportDeclaration") ||
      declaration.source.value !== "react-native"
    )
      continue;
    const binding = provider.declarationNode;
    if (!isNodeOfType(binding, "ImportSpecifier") || getImportedName(binding) === "default") {
      if (provider.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
        return false;
    } else if (
      (getImportedName(binding) === "Image" || getImportedName(binding) === "ImageBackground") &&
      !isOnlyJsxImageReference(provider)
    )
      return false;
  }
  return true;
};

const isSupportedAssetProgram = (scopes: ScopeAnalysis): boolean => {
  const cached = supportedAssetPrograms.get(scopes);
  if (cached !== undefined) return cached;
  const supported = hasSupportedAssetProgram(scopes);
  supportedAssetPrograms.set(scopes, supported);
  return supported;
};

const hasOnlyReadonlyMapMembers = (symbol: SymbolDescriptor, keys: ReadonlySet<string>): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    const root = findTransparentExpressionRoot(identifier);
    const member = root.parent;
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(identifier) &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === root &&
      !member.optional &&
      keys.has(getStaticPropertyName(member) ?? "") &&
      !isNodeOfType(member.parent, "MemberExpression")
    );
  });

const isOnlyJsxImageReference = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    const parent = identifier.parent;
    return (
      reference.flag === "read" &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

const findExportedBundledMapKeys = (
  resolved: ResolvedCrossFileValueExport,
  exportedName: string,
  bundledAssetSourcePattern: RegExp,
): ReadonlySet<string> | null => {
  const object = resolved.exportedNode;
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const objectRoot = findTransparentExpressionRoot(object);
  const declaration = objectRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== objectRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.id.name !== exportedName ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.parent.parent, "ExportNamedDeclaration")
  )
    return null;
  let exporterScopes = exporterAnalyses.get(resolved.programNode);
  if (!exporterScopes) {
    exporterScopes = analyzeScopes(resolved.programNode);
    exporterAnalyses.set(resolved.programNode, exporterScopes);
  }
  const exportedMap = exporterScopes.symbolFor(declaration.id);
  if (
    !exportedMap ||
    exporterScopes.scopeFor(declaration) !== exporterScopes.rootScope ||
    !isSupportedAssetProgram(exporterScopes) ||
    getRuntimeBindingCounts(exporterScopes).get(exportedName) !== IMPORTED_IMAGE_SINGLE_ITEM_COUNT
  )
    return null;
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(stripParenExpression(property.value), "Identifier")
    )
      return null;
    const propertyName = getStaticKeyName(property.key);
    const asset = exporterScopes.symbolFor(stripParenExpression(property.value));
    const assetImport = asset ? getValueImportDeclaration(asset) : null;
    if (
      propertyName === null ||
      keys.has(propertyName) ||
      !asset ||
      !isNodeOfType(asset.declarationNode, "ImportDefaultSpecifier") ||
      !isNodeOfType(assetImport, "ImportDeclaration") ||
      typeof assetImport.source.value !== "string" ||
      !bundledAssetSourcePattern.test(assetImport.source.value) ||
      asset.references.some((reference) => {
        if (isTypeScriptTypePosition(reference.identifier)) return false;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        return (
          reference.flag !== "read" ||
          isWithinAssignmentTarget(reference.identifier) ||
          !isNodeOfType(parent, "Property") ||
          parent.parent !== object ||
          (parent.value !== root && !(parent.shorthand && parent.key === root))
        );
      })
    )
      return null;
    keys.add(propertyName);
  }
  if (!hasOnlyReadonlyMapMembers(exportedMap, keys)) return null;
  return keys;
};

const getExportedBundledMapKeys = (
  resolved: ResolvedCrossFileValueExport,
  exportedName: string,
  bundledAssetSourcePattern: RegExp,
): ReadonlySet<string> | null => {
  const cached = exportedMapKeys.get(resolved.exportedNode);
  if (cached !== undefined) return cached;
  const keys = findExportedBundledMapKeys(resolved, exportedName, bundledAssetSourcePattern);
  exportedMapKeys.set(resolved.exportedNode, keys);
  return keys;
};

const findImportedBundledMapKeys = (
  map: SymbolDescriptor,
  filename: string,
  scopes: ScopeAnalysis,
  bundledAssetSourcePattern: RegExp,
): ReadonlySet<string> | null => {
  const imported = getValueImportDeclaration(map);
  if (
    !isNodeOfType(map.declarationNode, "ImportSpecifier") ||
    !isNodeOfType(imported, "ImportDeclaration") ||
    typeof imported.source.value !== "string"
  )
    return null;
  const exportedName = getImportedName(map.declarationNode);
  if (!exportedName) return null;
  const directPath = resolveModulePath(filename, imported.source.value);
  const resolved = resolveCrossFileValueExportWithFilePath(
    filename,
    imported.source.value,
    exportedName,
  );
  if (
    !directPath ||
    !resolved ||
    resolved.filePath !== directPath ||
    !isNodeOfType(resolved.exportedNode, "ObjectExpression")
  )
    return null;
  let proofs = importedMapProofs.get(scopes);
  if (!proofs) {
    proofs = new WeakMap();
    importedMapProofs.set(scopes, proofs);
  }
  const cached = proofs.get(resolved.exportedNode);
  if (cached !== undefined) return cached;
  const keys = getExportedBundledMapKeys(resolved, exportedName, bundledAssetSourcePattern);
  if (!keys) return null;
  const aliases = getImportedAssetAliasIndex(filename, scopes);
  if (aliases.exposedModules.has(directPath)) {
    proofs.set(resolved.exportedNode, null);
    return null;
  }
  for (const alias of aliases.named.get(directPath)?.get(exportedName) ?? []) {
    if (!hasOnlyReadonlyMapMembers(alias, keys)) {
      proofs.set(resolved.exportedNode, null);
      return null;
    }
  }
  proofs.set(resolved.exportedNode, keys);
  return keys;
};

const getImportedBundledMapKeys = (
  map: SymbolDescriptor,
  filename: string,
  scopes: ScopeAnalysis,
  bundledAssetSourcePattern: RegExp,
): ReadonlySet<string> | null => {
  const cached = importedMapKeys.get(map);
  if (cached !== undefined) return cached;
  const keys = findImportedBundledMapKeys(map, filename, scopes, bundledAssetSourcePattern);
  importedMapKeys.set(map, keys);
  return keys;
};

export const hasOnlyImportedBundledImageSources = ({
  specifier,
  context,
  bundledAssetSourcePattern,
}: ImportedBundledImageSourcesInput): boolean => {
  if (!context.filename || !isNodeOfType(specifier, "ImportSpecifier")) return false;
  const scopes = context.scopes;
  const image = scopes.symbolFor(specifier.local);
  if (!image || !isSupportedAssetProgram(scopes)) return false;
  const openings = image.references
    .filter((reference) => !isTypeScriptTypePosition(reference.identifier))
    .map((reference) => reference.identifier.parent)
    .filter((node) => isNodeOfType(node, "JSXOpeningElement"));
  if (openings.length < IMPORTED_IMAGE_SINGLE_ITEM_COUNT) return false;
  for (const opening of openings) {
    if (!isNodeOfType(opening, "JSXOpeningElement")) return false;
    if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
      return false;
    const attributes = opening.attributes.filter(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "source",
    );
    const attribute = attributes[IMPORTED_IMAGE_FIRST_ITEM_INDEX];
    if (
      attributes.length !== IMPORTED_IMAGE_SINGLE_ITEM_COUNT ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(stripParenExpression(attribute.value.expression), "MemberExpression")
    )
      return false;
    const member = stripParenExpression(attribute.value.expression);
    if (!isNodeOfType(member, "MemberExpression") || member.optional) return false;
    const mapIdentifier = stripParenExpression(member.object);
    if (!isNodeOfType(mapIdentifier, "Identifier")) return false;
    const key = getStaticPropertyName(member);
    const map = scopes.symbolFor(mapIdentifier);
    if (!key || !map) return false;
    const keys = getImportedBundledMapKeys(
      map,
      context.filename,
      scopes,
      bundledAssetSourcePattern,
    );
    if (!keys?.has(key)) return false;
  }
  return true;
};
