import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";
import {
  haveNoPhysicalPackageCandidates,
  resolveStockPhysicalEntry,
  type StockPhysicalEntry,
  type StockProviderProfile,
} from "./resolve-stock-physical-entry.js";
import { STOCK_JEST_RENDERER_PACKAGES } from "./stock-jest-renderer-catalogue.js";

type PackageName = keyof typeof STOCK_JEST_RENDERER_PACKAGES;
type TestJsxRuntime = "react/jsx-runtime" | "react/jsx-dev-runtime";

export interface StockJestNamedRendererInput {
  readonly projectRoot: string;
  readonly configFile: string;
  readonly tsconfigFile: string;
  readonly testFile: string;
  readonly reactImporterFiles: readonly string[];
  readonly jsxImporterFiles: readonly string[];
  readonly jsxRuntimeSpecifier: TestJsxRuntime;
}

export interface StockJestNamedRenderer {
  readonly react: StockPhysicalEntry;
  readonly reactDom: StockPhysicalEntry;
  readonly client: StockPhysicalEntry;
  readonly testingLibrary: StockPhysicalEntry;
  readonly scheduler: StockPhysicalEntry;
}

const sameModule = (left: StockPhysicalEntry | null, right: StockPhysicalEntry): boolean =>
  left?.packageDirectory === right.packageDirectory && left.entry === right.entry;

const hasPath = (filename: string): boolean => {
  recordExistenceProbe(filename);
  return lstatSync(filename, { throwIfNoEntry: false }) !== undefined;
};

// Read paths qualified by the caller's independent static profile and source
// analysis. Its parsers own source bytes. Include the paths in this trace so a
// later collector cannot depend on an unchanged focal file alone.
const isRealSource = (filename: string, projectRoot: string): boolean => {
  if (!path.isAbsolute(filename) || !isPathInside(filename, projectRoot)) return false;
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  recordContentProbe(filename);
  return realpathSync(filename) === filename && lstatSync(filename).isFile();
};

type ReadEntry = (
  importerDirectory: string,
  name: PackageName,
  subpath?: string,
) => StockPhysicalEntry | null;

const createReader = (projectRoot: string, profile: StockProviderProfile): ReadEntry => {
  const inspectedScopes = new Set<string>();
  return (importerDirectory, name, subpath = "") => {
    const contract = STOCK_JEST_RENDERER_PACKAGES[name];
    const physical = resolveStockPhysicalEntry({
      projectRoot,
      importerDirectory,
      specifier: name + subpath,
      profile,
      contract,
    });
    if (!physical) return null;
    for (const member of Object.keys(contract.files)) {
      for (
        let directory = path.dirname(path.join(physical.packageDirectory, member));
        directory !== physical.packageDirectory;
        directory = path.dirname(directory)
      ) {
        if (inspectedScopes.has(directory)) break;
        // A nested package.json can change how a physically identical member
        // is interpreted by the host or Jest VM.
        if (hasPath(path.join(directory, "package.json"))) return null;
        inspectedScopes.add(directory);
      }
    }
    return physical;
  };
};

const readDefaultDependency = (
  read: ReadEntry,
  root: string,
  issuer: string,
  name: "jest-runner" | "jest-environment-jsdom",
): StockPhysicalEntry | null => {
  const prefix = name === "jest-runner" ? "jest-runner-" : "jest-environment-";
  if (!haveNoPhysicalPackageCandidates([root, issuer], prefix + name)) return null;
  if (!haveNoPhysicalPackageCandidates([root], name)) return read(root, name);
  return read(issuer, name);
};

