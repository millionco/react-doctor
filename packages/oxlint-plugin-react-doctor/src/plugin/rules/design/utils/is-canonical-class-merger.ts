import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getSymbolReferenceIndex } from "../../../utils/get-symbol-reference-index.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import {
  hasCanonicalPackageDependency,
  resolvePackageVersion,
} from "../../../utils/resolve-package-version.js";
import { findNearestPackageDirectory } from "../../../utils/read-nearest-package-manifest.js";
import { getTsconfigPackageProviderStatus } from "../../../utils/resolve-tsconfig-alias.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  CLOSED_CLASS_MERGER_PACKAGES,
  CLOSED_CLASS_MERGER_RESOLUTION_LIMIT,
  CLOSED_CLASS_MERGER_VERSIONS,
} from "./closed-class-merger/constants.js";
import { getPackageProviderConfigStatus } from "./get-package-provider-config-status.js";
import { hasClosedMergerIntrinsics } from "./has-closed-merger-intrinsics.js";

interface MergerSource {
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly filename: string;
}

interface CanonicalMergerShape {
  readonly merger: EsTreeNode;
  readonly normalizer: EsTreeNode;
}

const sourceByProgram = new WeakMap<EsTreeNode, MergerSource>();
const shapeByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, CanonicalMergerShape | null>
>();

const hasStableBinding = (symbol: SymbolDescriptor, source: MergerSource): boolean =>
  isSymbolReadOnly(symbol) && hasCompleteSymbolReferences(symbol, source.program, source.scopes);

const hasParameterEnvironmentAmbiguity = (
  symbol: SymbolDescriptor,
  source: MergerSource,
): boolean => {
  for (const [other, nodes] of getSymbolReferenceIndex(source.program, source.scopes)
    .resolvedNodes) {
    if (other === symbol || other.name !== symbol.name) continue;
    for (const node of nodes) {
      let ancestor: EsTreeNode = node;
      while (ancestor.parent && !isFunctionLike(ancestor.parent)) ancestor = ancestor.parent;
      if (
        isFunctionLike(ancestor.parent) &&
        ancestor.parent.params.some((parameter) => parameter === ancestor)
      )
        return true;
    }
  }
  return false;
};

const isCanonicalProvider = (
  expression: EsTreeNode,
  source: MergerSource,
  packageName: string,
  exportName: string,
  remaining = CLOSED_CLASS_MERGER_RESOLUTION_LIMIT,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!remaining || !isNodeOfType(candidate, "Identifier")) return false;
  const symbol = source.scopes.symbolFor(candidate);
  if (!symbol || !hasStableBinding(symbol, source)) return false;
  if (symbol.kind !== "import") {
    const initializer = getDirectConstInitializer(symbol);
    return Boolean(
      initializer &&
      isCanonicalProvider(initializer, source, packageName, exportName, remaining - 1),
    );
  }
  const declaration = getImportDeclarationForSymbol(symbol);
  const imported = resolveImportedApiReference(candidate, source.scopes);
  return Boolean(
    declaration?.parent === source.program &&
    imported?.source === packageName &&
    (imported.importedName === exportName ||
      (packageName === "clsx" && imported.importedName === "default")) &&
    !imported.isNamespace &&
    getTsconfigPackageProviderStatus(source.filename, packageName) === "external",
  );
};

const getCanonicalShape = (
  functionNode: EsTreeNode,
  source: MergerSource,
): CanonicalMergerShape | null => {
  let shapes = shapeByScopes.get(source.scopes);
  if (!shapes) {
    shapes = new WeakMap();
    shapeByScopes.set(source.scopes, shapes);
  }
  const cached = shapes.get(functionNode);
  if (cached !== undefined) return cached;
  shapes.set(functionNode, null);
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length !== 1
  )
    return null;
  const parameter = functionNode.params[0];
  if (!isNodeOfType(parameter, "RestElement") || !isNodeOfType(parameter.argument, "Identifier"))
    return null;
  const bindings = getFunctionBindingSymbols(functionNode, source.scopes);
  if (
    !bindings.every(
      (binding) =>
        hasStableBinding(binding, source) && !hasParameterEnvironmentAmbiguity(binding, source),
    )
  )
    return null;
  if (
    getSymbolReferenceIndex(source.program, source.scopes)
      .ambiguousNodes.get("eval")
      ?.some(
        (node) =>
          source.scopes.isGlobalReference(node) &&
          isNodeOfType(node.parent, "CallExpression") &&
          node.parent.callee === node,
      )
  )
    return null;
  const returned = getSingleReturnExpression(functionNode);
  if (!returned) return null;
  const mergerCall = stripParenExpression(returned);
  if (
    !isNodeOfType(mergerCall, "CallExpression") ||
    mergerCall.optional ||
    mergerCall.arguments.length !== 1
  )
    return null;
  const normalizedArgument = mergerCall.arguments[0];
  if (!normalizedArgument) return null;
  const normalizerCall = stripParenExpression(normalizedArgument);
  if (
    !isNodeOfType(normalizerCall, "CallExpression") ||
    normalizerCall.optional ||
    normalizerCall.arguments.length !== 1
  )
    return null;
  const restArgument = normalizerCall.arguments[0];
  if (!restArgument) return null;
  const argument = stripParenExpression(restArgument);
  const parameterSymbol = source.scopes.symbolFor(parameter.argument);
  if (
    !isNodeOfType(argument, "Identifier") ||
    !parameterSymbol ||
    source.scopes.symbolFor(argument) !== parameterSymbol ||
    !hasStableBinding(parameterSymbol, source) ||
    parameterSymbol.references.length !== 1 ||
    parameterSymbol.references[0]?.identifier !== argument
  )
    return null;
  const shape = { merger: mergerCall.callee, normalizer: normalizerCall.callee };
  shapes.set(functionNode, shape);
  return shape;
};

