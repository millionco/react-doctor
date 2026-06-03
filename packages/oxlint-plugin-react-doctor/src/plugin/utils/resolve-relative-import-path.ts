import * as fs from "node:fs";
import * as path from "node:path";

const MODULE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const PACKAGE_EXPORT_CONDITIONS = ["import", "default", "module", "browser", "require"];
const PACKAGE_ENTRY_FIELDS = ["module", "main", "browser"];

const getExistingFilePath = (filePath: string): string | null => {
  try {
    return fs.statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
};

const getExistingDirectoryPath = (directoryPath: string): string | null => {
  try {
    return fs.statSync(directoryPath).isDirectory() ? directoryPath : null;
  } catch {
    return null;
  }
};

const getModuleFilePathCandidates = (modulePath: string): string[] => {
  const extension = path.extname(modulePath);
  if (!extension) {
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

const resolveModulePathWithIndexFallback = (modulePath: string): string | null => {
  const filePath = resolveModuleFilePath(modulePath);
  if (filePath) return filePath;

  return resolveModuleFilePath(path.join(modulePath, "index"));
};

const resolvePackageDirectoryEntry = (directoryPath: string): string | null => {
  const existingDirectoryPath = getExistingDirectoryPath(directoryPath);
  if (!existingDirectoryPath) return null;

  const packageJsonPath = path.join(existingDirectoryPath, "package.json");
  try {
    const packageJson: Record<string, unknown> = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    );
    const packageEntry =
      getPackageExportEntry(packageJson) ??
      PACKAGE_ENTRY_FIELDS.map((fieldName) => packageJson[fieldName]).find(
        (value): value is string => typeof value === "string",
      );
    if (!packageEntry) return null;

    return resolveModulePathWithIndexFallback(path.resolve(existingDirectoryPath, packageEntry));
  } catch {
    return null;
  }
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

export const resolveRelativeImportPath = (filename: string, source: string): string | null => {
  const importPath = path.resolve(path.dirname(filename), source);
  const directFilePath = resolveModuleFilePath(importPath);
  if (directFilePath) return directFilePath;

  const packageEntryFilePath = resolvePackageDirectoryEntry(importPath);
  if (packageEntryFilePath) return packageEntryFilePath;

  return resolveModuleFilePath(path.join(importPath, "index"));
};
