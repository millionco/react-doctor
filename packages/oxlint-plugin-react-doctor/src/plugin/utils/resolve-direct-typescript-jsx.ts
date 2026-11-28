import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { parseTsconfigFile } from "./resolve-tsconfig-alias.js";

const DIRECT_TSC_BUILD = /^tsc (?:-p|--project) tsconfig\.json$/;
const EXACT_TYPESCRIPT_VERSION = /^(\d+)\.(\d+)\.\d+$/;
const TSX_SOURCE_GLOB = /^([\w/-]+)\/\*\*\/\*\.tsx$/;
const NON_SOURCE_DIRECTORIES = new Set(["node_modules", "bower_components", "jspm_packages"]);
const LEADING_AUTOMATIC_PRAGMA = /^\s*\/\*\*?\s*@jsxRuntime[ \t]+automatic[ \t]+\*\//;
const CLASSIC_FACTORY_PRAGMA = /@jsx(?:Frag|Factory)?\s/i;

// A source file can belong to several compiler projects with different
// default JSX modes. Require the file to select the automatic runtime.
export const hasAutomaticTypeScriptJsxPragma = (source: string): boolean =>
  LEADING_AUTOMATIC_PRAGMA.test(source) &&
  !CLASSIC_FACTORY_PRAGMA.test(source) &&
  source.match(/@jsxRuntime\b/gi)?.length === 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tsconfigIncludesFile = (config: Record<string, unknown>, relativeFile: string): boolean => {
  if (Array.isArray(config.files) && config.files.includes(relativeFile)) return true;
  if (config.exclude !== undefined || !Array.isArray(config.include)) return false;
  if (
    relativeFile
      .split("/")
      .some((component) => component.startsWith(".") || NON_SOURCE_DIRECTORIES.has(component))
  )
    return false;
  return config.include.some((entry: unknown) => {
    if (typeof entry !== "string") return false;
    const prefix = TSX_SOURCE_GLOB.exec(entry)?.[1];
    return Boolean(prefix && relativeFile.startsWith(prefix + "/"));
  });
};

const packageDeclaresDirectTypeScriptEmit = (manifest: unknown): boolean => {
  if (
    !isRecord(manifest) ||
    !isRecord(manifest.scripts) ||
    Object.keys(manifest.scripts).length !== 1 ||
    typeof manifest.scripts.build !== "string" ||
    !DIRECT_TSC_BUILD.test(manifest.scripts.build) ||
    manifest.overrides !== undefined ||
    manifest.resolutions !== undefined ||
    manifest.pnpm !== undefined ||
    manifest.workspaces !== undefined
  )
    return false;
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
  const devDependencies = isRecord(manifest.devDependencies) ? manifest.devDependencies : {};
  const optionalDependencies = isRecord(manifest.optionalDependencies)
    ? manifest.optionalDependencies
    : {};
  const peerDependencies = isRecord(manifest.peerDependencies) ? manifest.peerDependencies : {};
  if (
    [dependencies, devDependencies, optionalDependencies, peerDependencies].some(
      (dependencyGroup) => dependencyGroup.tsc !== undefined,
    ) ||
    optionalDependencies.typescript !== undefined ||
    peerDependencies.typescript !== undefined ||
    (dependencies.typescript !== undefined && devDependencies.typescript !== undefined)
  )
    return false;

  const typescript = devDependencies.typescript ?? dependencies.typescript;
  if (typeof typescript !== "string") return false;
  const version = EXACT_TYPESCRIPT_VERSION.exec(typescript);
  if (!version) return false;
  const major = Number(version[1]);
  return major > 5 || (major === 5 && Number(version[2]) >= 6);
};

const readPackageIfPresent = (directory: string): Record<string, unknown> | null => {
  const manifestPath = join(directory, "package.json");
  recordExistenceProbe(manifestPath);
  if (!existsSync(manifestPath)) return null;
  recordContentProbe(manifestPath);
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid package manifest");
  return parsed;
};

const hasPnpmWorkspace = (directory: string): boolean => {
  const workspace = join(directory, "pnpm-workspace.yaml");
  recordExistenceProbe(workspace);
  return existsSync(workspace);
};

const hasCompetingAncestorBuild = (directory: string): boolean => {
  if (hasPnpmWorkspace(directory)) return true;
  let current = dirname(directory);
  for (let depth = 0; depth < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; depth++) {
    if (current === directory) return false;
    const manifest = readPackageIfPresent(current);
    if (manifest) {
      const scripts = isRecord(manifest.scripts) ? Object.values(manifest.scripts) : [];
      if (
        manifest.workspaces !== undefined ||
        scripts.some(
          (command) => typeof command === "string" && /(?:^|[\s/\\])tsc(?:[.\s]|$)/.test(command),
        )
      )
        return true;
    }
    if (hasPnpmWorkspace(current)) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return true;
};

export const resolveDirectTypeScriptJsxRoot = (filename: string): string | null => {
  if (!filename.endsWith(".tsx")) return null;
  const file = resolve(filename);
  let directory = dirname(file);
  try {
    for (let depth = 0; depth < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; depth++) {
      const manifest = readPackageIfPresent(directory);
      if (!manifest) {
        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
        continue;
      }
      if (!packageDeclaresDirectTypeScriptEmit(manifest) || hasCompetingAncestorBuild(directory))
        return null;
      const config = parseTsconfigFile(join(directory, "tsconfig.json"), []);
      if (
        !config ||
        config.extends !== undefined ||
        config.references !== undefined ||
        !isRecord(config.compilerOptions)
      )
        return null;
      const options = config.compilerOptions;
      if (
        options.noEmit ||
        options.emitDeclarationOnly ||
        options.outDir !== undefined ||
        options.jsxFactory !== undefined ||
        options.jsxFragmentFactory !== undefined ||
        !tsconfigIncludesFile(config, relative(directory, file).split(sep).join("/"))
      )
        return null;
      const mode = options.jsx;
      return mode === "react" || mode === "react-jsx" || mode === "react-jsxdev" ? directory : null;
    }
  } catch {
    return null;
  }
  return null;
};
