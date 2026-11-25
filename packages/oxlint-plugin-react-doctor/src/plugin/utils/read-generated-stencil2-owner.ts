import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readGeneratedStencil2Lifecycle } from "./read-generated-stencil2-lifecycle.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

export interface GeneratedStencilOwner {
  readonly projectDirectory: string;
  readonly configSource: string;
  readonly generatedConfig: string;
  readonly createsLibraryDirectory: boolean;
  readonly sourceTsconfigs: readonly string[];
}

const ALTERNATE_CONFIGS = [
  ...["stencil.config", "vite.config", "webpack.config", "babel.config", "react.config"].flatMap(
    (prefix) =>
      ["ts", "tsx", "js", "cjs", "mjs", "cts", "mts"].map((ending) => prefix + "." + ending),
  ),
  "jsconfig.json",
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
];
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_CONFIG_CHAIN = 16;

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
const canonical = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};
const ownedText = (filename: string): string | null => {
  const entry = stat(filename);
  return entry?.isFile() && entry.size <= MAX_CONFIG_BYTES
    ? (readProviderMember(filename)?.toString("utf8") ?? null)
    : null;
};

const firstPackage = (start: string, workspaceRoot: string): string | null => {
  for (
    let directory = start;
    isPathInside(directory, workspaceRoot);
    directory = path.dirname(directory)
  ) {
    if (stat(path.join(directory, "package.json"))) return directory;
    if (directory === workspaceRoot) break;
  }
  return null;
};

const compilerOptions = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !["__proto__", "constructor", "prototype"].some((name) => Object.hasOwn(value, name))
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const readTsconfigChain = (workspaceRoot: string, projectDirectory: string): string[] | null => {
  const paths = new Set<string>();
  const layers: Array<Readonly<Record<string, unknown>>> = [];
  let filename = path.join(projectDirectory, "tsconfig.json");
  for (;;) {
    if (
      paths.size === MAX_CONFIG_CHAIN ||
      paths.has(filename) ||
      !isPathInside(filename, workspaceRoot)
    )
      return null;
    const text = ownedText(filename);
    const config = text === null ? null : parseTsconfigJson(text);
    if (
      !config ||
      config.references !== undefined ||
      config.files !== undefined ||
      config.exclude !== undefined
    )
      return null;
    const options = compilerOptions(config.compilerOptions);
    if (!options) return null;
    if (paths.size === 0) {
      if (
        !Array.isArray(config.include) ||
        !config.include.includes("src") ||
        config.include.some((item) => item !== "src" && item !== "types")
      )
        return null;
    }
    paths.add(filename);
    layers.unshift(options);
    if (config.extends === undefined) break;
    if (
      typeof config.extends !== "string" ||
      !/^\.{1,2}\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.json$/u.test(config.extends)
    )
      return null;
    filename = path.resolve(path.dirname(filename), config.extends);
  }
  const options: Readonly<Record<string, unknown>> = Object.assign({}, ...layers);
  if (
    options.jsx !== "react" ||
    options.jsxFactory !== "h" ||
    options.jsxFragmentFactory !== "Fragment" ||
    options.experimentalDecorators !== true ||
    (options.noEmit !== undefined && options.noEmit !== false) ||
    options.jsxImportSource !== undefined ||
    options.plugins !== undefined ||
    options.paths !== undefined ||
    options.rootDirs !== undefined ||
    options.outFile !== undefined
  )
    return null;
  return [...paths];
};

export const readGeneratedStencil2Owner = (
  workspaceRoot: string,
  filename: string,
): GeneratedStencilOwner | null => {
  if (
    !path.isAbsolute(workspaceRoot) ||
    !path.isAbsolute(filename) ||
    !isPathInside(filename, workspaceRoot) ||
    path.extname(filename) !== ".tsx"
  )
    return null;
  try {
    if (!canonical(workspaceRoot) || !stat(filename)?.isFile() || !canonical(filename)) return null;
    const projectDirectory = firstPackage(path.dirname(filename), workspaceRoot);
    if (projectDirectory === null || !isPathInside(filename, path.join(projectDirectory, "src")))
      return null;
    const manifest = ownedText(path.join(projectDirectory, "package.json"));
    if (manifest === null) return null;
    const build = readGeneratedStencil2Lifecycle(manifest);
    const packageType = parseTsconfigJson(manifest)?.type;
    if (!build || (packageType !== undefined && packageType !== "commonjs")) return null;
    for (let owner = path.dirname(filename); ; owner = path.dirname(owner)) {
      if (
        ALTERNATE_CONFIGS.some(
          (name) =>
            (owner !== projectDirectory || name !== build.generatedConfig) &&
            stat(path.join(owner, name)),
        )
      )
        return null;
      if (owner === projectDirectory) break;
      if (stat(path.join(owner, "tsconfig.json"))) return null;
    }
    const configSource = path.join(projectDirectory, build.source);
    const generatedConfig = path.join(projectDirectory, build.generatedConfig);
    if (!stat(configSource)?.isFile() || !canonical(configSource)) return null;
    const output = stat(generatedConfig);
    if (output && (!output.isFile() || output.nlink !== 1 || !canonical(generatedConfig)))
      return null;
    if (build.createsLibraryDirectory) {
      const libraryDirectory = path.join(projectDirectory, "lib");
      const library = stat(libraryDirectory);
      if (library && (!library.isDirectory() || !canonical(libraryDirectory))) return null;
    }
    const sourceTsconfigs = readTsconfigChain(workspaceRoot, projectDirectory);
    return sourceTsconfigs
      ? {
          projectDirectory,
          configSource,
          generatedConfig,
          sourceTsconfigs,
          createsLibraryDirectory: build.createsLibraryDirectory,
        }
      : null;
  } catch {
    return null;
  }
};
