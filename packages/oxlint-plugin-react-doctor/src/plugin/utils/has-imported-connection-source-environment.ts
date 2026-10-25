import * as fs from "node:fs";
import * as path from "node:path";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
  JSX_TYPESCRIPT_CONFIG_FILE_NAMES,
  STANDARD_REACT_JSX_MODES,
} from "../constants/react.js";
import {
  IMPORTED_CONNECTION_NEXT_CONFIG_NAMES,
  IMPORTED_CONNECTION_CONFIG_NAMES,
  IMPORTED_CONNECTION_NEXT_COMMAND_PATTERN,
  IMPORTED_CONNECTION_SCRIPT_NAME_PATTERN,
  IMPORTED_CONNECTION_SINGLE_COUNT,
} from "./constants.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { findExportedValue } from "./find-exported-value.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import { isTsconfigObjectRecord, parseTsconfigFile } from "./resolve-tsconfig-alias.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isCanonicalNextConfiguration = (filename: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return false;
  if (
    program.body.some(
      (statement) =>
        !isNodeOfType(statement, "VariableDeclaration") &&
        !isNodeOfType(statement, "ExportDefaultDeclaration") &&
        !(isNodeOfType(statement, "ImportDeclaration") && statement.importKind === "type"),
    )
  )
    return false;
  let exported = findExportedValue(program, "default");
  if (!exported) return false;
  exported = stripParenExpression(exported);
  if (isNodeOfType(exported, "Identifier")) return false;
  if (
    program.body.some(
      (statement) =>
        isNodeOfType(statement, "VariableDeclaration") &&
        (statement.kind !== "const" ||
          statement.declarations.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
          statement.declarations[0].init !== exported),
    )
  )
    return false;
  const properties = getOwnDataObjectProperties(exported);
  if (!properties || properties.size > IMPORTED_CONNECTION_SINGLE_COUNT) return false;
  if (properties.size === 0) return true;
  const turbo = properties.get("turbopack");
  const settings = turbo ? getOwnDataObjectProperties(turbo) : null;
  const root = settings?.get("root");
  return Boolean(
    settings?.size === IMPORTED_CONNECTION_SINGLE_COUNT &&
    isNodeOfType(root, "Identifier") &&
    root.name === "__dirname",
  );
};

const isCanonicalTypescriptConfiguration = (filename: string, rootDirectory: string): boolean => {
  const configuration = parseTsconfigFile(filename, [], true);
  if (!configuration || Array.isArray(configuration) || Object.hasOwn(configuration, "extends"))
    return false;
  const options = configuration.compilerOptions ?? {};
  if (!isTsconfigObjectRecord(options) || Array.isArray(options)) return false;
  if (
    Object.hasOwn(options, "jsxFactory") ||
    Object.hasOwn(options, "jsxFragmentFactory") ||
    (Object.hasOwn(options, "jsxImportSource") && options.jsxImportSource !== "react")
  )
    return false;
  if (
    Object.hasOwn(options, "jsx") &&
    (typeof options.jsx !== "string" || !STANDARD_REACT_JSX_MODES.has(options.jsx))
  )
    return false;
  if (Object.hasOwn(options, "baseUrl") && options.baseUrl !== ".") return false;
  if (Object.hasOwn(options, "paths")) {
    if (
      path.dirname(filename) !== rootDirectory ||
      !isTsconfigObjectRecord(options.paths) ||
      Array.isArray(options.paths) ||
      Object.keys(options.paths).length !== IMPORTED_CONNECTION_SINGLE_COUNT
    )
      return false;
    const mapping = options.paths["@/*"];
    if (
      !Array.isArray(mapping) ||
      mapping.length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
      mapping[0] !== "./*"
    )
      return false;
  }
  if (Object.hasOwn(options, "plugins")) {
    if (
      !Array.isArray(options.plugins) ||
      options.plugins.some(
        (plugin) =>
          !isTsconfigObjectRecord(plugin) ||
          Object.keys(plugin).length !== IMPORTED_CONNECTION_SINGLE_COUNT ||
          plugin.name !== "next",
      )
    )
      return false;
  }
  return true;
};

export const hasImportedConnectionSourceEnvironment = (
  module: SourceProjectModule,
  rootDirectory: string,
  currentSourceText?: string | null,
): boolean => {
  const manifest = readNearestPackageManifest(module.filePath);
  const dependencies = {
    ...manifest?.dependencies,
    ...manifest?.devDependencies,
    ...manifest?.peerDependencies,
  };
  if (
    findNearestPackageDirectory(module.filePath) !== rootDirectory ||
    !manifest ||
    typeof dependencies.react !== "string" ||
    !parsePackageVersion(dependencies.react.trim().replace(/^[~^]/u, ""))
  )
    return false;
  if (
    [
      "babel",
      "resolutions",
      "overrides",
      "imports",
      "browser",
      "pnpm",
      "exports",
      "main",
      "module",
      "source",
      "workspaces",
      "react-native",
    ].some((key) => Object.hasOwn(manifest, key))
  )
    return false;
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (
      IMPORTED_CONNECTION_SCRIPT_NAME_PATTERN.test(name) &&
      (typeof dependencies.next !== "string" ||
        typeof command !== "string" ||
        !IMPORTED_CONNECTION_NEXT_COMMAND_PATTERN.test(command))
    )
      return false;
  }
  if (
    resolveWebpackAliasPath(module.filePath, "react")?.declared ||
    resolveModulePath(module.filePath, "react")
  )
    return false;
  const sourceText =
    currentSourceText === undefined ? fs.readFileSync(module.filePath, "utf8") : currentSourceText;
  if (
    sourceText === null ||
    hasJsxRuntimePragma({ filename: module.filePath, program: module.programNode, sourceText })
  )
    return false;
  let directory = path.dirname(module.filePath);
  while (directory === rootDirectory || directory.startsWith(rootDirectory + path.sep)) {
    for (const name of [
      ...JSX_BABEL_CONFIG_FILE_NAMES,
      ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
      ...IMPORTED_CONNECTION_CONFIG_NAMES,
    ]) {
      const configuration = path.join(directory, name);
      recordExistenceProbe(configuration);
      if (fs.existsSync(configuration)) return false;
    }
    for (const name of JSX_TYPESCRIPT_CONFIG_FILE_NAMES) {
      const configuration = path.join(directory, name);
      recordExistenceProbe(configuration);
      if (
        fs.existsSync(configuration) &&
        (!fs.lstatSync(configuration).isFile() ||
          fs.realpathSync(configuration) !== configuration ||
          !isCanonicalTypescriptConfiguration(configuration, rootDirectory))
      )
        return false;
    }
    for (const name of IMPORTED_CONNECTION_NEXT_CONFIG_NAMES) {
      const configuration = path.join(directory, name);
      recordExistenceProbe(configuration);
      if (
        fs.existsSync(configuration) &&
        (directory !== rootDirectory ||
          typeof dependencies.next !== "string" ||
          !parsePackageVersion(dependencies.next.trim().replace(/^[~^]/u, "")) ||
          !fs.lstatSync(configuration).isFile() ||
          fs.realpathSync(configuration) !== configuration ||
          !isCanonicalNextConfiguration(configuration))
      )
        return false;
    }
    if (directory === rootDirectory) break;
    directory = path.dirname(directory);
  }
  return true;
};
