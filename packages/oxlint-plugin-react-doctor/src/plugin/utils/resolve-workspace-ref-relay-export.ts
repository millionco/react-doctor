import * as fs from "node:fs";
import * as path from "node:path";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS,
  CROSS_FILE_PARSE_MAX_BYTES,
  REF_RELAY_WORKSPACE_MAX_DIRECTORIES,
} from "../constants/thresholds.js";
import { findExportedValue } from "./find-exported-value.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import type { ResolvedCrossFileFunctionExport } from "./resolve-cross-file-function-export.js";
import type { RuleContext } from "./rule-context.js";

const readRegularManifest = (directory: string): PackageManifest | null => {
  const manifestPath = path.join(directory, "package.json");
  const entry = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!entry?.isFile() || entry.size > CROSS_FILE_PARSE_MAX_BYTES) return null;
  return readPackageManifest(directory);
};

const readWorkspacePatterns = (filename: string): string[] | null => {
  const entry = fs.lstatSync(filename);
  if (!entry.isFile() || entry.size > CROSS_FILE_PARSE_MAX_BYTES) return null;
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  const patterns: string[] = [];
  let foundPackages = false;
  for (const line of lines) {
    const content = line.trim();
    if (!content || content.startsWith("#")) continue;
    if (content === "packages:" && !foundPackages) {
      foundPackages = true;
      continue;
    }
    const match =
      foundPackages && /^\s+-\s+(?:'([^']+)'|"([^"]+)"|([^\s#]+))\s*(?:#.*)?$/.exec(line);
    if (!match) return null;
    const pattern = match[1] ?? match[2] ?? match[3];
    if (!pattern || !/^[\w.-]+(?:\/[\w.-]+)*(?:\/\*\*?)?$/.test(pattern)) return null;
    if (pattern.split("/").some((segment) => segment === "." || segment === "..")) return null;
    patterns.push(pattern);
  }
  return foundPackages && patterns.length > 0 ? patterns : null;
};

const collectWorkspaceManifests = (
  root: string,
  patterns: string[],
): Map<string, PackageManifest> | null => {
  const manifests = new Map<string, PackageManifest>();
  const visited = new Set<string>();
  const inspected = new Set<string>();
  const inspectDirectory = (directory: string): boolean => {
    inspected.add(directory);
    if (inspected.size > REF_RELAY_WORKSPACE_MAX_DIRECTORIES) return false;
    for (const name of ["package.yaml", "package.json5"]) {
      if (fs.lstatSync(path.join(directory, name), { throwIfNoEntry: false })) return false;
    }
    if (!fs.lstatSync(path.join(directory, "package.json"), { throwIfNoEntry: false })) return true;
    const manifest = readRegularManifest(directory);
    if (!manifest) return false;
    manifests.set(directory, manifest);
    return true;
  };
  const visit = (directory: string, recursive: boolean, includeDirectory: boolean): boolean => {
    if (!isPathInside(directory, root) || fs.realpathSync(directory) !== directory) return false;
    const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!entry?.isDirectory()) return false;
    if (includeDirectory && !inspectDirectory(directory)) return false;
    if (!recursive || visited.has(directory)) return true;
    visited.add(directory);
    if (visited.size > REF_RELAY_WORKSPACE_MAX_DIRECTORIES) return false;
    for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
      if (child.name === "node_modules" || child.name === "bower_components") continue;
      if (child.isSymbolicLink()) return false;
      if (child.isDirectory() && !visit(path.join(directory, child.name), true, true)) return false;
    }
    return true;
  };
  if (!inspectDirectory(root)) return null;
  for (const pattern of patterns) {
    const prefix = pattern.replace(/\/\*\*?$/, "");
    const directory = path.join(root, prefix);
    const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!entry) continue;
    if (!entry.isDirectory() || fs.realpathSync(directory) !== directory) return null;
    if (pattern.endsWith("/**")) {
      if (!visit(directory, true, true)) return null;
    } else if (pattern.endsWith("/*")) {
      for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
        if (child.name === "node_modules" || child.name === "bower_components") continue;
        if (child.isSymbolicLink()) return null;
        if (child.isDirectory() && !visit(path.join(directory, child.name), false, true))
          return null;
      }
    } else if (!visit(directory, false, true)) return null;
  }
  return manifests;
};

const getUnambiguousRuntimeExport = (entry: unknown): string | null => {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  let selected: string | null = null;
  for (const [condition, target] of Object.entries(entry)) {
    if (condition === "types") continue;
    if (!["import", "require", "default"].includes(condition) || typeof target !== "string")
      return null;
    if (selected !== null && selected !== target) return null;
    selected = target;
  }
  return selected;
};

