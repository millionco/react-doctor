import * as path from "node:path";
import {
  RC_UTIL_CONTROLLED_STATE_EXPORT,
  RC_UTIL_CONTROLLED_STATE_VERSION,
  RC_UTIL_NATIVE_STATE_SOURCES,
  RC_UTIL_PACKAGE_NAME,
} from "../constants/rc-util.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenCommonjsReactApiCall } from "./is-proven-commonjs-react-api-call.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveCommonjsDefaultFunctionExport } from "./resolve-commonjs-default-function-export.js";
import { resolveCommonjsPackageFile } from "./resolve-commonjs-package-file.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolvePackageVersion } from "./resolve-package-version.js";
import { resolveReturnedNativeStateSetter } from "./resolve-returned-native-state-setter.js";
import { hasTsconfigAliasOrUnsupportedRouting } from "./resolve-tsconfig-alias.js";
import { walkAst } from "./walk-ast.js";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasKnownPackageOverride = (value: unknown): boolean => {
  if (value === undefined) return false;
  if (!isObjectRecord(value)) return true;
  const pendingValues = [value];
  while (pendingValues.length > 0) {
    const overrides = pendingValues.pop();
    if (!overrides) continue;
    for (const [selector, overrideValue] of Object.entries(overrides)) {
      if (
        selector.includes("*") ||
        selector
          .split(">")
          .some((segment) =>
            [...RC_UTIL_NATIVE_STATE_SOURCES].some(
              (source) => segment.trim() === source || segment.trim().startsWith(`${source}@`),
            ),
          )
      ) {
        return true;
      }
      if (isObjectRecord(overrideValue)) pendingValues.push(overrideValue);
    }
  }
  return false;
};

const hasOpaqueConsumerLoader = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasOpaqueAccess = false;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "require" || node.name === "eval") &&
      scopes.isGlobalReference(node)
    ) {
      hasOpaqueAccess = true;
      return false;
    }
  });
  return hasOpaqueAccess;
};

const hasUnsupportedManifestRouting = (
  manifest: ReturnType<typeof readPackageManifest>,
): boolean => {
  if (!manifest) return false;
  const pnpm = manifest.pnpm;
  if (
    (isObjectRecord(manifest.browser) && hasKnownPackageOverride(manifest.browser)) ||
    hasKnownPackageOverride(manifest.overrides) ||
    hasKnownPackageOverride(manifest.resolutions) ||
    (pnpm !== undefined && !isObjectRecord(pnpm)) ||
    (isObjectRecord(pnpm) &&
      (hasKnownPackageOverride(pnpm.overrides) ||
        hasKnownPackageOverride(pnpm.patchedDependencies)))
  ) {
    return true;
  }
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].some((dependencies) =>
    [...RC_UTIL_NATIVE_STATE_SOURCES].some((source) => {
      const declaredVersion = dependencies?.[source];
      return (
        typeof declaredVersion === "string" &&
        /^(?:npm|file|link|workspace|https?|git):/.test(declaredVersion.trim())
      );
    }),
  );
};

const proveInstalledPackage = (filename: string): boolean => {
  const owningDirectory = findNearestPackageDirectory(filename);
  if (!owningDirectory) return false;
  let routingDirectory = owningDirectory;
  while (true) {
    if (hasUnsupportedManifestRouting(readPackageManifest(routingDirectory))) return false;
    const parentDirectory = path.dirname(routingDirectory);
    if (parentDirectory === routingDirectory) break;
    routingDirectory = parentDirectory;
  }
  if (hasTsconfigAliasOrUnsupportedRouting(filename, RC_UTIL_NATIVE_STATE_SOURCES)) return false;
  const version = resolvePackageVersion(filename, RC_UTIL_PACKAGE_NAME);
  if (!version || version.declaredRange !== null) return false;
  let ancestorDirectory = owningDirectory;
  while (true) {
    const packageDirectory = path.join(ancestorDirectory, "node_modules", RC_UTIL_PACKAGE_NAME);
    const manifest = readPackageManifest(packageDirectory);
    if (manifest) {
      if (
        manifest.name !== RC_UTIL_PACKAGE_NAME ||
        manifest.version !== RC_UTIL_CONTROLLED_STATE_VERSION ||
        hasUnsupportedManifestRouting(manifest) ||
        manifest.exports !== undefined ||
        manifest.browser !== undefined ||
        manifest["react-native"] !== undefined ||
        manifest.type !== undefined ||
        typeof manifest.main !== "string" ||
        typeof manifest.module !== "string"
      ) {
        return false;
      }
      const manifestPath = path.join(packageDirectory, "package.json");
      const mainPath = resolveCommonjsPackageFile(manifestPath, manifest.main, packageDirectory);
      const modulePath = resolveCommonjsPackageFile(
        manifestPath,
        manifest.module,
        packageDirectory,
      );
      if (!mainPath || !modulePath) return false;
      const commonjs = resolveCommonjsDefaultFunctionExport(
        mainPath,
        RC_UTIL_CONTROLLED_STATE_EXPORT,
        packageDirectory,
      );
      if (
        !commonjs ||
        !resolveReturnedNativeStateSetter(commonjs.functionNode, commonjs.scopes, (call) =>
          isProvenCommonjsReactApiCall(call, "useState", commonjs.scopes),
        )
      ) {
        return false;
      }
      const relativeModuleSource = `./${path.relative(packageDirectory, modulePath).split(path.sep).join("/")}`;
      const esm = resolveCrossFileFunctionExportWithFilePath(
        manifestPath,
        relativeModuleSource,
        RC_UTIL_CONTROLLED_STATE_EXPORT,
      );
      if (!esm || !esm.filePath.endsWith(".js")) return false;
      const relativeHelperPath = path.relative(packageDirectory, esm.filePath);
      if (relativeHelperPath.startsWith("..") || path.isAbsolute(relativeHelperPath)) return false;
      const esmScopes = analyzeScopes(esm.programNode);
      return Boolean(
        resolveReturnedNativeStateSetter(esm.functionNode, esmScopes, (call) =>
          isProvenUnmodifiedReactApiCall(call, "useState", esmScopes),
        ),
      );
    }
    const parentDirectory = path.dirname(ancestorDirectory);
    if (parentDirectory === ancestorDirectory) return false;
    ancestorDirectory = parentDirectory;
  }
};

export const isProvenRcUtilControlledStateCall = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (
    !filename ||
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(node.callee);
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  const program = findProgramRoot(node);
  if (
    symbol?.kind !== "import" ||
    !declaration ||
    declaration.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    declaration.source.value !== RC_UTIL_PACKAGE_NAME ||
    getImportedName(symbol.declarationNode) !== RC_UTIL_CONTROLLED_STATE_EXPORT ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    !program ||
    hasOpaqueConsumerLoader(program, scopes) ||
    hasReactDefaultProviderMutation("useState", scopes)
  ) {
    return false;
  }
  return proveInstalledPackage(path.resolve(filename));
};
