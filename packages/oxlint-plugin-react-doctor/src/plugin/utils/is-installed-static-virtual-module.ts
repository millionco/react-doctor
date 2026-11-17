import * as fs from "node:fs";
import * as path from "node:path";
import {
  CROSS_FILE_PARSE_MAX_BYTES,
  STATIC_VIRTUAL_GENERATED_MODULE_TOTAL_MAX_BYTES,
  STATIC_VIRTUAL_MODULE_MAX_PACKAGE_ANCESTORS,
} from "../constants/thresholds.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getStaticEsmPackageExportTarget } from "./get-static-esm-package-export-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { isStaticVirtualModuleSwitch } from "./is-static-virtual-module-switch.js";
import { parseSourceText } from "./parse-source-file.js";
import { readBarePackageSpecifier } from "./read-bare-package-specifier.js";
import { readClosedVirtualManifest } from "./read-closed-virtual-manifest.js";
import { readGeneratedEsmFactoryFile } from "./read-generated-esm-factory-file.js";
import type { StaticAstroVirtualModuleRequirement } from "./read-static-astro-virtual-module-requirement.js";
import { resolveModulePath } from "./resolve-module-path.js";

interface InstalledStaticVirtualModuleInput {
  readonly configFilename: string;
  readonly recipe: StaticAstroVirtualModuleRequirement;
}

const EXPLICIT_RELATIVE_ESM_PATH_PATTERN = /^\.\/(?:[\w-]+\/)*[\w-]+\.mjs$/;
const RELATIVE_FACTORY_ESM_PATH_PATTERN = /^(?:\.\.?\/)+(?:[\w-]+\/)*[\w-]+\.mjs$/;

const findInstalledPackageDirectory = (
  fromFilename: string,
  packageName: string,
): string | null => {
  let directory = path.dirname(fromFilename);
  for (
    let ancestorIndex = 0;
    ancestorIndex < STATIC_VIRTUAL_MODULE_MAX_PACKAGE_ANCESTORS;
    ancestorIndex++
  ) {
    const candidate = path.join(directory, "node_modules", packageName);
    recordExistenceProbe(candidate);
    if (fs.lstatSync(candidate, { throwIfNoEntry: false })) {
      const resolved = fs.realpathSync(candidate);
      return fs.statSync(resolved).isDirectory() ? resolved : null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
};

const resolveRegularPackageFile = (filename: string, packageDirectory: string): string | null => {
  recordExistenceProbe(filename);
  if (!fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile()) return null;
  const resolved = fs.realpathSync(filename);
  return isPathInside(resolved, packageDirectory) ? resolved : null;
};

const readBoundedPackageText = (filename: string, packageDirectory: string): string | null => {
  const resolved = resolveRegularPackageFile(filename, packageDirectory);
  if (!resolved || fs.statSync(resolved).size > CROSS_FILE_PARSE_MAX_BYTES) return null;
  recordContentProbe(resolved);
  const source = fs.readFileSync(resolved);
  return source.length <= CROSS_FILE_PARSE_MAX_BYTES
    ? new TextDecoder("utf-8", { fatal: true }).decode(source)
    : null;
};

export const isInstalledStaticVirtualModule = ({
  configFilename,
  recipe,
}: InstalledStaticVirtualModuleInput): boolean => {
  const manifestImport = readBarePackageSpecifier(recipe.manifestSource);
  if (!manifestImport) return false;
  try {
    if (resolveModulePath(configFilename, recipe.manifestSource)) return false;
    const { packageName, subpath } = manifestImport;
    const directory = findInstalledPackageDirectory(configFilename, packageName);
    if (!directory) return false;
    const packageText = readBoundedPackageText(path.join(directory, "package.json"), directory);
    if (!packageText) return false;
    const manifest: unknown = JSON.parse(packageText);
    const entryTarget = getStaticEsmPackageExportTarget({ manifest, packageName, subpath });
    if (!entryTarget) return false;
    const modules = new Map<string, SourceProjectModule | null>();
    const readModule = (filename: string): SourceProjectModule | null => {
      const cached = modules.get(filename);
      if (cached !== undefined) return cached;
      const sourceText = readBoundedPackageText(filename, directory);
      const programNode = sourceText ? parseSourceText({ filename, sourceText }) : null;
      const module = isNodeOfType(programNode, "Program")
        ? { filePath: filename, programNode, scopes: analyzeScopes(programNode) }
        : null;
      modules.set(filename, module);
      return module;
    };
    const entry = readModule(path.join(directory, entryTarget));
    if (!entry) return false;
    const closedManifest = readClosedVirtualManifest({
      entry,
      exportedName: recipe.manifestExportName,
      idProperty: recipe.idProperty,
      resolveLocalModule: (from, specifier) =>
        EXPLICIT_RELATIVE_ESM_PATH_PATTERN.test(specifier)
          ? readModule(path.join(path.dirname(from.filePath), specifier))
          : null,
    });
    if (!closedManifest || !isStaticVirtualModuleSwitch(recipe, closedManifest.ids)) return false;
    const resolvedEntry = resolveRegularPackageFile(entry.filePath, directory);
    if (!resolvedEntry) return false;
    let remainingBytes = STATIC_VIRTUAL_GENERATED_MODULE_TOTAL_MAX_BYTES;
    for (const id of closedManifest.ids) {
      const target = getStaticEsmPackageExportTarget({ manifest, packageName, subpath: `./${id}` });
      if (!target) return false;
      const targetFilename = path.join(directory, target);
      const resolvedTarget = resolveRegularPackageFile(targetFilename, directory);
      if (!resolvedTarget) return false;
      const generated = readGeneratedEsmFactoryFile(resolvedTarget, remainingBytes);
      if (!generated) return false;
      remainingBytes -= generated.bytes;
      const factory = generated.factory;
      if (
        !RELATIVE_FACTORY_ESM_PATH_PATTERN.test(factory.source) ||
        !closedManifest.factoryNames.has(factory.exportedName) ||
        resolveRegularPackageFile(
          path.resolve(path.dirname(targetFilename), factory.source),
          directory,
        ) !== resolvedEntry
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
};
