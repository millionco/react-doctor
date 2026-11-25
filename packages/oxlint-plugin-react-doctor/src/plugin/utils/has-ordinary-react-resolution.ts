import * as fs from "node:fs";
import * as path from "node:path";
import {
  captureCrossFileProbes,
  recordContentProbe,
  recordExistenceProbe,
  replayCrossFileProbes,
  type CapturedCrossFileProbes,
} from "./cross-file-probe-recorder.js";
import { hasStaticViteResolution } from "./has-static-vite-resolution.js";
import {
  findNearestPackageDirectory,
  getManifestCacheGeneration,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveModulePath } from "./resolve-module-path.js";

const VITE_CONFIG_NAMES = ["vite.config", "vitest.config"];
const UNMODELED_CONFIG_NAMES = ["webpack.config", "next.config"];
const VITE_CONFIG_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];
const WORKSPACE_CONFIG_NAMES = ["pnpm-workspace.yaml", "pnpm-workspace.yml"];

const doesFileExist = (filename: string): boolean => {
  recordExistenceProbe(filename);
  return fs.existsSync(filename);
};

const hasReactOverride = (overrides: unknown): boolean =>
  Boolean(
    overrides !== null &&
    typeof overrides === "object" &&
    Object.entries(overrides).some(
      ([selector, replacement]) =>
        /(?:^|[>/])react(?:$|@)/u.test(selector) || hasReactOverride(replacement),
    ),
  );

const hasOnlyWorkspacePatterns = (filename: string): boolean => {
  recordContentProbe(filename);
  try {
    const config = fs.readFileSync(filename, "utf8");
    return /^\s*packages:(?:[ \t]*\r?\n[ \t]+-[ \t]+["']?[\w@./*-]+["']?)+\s*$/u.test(config);
  } catch {
    return false;
  }
};

const directoryUsesOrdinaryReact = (directory: string): boolean => {
  if (doesFileExist(path.join(directory, "package.json"))) {
    const manifest = readPackageManifest(directory);
    if (!manifest) return false;
    const pnpm = Reflect.get(manifest, "pnpm");
    if (
      hasReactOverride(Reflect.get(manifest, "resolutions")) ||
      hasReactOverride(Reflect.get(manifest, "overrides")) ||
      hasReactOverride(Reflect.get(manifest, "browser")) ||
      hasReactOverride(Reflect.get(manifest, "patchedDependencies")) ||
      (pnpm &&
        typeof pnpm === "object" &&
        (hasReactOverride(Reflect.get(pnpm, "overrides")) ||
          hasReactOverride(Reflect.get(pnpm, "patchedDependencies"))))
    ) {
      return false;
    }
  }
  for (const workspaceName of WORKSPACE_CONFIG_NAMES) {
    const configPath = path.join(directory, workspaceName);
    if (doesFileExist(configPath) && !hasOnlyWorkspacePatterns(configPath)) return false;
  }
  for (const configName of UNMODELED_CONFIG_NAMES) {
    for (const extension of VITE_CONFIG_EXTENSIONS) {
      if (doesFileExist(path.join(directory, configName + extension))) return false;
    }
  }
  for (const configName of VITE_CONFIG_NAMES) {
    for (const extension of VITE_CONFIG_EXTENSIONS) {
      const configPath = path.join(directory, configName + extension);
      if (doesFileExist(configPath) && !hasStaticViteResolution(configPath)) return false;
    }
  }
  return true;
};

let cacheGeneration = -1;
const directoryResolution = new Map<string, CapturedCrossFileProbes<boolean>>();

const hasOrdinaryAncestorResolution = (directory: string): boolean => {
  const previous = directoryResolution.get(directory);
  if (previous) {
    replayCrossFileProbes(previous.trace);
    return previous.value;
  }
  const result = captureCrossFileProbes(() => {
    const parent = path.dirname(directory);
    return (
      directoryUsesOrdinaryReact(directory) &&
      (parent === directory || hasOrdinaryAncestorResolution(parent))
    );
  });
  directoryResolution.set(directory, result);
  return result.value;
};

export const hasOrdinaryReactResolution = (filename: string): boolean => {
  if (!path.isAbsolute(filename)) return false;
  const directory = findNearestPackageDirectory(filename);
  const manifest = directory && readPackageManifest(directory);
  if (!manifest || resolveModulePath(filename, "react") !== null) return false;
  const ranges = [
    manifest.dependencies?.react,
    manifest.devDependencies?.react,
    manifest.optionalDependencies?.react,
    manifest.peerDependencies?.react,
  ].filter((range) => range !== undefined);
  if (
    ranges.length === 0 ||
    !ranges.every(
      (range) =>
        typeof range === "string" &&
        range
          .split("||")
          .every((branch) => /^[~^<>= ]*\d+(?:\.\d+){0,2}(?:-[\w.-]+)?\s*$/u.test(branch)),
    )
  ) {
    return false;
  }
  const generation = getManifestCacheGeneration();
  if (cacheGeneration !== generation) {
    directoryResolution.clear();
    cacheGeneration = generation;
  }
  return hasOrdinaryAncestorResolution(path.dirname(filename));
};
