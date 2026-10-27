import * as fs from "node:fs";
import * as path from "node:path";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
} from "../../../constants/react.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { comparePackageVersions } from "../../../utils/compare-package-versions.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import { getOwnDataObjectProperties } from "../../../utils/get-own-data-object-properties.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parsePackageVersion } from "../../../utils/parse-package-version.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { resolvePackageVersion } from "../../../utils/resolve-package-version.js";
import { resolveWebpackAliasPath } from "../../../utils/resolve-webpack-alias-path.js";
import { isTsconfigObjectRecord } from "../../../utils/resolve-tsconfig-alias.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  STREAM_CHANNEL_LOCK_VERSION,
  STREAM_CHANNEL_PACKAGE_VERSIONS,
  STREAM_CHANNEL_ARCHIVE_URLS,
  STREAM_CHANNEL_ARCHIVE_INTEGRITIES,
  STREAM_CHANNEL_PROVIDER_SOURCES,
  CANONICAL_CONTROL_PAIR_COUNT,
  CANONICAL_CONTROL_LOCK_VERSIONS,
  CANONICAL_CONTROL_SCRIPT_RECIPES,
  CANONICAL_CONTROL_CRACO_STATEMENT_COUNT,
  CANONICAL_CONTROL_REFUSED_MANIFEST_FIELDS,
  CANONICAL_CONTROL_REFUSED_CONFIG_FILENAMES,
  CANONICAL_CONTROL_PROVIDER_SOURCES,
  CANONICAL_CONTROL_STYLED_MAJOR,
  FIREBASE_PASSWORD_SIGN_IN_VERSION,
  FIREBASE_PASSWORD_SIGN_IN_DECLARATION_PATTERN,
  FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_URL,
  FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_INTEGRITY,
  IMPORTED_NATIVE_CONTROL_SINGLE_COUNT,
} from "./constants.js";

interface CanonicalControlPackageProfileInput {
  readonly filename: string;
  readonly packageName: "firebase" | "styled-components" | "stream-chat" | "stream-chat-react";
}

const readOwnJson = (filename: string): Record<string, unknown> | null => {
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  if (
    !fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() ||
    fs.realpathSync(filename) !== filename
  )
    return null;
  const value: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
  return isTsconfigObjectRecord(value) && !Array.isArray(value) ? value : null;
};

