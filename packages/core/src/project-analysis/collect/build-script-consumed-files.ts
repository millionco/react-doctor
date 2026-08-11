import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import {
  BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
  BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
} from "../constants.js";
import { escapeRegExp } from "../utils/escape-reg-exp.js";

interface InvokedScriptFile {
  filePath: string;
  workingDirectory: string;
}

const SOURCE_FILE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const SCRIPT_FILE_REFERENCE_PATTERN =
  /(?:^|\s)(?:(['"`])([^'"`]+\.(?:[cm]?[jt]s))\1|([^\s'"`]+\.(?:[cm]?[jt]s)))(?=\s|$)/g;
const FILESYSTEM_READ_FUNCTION_PATTERN = "(?:readFile|readFileSync|readdir|readdirSync)";
const INLINE_REGISTRY_DIRECTORY_READ_PATTERN = new RegExp(
  `\\b${FILESYSTEM_READ_FUNCTION_PATTERN}\\s*\\([^;\\n]*['"\`](src/registry)(?:/|['"\`])`,
  "g",
);
const REGISTRY_DIRECTORY_VARIABLE_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*['"`](src\/registry)(?:\/|['"`])[^;\n]*/g;
const INLINE_REGISTRY_MANIFEST_READ_PATTERN =
  /\b(?:readFile|readFileSync)\s*\([^;\n]*['"`]([^'"`]*registry\.json)['"`]/g;
const REGISTRY_MANIFEST_VARIABLE_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*['"`]([^'"`]*registry\.json)['"`][^;\n]*/g;
const PATH_VARIABLE_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:path\.)?(join|resolve)\(\s*(process\.cwd\(\)|__dirname)\s*,\s*((?:['"`][^'"`]*['"`]\s*,?\s*)+)\)/g;
const RECURSIVE_DIRECTORY_READER_PATTERN =
  /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{[\s\S]*?\breaddirSync\s*\(\s*\2\s*(?:,|\))/g;

const isPathInsideDirectory = (directoryPath: string, candidatePath: string): boolean => {
  const relativePath = relative(directoryPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
};

const resolveBuildReference = (
  reference: string,
  workingDirectory: string,
  projectRoot: string,
): string =>
  reference.startsWith("/")
    ? resolve(projectRoot, reference.replace(/^\/+/, ""))
    : resolve(workingDirectory, reference);

const readJson = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
};

const collectManifestPathPatterns = (value: unknown, patterns: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPathPatterns(item, patterns);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "path" && typeof nestedValue === "string") {
      patterns.add(nestedValue);
      continue;
    }
    collectManifestPathPatterns(nestedValue, patterns);
  }
};

const expandManifestPaths = (
  manifestPath: string,
  workingDirectory: string,
  projectRoot: string,
): string[] => {
  const patterns = new Set<string>();
  collectManifestPathPatterns(readJson(manifestPath), patterns);
  const filePaths = new Set<string>();

  for (const pattern of patterns) {
    const patternWorkingDirectory = pattern.startsWith("/") ? projectRoot : workingDirectory;
    const normalizedPattern = pattern.replace(/^\/+/, "");
    if (
      normalizedPattern.includes("*") ||
      normalizedPattern.includes("?") ||
      normalizedPattern.includes("[")
    ) {
      for (const filePath of fg.sync(normalizedPattern, {
        cwd: patternWorkingDirectory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
        deep: BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
      })) {
        if (
          isPathInsideDirectory(projectRoot, filePath) &&
          SOURCE_FILE_EXTENSION_PATTERN.test(filePath)
        ) {
          filePaths.add(filePath);
        }
      }
      continue;
    }

    const filePath = resolve(patternWorkingDirectory, normalizedPattern);
    if (
      isPathInsideDirectory(projectRoot, filePath) &&
      existsSync(filePath) &&
      statSync(filePath).isFile() &&
      SOURCE_FILE_EXTENSION_PATTERN.test(filePath)
    ) {
      filePaths.add(filePath);
    }
  }

  return [...filePaths];
};

const collectPackageJsonPaths = (projectRoot: string): string[] =>
  fg.sync(["package.json", "**/package.json"], {
    cwd: projectRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
  });

const extractInvokedScriptFiles = (
  projectRoot: string,
  packageJsonPaths: ReadonlyArray<string>,
): InvokedScriptFile[] => {
  const scriptFiles = new Map<string, InvokedScriptFile>();

  for (const packageJsonPath of packageJsonPaths) {
    const workingDirectory = dirname(packageJsonPath);
    const packageJson = readJson(packageJsonPath);
    if (typeof packageJson !== "object" || packageJson === null) continue;
    const scripts = Object.entries(packageJson).find(([key]) => key === "scripts")?.[1];
    if (typeof scripts !== "object" || scripts === null) continue;

    for (const command of Object.values(scripts)) {
      if (typeof command !== "string") continue;
      SCRIPT_FILE_REFERENCE_PATTERN.lastIndex = 0;
      let scriptMatch: RegExpExecArray | null;
      while ((scriptMatch = SCRIPT_FILE_REFERENCE_PATTERN.exec(command)) !== null) {
        const scriptReference = scriptMatch[2] ?? scriptMatch[3];
        const scriptPath = resolveBuildReference(scriptReference, workingDirectory, projectRoot);
        if (
          isPathInsideDirectory(projectRoot, scriptPath) &&
          existsSync(scriptPath) &&
          statSync(scriptPath).isFile()
        ) {
          scriptFiles.set(`${workingDirectory}\0${scriptPath}`, {
            filePath: scriptPath,
            workingDirectory,
          });
        }
      }
    }
  }

  return [...scriptFiles.values()];
};

const collectDirectorySourceFiles = (
  directoryPath: string,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  if (
    !isPathInsideDirectory(projectRoot, directoryPath) ||
    !existsSync(directoryPath) ||
    !statSync(directoryPath).isDirectory()
  ) {
    return;
  }
  for (const filePath of fg.sync("**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}", {
    cwd: directoryPath,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH,
  })) {
    if (isPathInsideDirectory(projectRoot, filePath)) consumedFiles.add(filePath);
  }
};

const collectRecursiveInputDirectories = (
  content: string,
  scriptPath: string,
  workingDirectory: string,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  const directoryVariables = new Map<string, string>();
  PATH_VARIABLE_PATTERN.lastIndex = 0;
  let variableMatch: RegExpExecArray | null;
  while ((variableMatch = PATH_VARIABLE_PATTERN.exec(content)) !== null) {
    const pathSegments = [...variableMatch[4].matchAll(/['"`]([^'"`]*)['"`]/g)].map(
      (segmentMatch) => segmentMatch[1],
    );
    const baseDirectory = variableMatch[3] === "__dirname" ? dirname(scriptPath) : workingDirectory;
    const directoryPath =
      variableMatch[2] === "join"
        ? join(baseDirectory, ...pathSegments)
        : resolve(baseDirectory, ...pathSegments);
    if (
      isPathInsideDirectory(projectRoot, directoryPath) &&
      existsSync(directoryPath) &&
      statSync(directoryPath).isDirectory()
    ) {
      directoryVariables.set(variableMatch[1], directoryPath);
    }
  }

  RECURSIVE_DIRECTORY_READER_PATTERN.lastIndex = 0;
  let readerMatch: RegExpExecArray | null;
  while ((readerMatch = RECURSIVE_DIRECTORY_READER_PATTERN.exec(content)) !== null) {
    const helperName = readerMatch[1];
    for (const [variableName, directoryPath] of directoryVariables) {
      const helperCallPattern = new RegExp(`\\b${helperName}\\s*\\(\\s*${variableName}\\b`);
      if (helperCallPattern.test(content))
        collectDirectorySourceFiles(directoryPath, projectRoot, consumedFiles);
    }
  }
};

const collectRegistryDirectories = (
  scriptPath: string,
  content: string,
  workingDirectory: string,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  if (!basename(scriptPath).includes("registry")) return;

  INLINE_REGISTRY_DIRECTORY_READ_PATTERN.lastIndex = 0;
  let inlineDirectoryMatch: RegExpExecArray | null;
  while ((inlineDirectoryMatch = INLINE_REGISTRY_DIRECTORY_READ_PATTERN.exec(content)) !== null) {
    collectDirectorySourceFiles(
      resolveBuildReference(inlineDirectoryMatch[1], workingDirectory, projectRoot),
      projectRoot,
      consumedFiles,
    );
  }

  REGISTRY_DIRECTORY_VARIABLE_PATTERN.lastIndex = 0;
  let directoryMatch: RegExpExecArray | null;
  while ((directoryMatch = REGISTRY_DIRECTORY_VARIABLE_PATTERN.exec(content)) !== null) {
    const variableReadPattern = new RegExp(
      `\\b${FILESYSTEM_READ_FUNCTION_PATTERN}\\s*\\(\\s*${escapeRegExp(directoryMatch[1])}\\b`,
    );
    if (!variableReadPattern.test(content)) continue;
    collectDirectorySourceFiles(
      resolveBuildReference(directoryMatch[2], workingDirectory, projectRoot),
      projectRoot,
      consumedFiles,
    );
  }
};

const collectReferencedManifestFiles = (
  scriptPath: string,
  workingDirectory: string,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  let content: string;
  try {
    content = readFileSync(scriptPath, "utf8");
  } catch {
    return;
  }
  const manifestPaths = new Set<string>();
  INLINE_REGISTRY_MANIFEST_READ_PATTERN.lastIndex = 0;
  let inlineManifestMatch: RegExpExecArray | null;
  while ((inlineManifestMatch = INLINE_REGISTRY_MANIFEST_READ_PATTERN.exec(content)) !== null) {
    manifestPaths.add(inlineManifestMatch[1]);
  }

  REGISTRY_MANIFEST_VARIABLE_PATTERN.lastIndex = 0;
  let manifestVariableMatch: RegExpExecArray | null;
  while ((manifestVariableMatch = REGISTRY_MANIFEST_VARIABLE_PATTERN.exec(content)) !== null) {
    const variableReadPattern = new RegExp(
      `\\b(?:readFile|readFileSync)\\s*\\(\\s*${escapeRegExp(manifestVariableMatch[1])}\\b`,
    );
    if (variableReadPattern.test(content)) manifestPaths.add(manifestVariableMatch[2]);
  }

  for (const manifestReference of manifestPaths) {
    const manifestPath = resolveBuildReference(manifestReference, workingDirectory, projectRoot);
    if (!isPathInsideDirectory(projectRoot, manifestPath)) continue;
    if (!existsSync(manifestPath)) continue;
    for (const filePath of expandManifestPaths(manifestPath, workingDirectory, projectRoot)) {
      consumedFiles.add(filePath);
    }
  }
};

const collectShadcnRegistryFiles = (
  packageJsonPaths: ReadonlyArray<string>,
  projectRoot: string,
  consumedFiles: Set<string>,
): void => {
  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = readJson(packageJsonPath);
    if (typeof packageJson !== "object" || packageJson === null) continue;
    const scripts = Object.entries(packageJson).find(([key]) => key === "scripts")?.[1];
    if (typeof scripts !== "object" || scripts === null) continue;
    const invokesShadcnBuild = Object.values(scripts).some(
      (command) => typeof command === "string" && /\bshadcn(?:@[^\s]+)?\s+build\b/.test(command),
    );
    if (!invokesShadcnBuild) continue;

    const workingDirectory = dirname(packageJsonPath);
    const manifestPath = resolve(workingDirectory, "registry.json");
    if (!existsSync(manifestPath)) continue;
    for (const filePath of expandManifestPaths(manifestPath, workingDirectory, projectRoot)) {
      consumedFiles.add(filePath);
    }
  }
};

export const extractBuildScriptConsumedFiles = (projectRoot: string): string[] => {
  const consumedFiles = new Set<string>();
  const packageJsonPaths = collectPackageJsonPaths(projectRoot);
  const invokedScriptFiles = extractInvokedScriptFiles(projectRoot, packageJsonPaths);

  for (const invokedScript of invokedScriptFiles) {
    let content: string;
    try {
      content = readFileSync(invokedScript.filePath, "utf8");
    } catch {
      continue;
    }
    collectRecursiveInputDirectories(
      content,
      invokedScript.filePath,
      invokedScript.workingDirectory,
      projectRoot,
      consumedFiles,
    );
    collectRegistryDirectories(
      invokedScript.filePath,
      content,
      invokedScript.workingDirectory,
      projectRoot,
      consumedFiles,
    );
    collectReferencedManifestFiles(
      invokedScript.filePath,
      invokedScript.workingDirectory,
      projectRoot,
      consumedFiles,
    );
  }

  collectShadcnRegistryFiles(packageJsonPaths, projectRoot, consumedFiles);
  return [...consumedFiles];
};
