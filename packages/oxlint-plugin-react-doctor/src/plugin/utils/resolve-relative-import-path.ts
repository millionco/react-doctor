import * as fs from "node:fs";
import * as path from "node:path";
import { hasStaticViteResolution } from "./has-static-vite-resolution.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";

const MODULE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const PACKAGE_EXPORT_CONDITIONS = ["import", "default", "module", "browser", "require"];
const PACKAGE_ENTRY_FIELDS = ["module", "main", "browser"];

interface FilesystemEntryClassification {
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

const DIRECTORY_ENTRY: FilesystemEntryClassification = { isDirectory: true, isFile: false };
const FILE_ENTRY: FilesystemEntryClassification = { isDirectory: false, isFile: true };
const OTHER_ENTRY: FilesystemEntryClassification = { isDirectory: false, isFile: false };

const filesystemEntryByPath = new Map<string, FilesystemEntryClassification>();
const packageJsonByPath = new Map<string, Record<string, unknown> | null>();

const classifyFilesystemEntry = (absolutePath: string): FilesystemEntryClassification => {
  recordExistenceProbe(absolutePath);
  const cachedEntry = filesystemEntryByPath.get(absolutePath);
  if (cachedEntry) return cachedEntry;

  let entry = OTHER_ENTRY;
  try {
    const fileStat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (fileStat?.isFile()) entry = FILE_ENTRY;
    else if (fileStat?.isDirectory()) entry = DIRECTORY_ENTRY;
  } catch {
    filesystemEntryByPath.set(absolutePath, OTHER_ENTRY);
    return OTHER_ENTRY;
  }
  filesystemEntryByPath.set(absolutePath, entry);
  return entry;
};

const getExistingFilePath = (filePath: string): string | null => {
  return classifyFilesystemEntry(filePath).isFile ? filePath : null;
};

const getExistingDirectoryPath = (directoryPath: string): string | null => {
  return classifyFilesystemEntry(directoryPath).isDirectory ? directoryPath : null;
};

const getModuleFilePathCandidates = (modulePath: string): string[] => {
  const extension = path.extname(modulePath);
  if (!MODULE_FILE_EXTENSIONS.includes(extension)) {
    return MODULE_FILE_EXTENSIONS.map((moduleExtension) => `${modulePath}${moduleExtension}`);
  }

  const modulePathWithoutExtension = modulePath.slice(0, -extension.length);
  if (extension === ".js") {
    return [
      modulePath,
      `${modulePathWithoutExtension}.ts`,
      `${modulePathWithoutExtension}.tsx`,
      `${modulePathWithoutExtension}.jsx`,
    ];
  }
  if (extension === ".jsx") return [modulePath, `${modulePathWithoutExtension}.tsx`];
  if (extension === ".mjs") return [modulePath, `${modulePathWithoutExtension}.mts`];
  if (extension === ".cjs") return [modulePath, `${modulePathWithoutExtension}.cts`];

  return [modulePath];
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getConditionalExportEntry = (exportEntry: unknown): string | null => {
  if (typeof exportEntry === "string") return exportEntry;
  if (Array.isArray(exportEntry)) {
    for (const fallbackEntry of exportEntry) {
      const resolvedFallbackEntry = getConditionalExportEntry(fallbackEntry);
      if (resolvedFallbackEntry) return resolvedFallbackEntry;
    }
    return null;
  }
  if (!isObjectRecord(exportEntry)) return null;

  for (const condition of PACKAGE_EXPORT_CONDITIONS) {
    const nestedEntry = getConditionalExportEntry(exportEntry[condition]);
    if (nestedEntry) return nestedEntry;
  }

  return null;
};

const getPackageExportEntry = (packageJson: Record<string, unknown>): string | null => {
  const exportsField = packageJson.exports;
  if (!exportsField) return null;

  const directExportEntry = getConditionalExportEntry(exportsField);
  if (directExportEntry) return directExportEntry;

  if (!isObjectRecord(exportsField)) return null;
  return getConditionalExportEntry(exportsField["."]);
};

const readPackageJson = (packageJsonPath: string): Record<string, unknown> | null => {
  recordContentProbe(packageJsonPath);
  const cachedPackageJson = packageJsonByPath.get(packageJsonPath);
  if (cachedPackageJson !== undefined) return cachedPackageJson;

  let packageJson: Record<string, unknown> | null;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    packageJson = null;
  }
  packageJsonByPath.set(packageJsonPath, packageJson);
  return packageJson;
};

const resolveModulePathWithIndexFallback = (modulePath: string): string | null => {
  const filePath = resolveModuleFilePath(modulePath);
  if (filePath) return filePath;

  return resolveModuleFilePath(path.join(modulePath, "index"));
};

const resolvePackageDirectoryEntry = (directoryPath: string): string | null => {
  const existingDirectoryPath = getExistingDirectoryPath(directoryPath);
  if (!existingDirectoryPath) return null;

  const packageJsonPath = path.join(existingDirectoryPath, "package.json");
  const packageJson = readPackageJson(packageJsonPath);
  if (!packageJson) return null;

  const packageEntry =
    getPackageExportEntry(packageJson) ??
    PACKAGE_ENTRY_FIELDS.map((fieldName) => packageJson[fieldName]).find(
      (value): value is string => typeof value === "string",
    );
  if (!packageEntry) return null;

  return resolveModulePathWithIndexFallback(path.resolve(existingDirectoryPath, packageEntry));
};

const resolveModuleFilePath = (modulePath: string): string | null => {
  const exactFilePath = getExistingFilePath(modulePath);
  if (exactFilePath) return exactFilePath;

  for (const candidateFilePath of getModuleFilePathCandidates(modulePath)) {
    const filePath = getExistingFilePath(candidateFilePath);
    if (filePath) return filePath;
  }

  return null;
};

// Resolves an already-absolute module path to a concrete file, trying
// the path itself + extension candidates, then a package directory
// entry (package.json exports/main), then an `index.*` fallback. Shared
// by relative resolution and tsconfig-alias resolution.
export const resolveModuleFileFromAbsolutePath = (importPath: string): string | null => {
  const directFilePath = resolveModuleFilePath(importPath);
  if (directFilePath) return directFilePath;

  const packageEntryFilePath = resolvePackageDirectoryEntry(importPath);
  if (packageEntryFilePath) return packageEntryFilePath;

  return resolveModuleFilePath(path.join(importPath, "index"));
};

export const resolveRelativeImportPath = (filename: string, source: string): string | null =>
  resolveModuleFileFromAbsolutePath(path.resolve(path.dirname(filename), source));

const findOwningPackage = (filename: string): string | null => {
  let directory = path.dirname(filename);
  while (true) {
    const manifest = path.join(directory, "package.json");
    if (getExistingFilePath(manifest)) return manifest;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};

const hasRegistryVersion = (manifest: Record<string, unknown>, name: string): boolean => {
  const optional = manifest.optionalDependencies;
  if (isObjectRecord(optional) && Object.hasOwn(optional, name)) return false;
  const sections = [manifest.dependencies, manifest.devDependencies];
  const selectors = sections.flatMap((section) =>
    isObjectRecord(section) && Object.hasOwn(section, name) ? [section[name]] : [],
  );
  return (
    selectors.length === 1 &&
    typeof selectors[0] === "string" &&
    /^[~^]?\d+\.\d+\.\d+$/u.test(selectors[0])
  );
};

const canRemapPackage = (manifest: Record<string, unknown>): boolean =>
  ["browser", "overrides", "pnpm", "resolutions", "workspaces"].some((key) =>
    Object.hasOwn(manifest, key),
  );

// Exemptions need one direct source across the default extension orders.
export const resolveUnambiguousViteImportPath = (
  filename: string,
  source: string,
): string | null => {
  if (filename.length === 0 || (!source.startsWith("./") && !source.startsWith("../"))) return null;
  const importer = path.resolve(filename);
  const modulePath = path.resolve(path.dirname(importer), source);
  if (getExistingDirectoryPath(modulePath)) return null;
  const candidates = new Set([modulePath, ...getModuleFilePathCandidates(modulePath)]);
  const files = [...candidates].filter((candidate) => getExistingFilePath(candidate));
  if (files.length !== 1) return null;
  const target = files[0];
  if (!target) return null;
  const manifest = findOwningPackage(importer);
  if (!manifest || findOwningPackage(target) !== manifest) return null;
  const packageJson = readPackageJson(manifest);
  if (
    !packageJson ||
    canRemapPackage(packageJson) ||
    !["react", "vite", "@vitejs/plugin-react"].every((name) =>
      hasRegistryVersion(packageJson, name),
    )
  )
    return null;
  const build = isObjectRecord(packageJson.scripts) ? packageJson.scripts.build : null;
  if (build !== "vite build" && build !== "tsc && vite build") return null;
  const directory = path.dirname(manifest);
  const parentManifest = findOwningPackage(directory);
  if (parentManifest) {
    const parent = readPackageJson(parentManifest);
    if (!parent || canRemapPackage(parent)) return null;
  }
  const configs = MODULE_FILE_EXTENSIONS.map((extension) =>
    path.join(directory, `vite.config${extension}`),
  ).filter((candidate) => getExistingFilePath(candidate));
  const [config] = configs;
  return configs.length === 1 && config && hasStaticViteResolution(config) ? target : null;
};

export const resetModuleResolutionCaches = (): void => {
  filesystemEntryByPath.clear();
  packageJsonByPath.clear();
};