const hasPlainCracoAliases = (
  filename: string,
  providerSources: ReadonlyArray<string> = CANONICAL_CONTROL_PROVIDER_SOURCES,
): boolean => {
  const program = parseSourceFile(filename);
  if (
    !isNodeOfType(program, "Program") ||
    program.body.length !== CANONICAL_CONTROL_CRACO_STATEMENT_COUNT
  )
    return false;
  const [pathStatement, resolverStatement, exportStatement] = program.body;
  if (
    !isNodeOfType(pathStatement, "VariableDeclaration") ||
    pathStatement.kind !== "const" ||
    pathStatement.declarations.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
    !isNodeOfType(resolverStatement, "VariableDeclaration") ||
    resolverStatement.kind !== "const" ||
    resolverStatement.declarations.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
    !isNodeOfType(exportStatement, "ExpressionStatement")
  )
    return false;
  const pathBinding = pathStatement.declarations[0];
  const resolverBinding = resolverStatement.declarations[0];
  if (
    !isNodeOfType(pathBinding.id, "Identifier") ||
    !isNodeOfType(pathBinding.init, "CallExpression") ||
    pathBinding.init.optional ||
    !isNodeOfType(pathBinding.init.callee, "Identifier") ||
    pathBinding.init.callee.name !== "require" ||
    pathBinding.init.arguments.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
    !isNodeOfType(pathBinding.init.arguments[0], "Literal") ||
    !["path", "node:path"].includes(String(pathBinding.init.arguments[0].value))
  )
    return false;
  const resolver = resolverBinding.init;
  if (
    !isNodeOfType(resolverBinding.id, "Identifier") ||
    !isNodeOfType(resolver, "ArrowFunctionExpression") ||
    resolver.async ||
    resolver.params.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
    !isNodeOfType(resolver.params[0], "Identifier") ||
    !isNodeOfType(resolver.body, "CallExpression") ||
    resolver.body.optional
  )
    return false;
  const call = resolver.body;
  if (
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    getStaticPropertyName(call.callee) !== "resolve" ||
    call.arguments.length !== CANONICAL_CONTROL_PAIR_COUNT ||
    !isNodeOfType(call.arguments[0], "Identifier") ||
    call.arguments[0].name !== "__dirname" ||
    !isNodeOfType(call.arguments[1], "Identifier")
  )
    return false;
  const assignment = exportStatement.expression;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    assignment.left.computed ||
    !isNodeOfType(assignment.left.object, "Identifier") ||
    assignment.left.object.name !== "module" ||
    getStaticPropertyName(assignment.left) !== "exports"
  )
    return false;
  const root = getOwnDataObjectProperties(assignment.right);
  const webpack =
    root?.size === IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ? root.get("webpack") : undefined;
  const webpackValues = webpack ? getOwnDataObjectProperties(webpack) : null;
  const rawAliases =
    webpackValues?.size === IMPORTED_NATIVE_CONTROL_SINGLE_COUNT
      ? webpackValues.get("alias")
      : undefined;
  const aliases = rawAliases ? getOwnDataObjectProperties(rawAliases) : null;
  if (!aliases) return false;
  const scopes = analyzeScopes(program);
  const pathSymbol = scopes.symbolFor(pathBinding.id);
  const resolverSymbol = scopes.symbolFor(resolverBinding.id);
  const parameter = scopes.symbolFor(resolver.params[0]);
  if (
    !pathSymbol ||
    !resolverSymbol ||
    !parameter ||
    scopes.symbolFor(call.callee.object) !== pathSymbol ||
    scopes.symbolFor(call.arguments[1]) !== parameter ||
    !scopes.isGlobalReference(call.arguments[0]) ||
    !scopes.isGlobalReference(pathBinding.init.callee) ||
    !scopes.isGlobalReference(assignment.left.object)
  )
    return false;
  const allowedResolverReads = new Set<EsTreeNode>();
  for (const [name, value] of aliases) {
    if (
      /[$*]/u.test(name) ||
      providerSources.some(
        (source) =>
          source === name || source.startsWith(name + "/") || name.startsWith(source + "/"),
      ) ||
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      !isNodeOfType(value.callee, "Identifier") ||
      scopes.symbolFor(value.callee) !== resolverSymbol ||
      value.arguments.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
      !isNodeOfType(value.arguments[0], "Literal") ||
      typeof value.arguments[0].value !== "string" ||
      !value.arguments[0].value.startsWith("./")
    )
      return false;
    allowedResolverReads.add(value.callee);
  }
  return (
    hasOnlyAllowedSymbolReads({
      symbol: pathSymbol,
      allowedIdentifiers: new Set([call.callee.object]),
      program,
      scopes,
    }) &&
    hasOnlyAllowedSymbolReads({
      symbol: parameter,
      allowedIdentifiers: new Set([call.arguments[1]]),
      program,
      scopes,
    }) &&
    hasOnlyAllowedSymbolReads({
      symbol: resolverSymbol,
      allowedIdentifiers: allowedResolverReads,
      program,
      scopes,
    })
  );
};