const resolveSourceExport = (
  directory: string,
  filename: string,
  exportedName: string,
  canFollowBarrel: boolean,
): ResolvedCrossFileFunctionExport | null => {
  if (!isPathInside(filename, directory) || fs.realpathSync(filename) !== filename) return null;
  const entry = fs.lstatSync(filename);
  if (
    !entry.isFile() ||
    !/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(filename) ||
    /\.d\.[cm]?ts$/.test(filename)
  )
    return null;
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return null;
  const matches = program.body.filter(
    (statement) =>
      isNodeOfType(statement, "ExportNamedDeclaration") &&
      statement.exportKind !== "type" &&
      ((isNodeOfType(statement.declaration, "FunctionDeclaration") &&
        statement.declaration.id?.name === exportedName) ||
        (isNodeOfType(statement.declaration, "VariableDeclaration") &&
          statement.declaration.declarations.some(
            (declarator) =>
              isNodeOfType(declarator.id, "Identifier") && declarator.id.name === exportedName,
          )) ||
        statement.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            specifier.exportKind !== "type" &&
            getModuleSpecifierName(specifier.exported) === exportedName,
        )),
  );
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!isNodeOfType(match, "ExportNamedDeclaration")) return null;
  if (match.source) {
    if (
      !program.body.every(
        (statement) =>
          isNodeOfType(statement, "ExportAllDeclaration") ||
          (isNodeOfType(statement, "ExportNamedDeclaration") &&
            !statement.declaration &&
            Boolean(statement.source)),
      )
    )
      return null;
    if (
      !canFollowBarrel ||
      typeof match.source.value !== "string" ||
      !match.source.value.startsWith("./")
    )
      return null;
    const specifier = match.specifiers.find(
      (candidate) =>
        isNodeOfType(candidate, "ExportSpecifier") &&
        candidate.exportKind !== "type" &&
        getModuleSpecifierName(candidate.exported) === exportedName,
    );
    if (!isNodeOfType(specifier, "ExportSpecifier")) return null;
    const nextName = getModuleSpecifierName(specifier.local);
    if (!nextName) return null;
    const target = path.resolve(path.dirname(filename), match.source.value);
    const candidates = [
      ...new Set([target, target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx")]),
    ].filter((candidate) => fs.lstatSync(candidate, { throwIfNoEntry: false }));
    return candidates.length === 1
      ? resolveSourceExport(directory, candidates[0], nextName, false)
      : null;
  }
  const exported = findExportedValue(program, exportedName);
  return exported && isFunctionLike(exported)
    ? { filePath: filename, functionNode: exported, programNode: program }
    : null;
};

export const resolveWorkspaceRefRelayExport = (
  context: RuleContext,
  imported: SymbolDescriptor,
): ResolvedCrossFileFunctionExport | null => {
  const declaration = getImportDeclarationForSymbol(imported);
  const specifier = imported.declarationNode;
  if (
    !declaration ||
    declaration.importKind === "type" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    typeof declaration.source.value !== "string"
  )
    return null;
  const source = declaration.source.value;
  const match = /^(@[^/]+\/[^/]+|[^@./][^/]*)(\/[^*?#\\]+)?$/.exec(source);
  const exportedName = getModuleSpecifierName(specifier.imported);
  const configuredRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!match || !exportedName || !configuredRoot || !context.filename) return null;
  try {
    const consumer = findNearestPackageDirectory(context.filename);
    if (
      !consumer ||
      fs.realpathSync(consumer) !== path.resolve(consumer) ||
      fs.realpathSync(configuredRoot) !== consumer
    )
      return null;
    const manifest = readRegularManifest(consumer);
    const packageName = match[1];
    const sections = [
      manifest?.dependencies,
      manifest?.devDependencies,
      manifest?.peerDependencies,
      manifest?.optionalDependencies,
    ];
    const versions = sections.flatMap((section) =>
      section && Object.hasOwn(section, packageName) ? [section[packageName]] : [],
    );
    if (versions.length === 0 || versions.some((version) => version !== "workspace:*")) return null;
    let root = consumer;
    for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level += 1) {
      const workspaceFile = path.join(root, "pnpm-workspace.yaml");
      if (fs.lstatSync(path.join(root, "pnpm-workspace.yml"), { throwIfNoEntry: false }))
        return null;
      if (fs.lstatSync(workspaceFile, { throwIfNoEntry: false })) {
        const patterns = readWorkspacePatterns(workspaceFile);
        if (!patterns) return null;
        const candidates = collectWorkspaceManifests(root, patterns);
        if (!candidates?.has(consumer)) return null;
        const owners = [...candidates].filter(([, candidate]) => candidate.name === packageName);
        if (owners.length !== 1) return null;
        const [directory, provider] = owners[0];
        const exportsField = provider.exports;
        if (
          typeof exportsField !== "object" ||
          exportsField === null ||
          Array.isArray(exportsField)
        )
          return null;
        const subpath = match[2] ? `.${match[2]}` : ".";
        const exportedPath = getUnambiguousRuntimeExport(
          Object.getOwnPropertyDescriptor(exportsField, subpath)?.value,
        );
        if (!exportedPath?.startsWith("./")) return null;
        return resolveSourceExport(
          directory,
          path.resolve(directory, exportedPath),
          exportedName,
          true,
        );
      }
      const parent = path.dirname(root);
      if (parent === root) return null;
      root = parent;
    }
  } catch {
    return null;
  }
  return null;
};