const isCanonicalFunction = (functionNode: EsTreeNode, source: MergerSource): boolean => {
  const shape = getCanonicalShape(functionNode, source);
  return Boolean(
    shape &&
    hasClosedMergerIntrinsics(source.program, source.scopes) &&
    getPackageProviderConfigStatus(source.filename, CLOSED_CLASS_MERGER_PACKAGES) === "external" &&
    isCanonicalProvider(shape.merger, source, "tailwind-merge", "twMerge") &&
    isCanonicalProvider(shape.normalizer, source, "clsx", "clsx") &&
    hasSupportedVersions(source),
  );
};

const hasSupportedVersions = (source: MergerSource): boolean => {
  for (const [packageName, expected] of CLOSED_CLASS_MERGER_VERSIONS) {
    if (!hasCanonicalPackageDependency(source.filename, packageName)) return false;
    const resolved = resolvePackageVersion(source.filename, packageName);
    if (
      !resolved ||
      resolved.version.isPrerelease ||
      `${resolved.version.major}.${resolved.version.minor}.${resolved.version.patch}` !==
        expected ||
      (resolved.declaredRange !== null && resolved.declaredRange.trim() !== expected)
    )
      return false;
  }
  return true;
};

const resolveMerger = (
  expression: EsTreeNode,
  source: MergerSource,
  remaining: number,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!remaining || !isNodeOfType(candidate, "Identifier")) return false;
  const symbol = source.scopes.symbolFor(candidate);
  if (!symbol || !hasStableBinding(symbol, source)) return false;
  if (symbol.kind === "import") {
    const imported = resolveImportedApiReference(candidate, source.scopes);
    if (!imported?.importedName || imported.isNamespace || !imported.source.startsWith("."))
      return false;
    const modulePath = resolveModulePath(source.filename, imported.source);
    if (!modulePath) return false;
    let realModulePath: string;
    try {
      realModulePath = fs.realpathSync(modulePath);
      const owningPackage = findNearestPackageDirectory(modulePath);
      if (
        !owningPackage ||
        path.relative(owningPackage, modulePath) !==
          path.relative(fs.realpathSync(owningPackage), realModulePath)
      )
        return false;
    } catch {
      return false;
    }
    const selectedImports = new Set([
      ...CLOSED_CLASS_MERGER_PACKAGES,
      imported.source,
      modulePath,
      modulePath.replace(/\.[cm]?[jt]sx?$/, ""),
      realModulePath,
      realModulePath.replace(/\.[cm]?[jt]sx?$/, ""),
    ]);
    if (getPackageProviderConfigStatus(source.filename, selectedImports) !== "external")
      return false;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      source.filename,
      imported.source,
      imported.importedName,
    );
    if (!resolved || resolved.filePath !== modulePath) return false;
    let importedSource = sourceByProgram.get(resolved.programNode);
    if (!importedSource) {
      importedSource = {
        program: resolved.programNode,
        scopes: analyzeScopes(resolved.programNode),
        filename: resolved.filePath,
      };
      sourceByProgram.set(resolved.programNode, importedSource);
    }
    return isCanonicalFunction(resolved.functionNode, importedSource);
  }
  const initializer = getDirectConstInitializer(symbol);
  if (initializer && isNodeOfType(stripParenExpression(initializer), "Identifier"))
    return resolveMerger(initializer, source, remaining - 1);
  const functionNode = initializer ?? symbol.declarationNode;
  return isCanonicalFunction(functionNode, source);
};

export const isCanonicalClassMerger = (expression: EsTreeNode, context: RuleContext): boolean => {
  const program = findProgramRoot(expression);
  return Boolean(
    program &&
    context.filename &&
    hasClosedMergerIntrinsics(program, context.scopes) &&
    getPackageProviderConfigStatus(context.filename, CLOSED_CLASS_MERGER_PACKAGES) === "external" &&
    resolveMerger(
      expression,
      { program, scopes: context.scopes, filename: context.filename },
      CLOSED_CLASS_MERGER_RESOLUTION_LIMIT,
    ),
  );
};
import * as fs from "node:fs";
import * as path from "node:path";