export const hasCanonicalControlPackageProfile = ({
  filename,
  packageName,
}: CanonicalControlPackageProfileInput): boolean => {
  try {
    const root = findNearestPackageDirectory(path.resolve(filename));
    if (!root) return false;
    const manifest = readPackageManifest(root);
    if (
      !manifest ||
      CANONICAL_CONTROL_REFUSED_MANIFEST_FIELDS.some((name) => Object.hasOwn(manifest, name))
    )
      return false;
    if (
      manifest.scripts !== undefined &&
      (!isTsconfigObjectRecord(manifest.scripts) ||
        Array.isArray(manifest.scripts) ||
        Object.values(manifest.scripts).some(
          (recipe) => typeof recipe !== "string" || !CANONICAL_CONTROL_SCRIPT_RECIPES.has(recipe),
        ))
    )
      return false;
    const declarations = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].flatMap((group) => (group && Object.hasOwn(group, packageName) ? [group[packageName]] : []));
    if (
      !declarations.length ||
      declarations.some((value) => typeof value !== "string") ||
      new Set(declarations).size !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT
    )
      return false;
    const declaration = declarations[0];
    if (typeof declaration !== "string") return false;
    const resolution = resolvePackageVersion(filename, packageName);
    if (!resolution || resolution.version.isPrerelease) return false;
    if (Object.hasOwn(STREAM_CHANNEL_PACKAGE_VERSIONS, packageName)) {
      const expected = parsePackageVersion(STREAM_CHANNEL_PACKAGE_VERSIONS[packageName]);
      const allowedDeclarations = new Set([
        STREAM_CHANNEL_PACKAGE_VERSIONS[packageName],
        "^" + STREAM_CHANNEL_PACKAGE_VERSIONS[packageName],
        "~" + STREAM_CHANNEL_PACKAGE_VERSIONS[packageName],
      ]);
      if (
        !expected ||
        !allowedDeclarations.has(declaration) ||
        comparePackageVersions(resolution.version, expected) !== 0
      )
        return false;
      if (
        resolution.declaredRange !== null &&
        declaration !== STREAM_CHANNEL_PACKAGE_VERSIONS[packageName]
      ) {
        const lock = readOwnJson(path.join(root, "package-lock.json"));
        if (
          !lock ||
          lock.lockfileVersion !== STREAM_CHANNEL_LOCK_VERSION ||
          lock.name !== manifest.name ||
          lock.version !== manifest.version ||
          !isTsconfigObjectRecord(lock.dependencies)
        )
          return false;
        const selected = lock.dependencies[packageName];
        if (
          !isTsconfigObjectRecord(selected) ||
          selected.version !== STREAM_CHANNEL_PACKAGE_VERSIONS[packageName] ||
          selected.resolved !== STREAM_CHANNEL_ARCHIVE_URLS[packageName] ||
          selected.integrity !== STREAM_CHANNEL_ARCHIVE_INTEGRITIES[packageName] ||
          Object.hasOwn(selected, "link")
        )
          return false;
      }
    } else if (packageName === "styled-components") {
      if (
        !/^[~^]?5(?:\.\d+){0,2}$/u.test(declaration) ||
        resolution.version.major !== CANONICAL_CONTROL_STYLED_MAJOR
      )
        return false;
    } else {
      const expected = parsePackageVersion(FIREBASE_PASSWORD_SIGN_IN_VERSION);
      if (
        !expected ||
        !FIREBASE_PASSWORD_SIGN_IN_DECLARATION_PATTERN.test(declaration) ||
        comparePackageVersions(resolution.version, expected) !== 0
      )
        return false;
      if (resolution.declaredRange !== null && declaration !== FIREBASE_PASSWORD_SIGN_IN_VERSION) {
        const lock = readOwnJson(path.join(root, "package-lock.json"));
        if (
          !lock ||
          typeof lock.lockfileVersion !== "number" ||
          !CANONICAL_CONTROL_LOCK_VERSIONS.has(lock.lockfileVersion) ||
          !isTsconfigObjectRecord(lock.packages) ||
          Array.isArray(lock.packages)
        )
          return false;
        const packageEntry = lock.packages["node_modules/firebase"];
        const rootEntry = lock.packages[""];
        if (
          !isTsconfigObjectRecord(packageEntry) ||
          Array.isArray(packageEntry) ||
          !isTsconfigObjectRecord(rootEntry) ||
          Array.isArray(rootEntry) ||
          packageEntry.version !== FIREBASE_PASSWORD_SIGN_IN_VERSION ||
          packageEntry.resolved !== FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_URL ||
          packageEntry.integrity !== FIREBASE_PASSWORD_SIGN_IN_ARCHIVE_INTEGRITY ||
          Object.hasOwn(packageEntry, "link")
        )
          return false;
        const rootDeclarations = [
          rootEntry.dependencies,
          rootEntry.devDependencies,
          rootEntry.peerDependencies,
          rootEntry.optionalDependencies,
        ].flatMap((group) =>
          isTsconfigObjectRecord(group) &&
          !Array.isArray(group) &&
          Object.hasOwn(group, packageName)
            ? [group[packageName]]
            : [],
        );
        if (
          rootDeclarations.length !== IMPORTED_NATIVE_CONTROL_SINGLE_COUNT ||
          rootDeclarations[0] !== declaration
        )
          return false;
      }
    }
    for (const source of Object.hasOwn(STREAM_CHANNEL_PACKAGE_VERSIONS, packageName)
      ? [...CANONICAL_CONTROL_PROVIDER_SOURCES, ...STREAM_CHANNEL_PROVIDER_SOURCES]
      : CANONICAL_CONTROL_PROVIDER_SOURCES)
      if (
        resolveWebpackAliasPath(filename, source)?.declared ||
        resolveModulePath(filename, source)
      )
        return false;
    for (const name of [
      ...CANONICAL_CONTROL_REFUSED_CONFIG_FILENAMES,
      ...JSX_BABEL_CONFIG_FILE_NAMES,
      ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
    ]) {
      const config = path.join(root, name);
      recordExistenceProbe(config);
      if (fs.lstatSync(config, { throwIfNoEntry: false })) return false;
    }
    const craco = path.join(root, "craco.config.js");
    recordExistenceProbe(craco);
    recordContentProbe(craco);
    if (
      fs.lstatSync(craco, { throwIfNoEntry: false }) &&
      (!fs.lstatSync(craco).isFile() ||
        fs.realpathSync(craco) !== craco ||
        !hasPlainCracoAliases(
          craco,
          Object.hasOwn(STREAM_CHANNEL_PACKAGE_VERSIONS, packageName)
            ? [...CANONICAL_CONTROL_PROVIDER_SOURCES, ...STREAM_CHANNEL_PROVIDER_SOURCES]
            : CANONICAL_CONTROL_PROVIDER_SOURCES,
        ))
    )
      return false;
    return true;
  } catch {
    return false;
  }
};