const readLoader = (input: StockJestNamedRendererInput): boolean => {
  const { projectRoot, configFile } = input;
  const configDirectory = path.dirname(configFile);
  const read = createReader(projectRoot, "node-require");
  const jest = read(projectRoot, "jest", "/bin/jest");
  const cli = jest && read(path.dirname(jest.entry), "jest-cli");
  const cliDirectory = cli && path.dirname(cli.entry);
  const core = cliDirectory && read(cliDirectory, "@jest/core");
  const config = cliDirectory && read(cliDirectory, "jest-config");
  if (!core || !config || !sameModule(read(path.dirname(core.entry), "jest-config"), config))
    return false;

  const configIssuer = path.dirname(config.entry);
  const runner = readDefaultDependency(read, projectRoot, configIssuer, "jest-runner");
  const circus = read(configIssuer, "jest-circus", "/runner");
  const environment = readDefaultDependency(
    read,
    projectRoot,
    configIssuer,
    "jest-environment-jsdom",
  );
  if (!runner || !circus || !environment || !read(path.dirname(environment.entry), "jsdom"))
    return false;

  const runnerIssuer = path.dirname(runner.entry);
  const runtime = read(runnerIssuer, "jest-runtime");
  const transformer = read(runnerIssuer, "@jest/transform");
  const resolver = read(configIssuer, "jest-resolve");
  if (
    !runtime ||
    !transformer ||
    !resolver ||
    !sameModule(read(path.dirname(runtime.entry), "@jest/transform"), transformer) ||
    !sameModule(read(path.dirname(runtime.entry), "jest-resolve"), resolver)
  )
    return false;
  const resolverIssuer = path.dirname(resolver.entry);
  const resolve = read(resolverIssuer, "resolve");
  if (
    !resolve ||
    !read(resolverIssuer, "resolve.exports") ||
    !read(path.join(resolve.packageDirectory, "lib"), "is-core-module")
  )
    return false;

  const tsJest = read(configDirectory, "ts-jest");
  const preset = read(projectRoot, "ts-jest", "/jest-preset.js");
  if (
    !tsJest ||
    preset?.packageDirectory !== tsJest.packageDirectory ||
    hasPath(path.join(tsJest.packageDirectory, "jest-preset")) ||
    [
      "jest-preset.json",
      "presets.js",
      "presets.json",
      "presets.node",
      "dist/config.js",
      "dist/config.json",
      "dist/config.node",
    ].some((name) => hasPath(path.join(tsJest.packageDirectory, name))) ||
    [
      "dist/config/paths-to-module-name-mapper",
      "dist/legacy/ts-jest-transformer",
      "dist/legacy/compiler/ts-compiler",
      "dist/utils/importer",
      "dist/transformers/hoist-jest",
    ].some((name) => hasPath(path.join(tsJest.packageDirectory, name)))
  )
    return false;
  const compiler = read(path.join(tsJest.packageDirectory, "dist", "legacy"), "typescript");
  return (
    !!compiler &&
    sameModule(read(path.join(tsJest.packageDirectory, "dist", "utils"), "typescript"), compiler)
  );
};

const readRenderer = (input: StockJestNamedRendererInput): StockJestNamedRenderer | null => {
  const { projectRoot, testFile, reactImporterFiles, jsxImporterFiles, jsxRuntimeSpecifier } =
    input;
  const read = createReader(projectRoot, "jest-browser");
  const caller = path.dirname(testFile);
  const react = read(caller, "react");
  const testingLibrary = read(caller, "@testing-library/react");
  if (!react || !testingLibrary) return null;

  const renderIssuer = path.dirname(testingLibrary.entry);
  if (
    ["act-compat", "config", "fire-event", "pure"].some((name) =>
      hasPath(path.join(renderIssuer, name)),
    )
  )
    return null;
  const reactDom = read(renderIssuer, "react-dom");
  const client = read(renderIssuer, "react-dom", "/client");
  const testUtils = read(renderIssuer, "react-dom", "/test-utils");
  if (
    !reactDom ||
    client?.packageDirectory !== reactDom.packageDirectory ||
    testUtils?.packageDirectory !== reactDom.packageDirectory ||
    !read(renderIssuer, "@testing-library/dom") ||
    !sameModule(read(path.dirname(client.entry), "react-dom"), reactDom)
  )
    return null;

  const rendererCjs = path.join(reactDom.packageDirectory, "cjs");
  const reactCjs = path.join(react.packageDirectory, "cjs");
  if (
    ![renderIssuer, rendererCjs, reactCjs, ...reactImporterFiles.map(path.dirname)].every(
      (directory) => sameModule(read(directory, "react"), react),
    ) ||
    !sameModule(read(rendererCjs, "react-dom"), reactDom)
  )
    return null;

  for (const filename of jsxImporterFiles) {
    const jsx = read(path.dirname(filename), "react", jsxRuntimeSpecifier.slice("react".length));
    if (jsx?.packageDirectory !== react.packageDirectory) return null;
  }

  const scheduler = read(rendererCjs, "scheduler");
  return scheduler ? { react, reactDom, client, testingLibrary, scheduler } : null;
};

/**
 * Check the physical provider members for a separately qualified direct
 * Testing Library render(jsx) in a named Jest test. The caller owns profile
 * and source proofs: stock CommonJS jsdom, browser export conditions,
 * NODE_ENV=test, normal React JSX compiler options, no remap/mock/override,
 * and selected JS/TS source paths. This is not a full transitive runtime or
 * executable-selection proof. Installed modules and configs are never loaded.
 */
export const readStockJestNamedRenderer = (
  input: StockJestNamedRendererInput,
): StockJestNamedRenderer | null => {
  const {
    projectRoot,
    configFile,
    tsconfigFile,
    testFile,
    reactImporterFiles,
    jsxImporterFiles,
    jsxRuntimeSpecifier,
  } = input;
  if (
    !path.isAbsolute(projectRoot) ||
    path.dirname(configFile) !== projectRoot ||
    path.dirname(tsconfigFile) !== projectRoot ||
    !reactImporterFiles.length ||
    !jsxImporterFiles.includes(testFile) ||
    (jsxRuntimeSpecifier !== "react/jsx-runtime" && jsxRuntimeSpecifier !== "react/jsx-dev-runtime")
  )
    return null;
  try {
    if (
      ![configFile, tsconfigFile, testFile, ...reactImporterFiles, ...jsxImporterFiles].every(
        (filename) => isRealSource(filename, projectRoot),
      )
    )
      return null;
    return readLoader(input) ? readRenderer(input) : null;
  } catch {
    return null;
  }
};
