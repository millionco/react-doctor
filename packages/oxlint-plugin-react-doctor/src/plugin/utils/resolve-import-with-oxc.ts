import * as fs from "node:fs";
import * as path from "node:path";
import { ResolverFactory } from "oxc-resolver";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../constants/thresholds.js";

// oxc-resolver-backed import resolution for cross-file analysis. Unlike the
// hand-rolled resolver (`resolve-module-path.ts`), oxc-resolver does NOT
// report the set of filesystem probes it made, so a resolution through this
// util CANNOT be probe-fingerprinted by the sidecar lint cache's dependency
// collectors (`cross-file-dependencies.ts`). Any rule that reaches this util
// (directly or transitively) MUST therefore be classified in
// `UNBOUNDED_CROSS_FILE_RULE_IDS` — re-linting every file on every scan —
// and MUST NOT ship a collector in `CROSS_FILE_DEPENDENCY_COLLECTORS`.
// `cross-file-rule-ids.test.ts` in @react-doctor/core lists this file as a
// cross-file primitive so an unclassified consumer fails the guard.

const RESOLVER_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

const RESOLVER_EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

const COMMON_RESOLVER_OPTIONS = {
  extensions: RESOLVER_EXTENSIONS,
  extensionAlias: RESOLVER_EXTENSION_ALIAS,
  conditionNames: ["import", "module", "browser", "default", "require"],
  mainFields: ["module", "browser", "main"],
};

// Nearest ancestor directory carrying a tsconfig.json or package.json — the
// project boundary the resolver instance is scoped (and cached) to. Falls
// back to the importing file's own directory when the capped walk finds
// neither.
const findResolutionRootDirectory = (fromDirectory: string): string => {
  let currentDirectory = fromDirectory;
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    if (
      fs.existsSync(path.join(currentDirectory, "tsconfig.json")) ||
      fs.existsSync(path.join(currentDirectory, "package.json"))
    ) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return fromDirectory;
};

const resolverByRootDirectory = new Map<string, ResolverFactory>();

const getResolverForRootDirectory = (rootDirectory: string): ResolverFactory => {
  const cachedResolver = resolverByRootDirectory.get(rootDirectory);
  if (cachedResolver) return cachedResolver;

  const tsconfigFilePath = path.join(rootDirectory, "tsconfig.json");
  let resolver: ResolverFactory;
  try {
    resolver = new ResolverFactory({
      ...COMMON_RESOLVER_OPTIONS,
      tsconfig: fs.existsSync(tsconfigFilePath)
        ? { configFile: tsconfigFilePath, references: "auto" }
        : undefined,
    });
  } catch {
    // A malformed tsconfig.json can fail factory construction; resolve
    // without alias support rather than not at all.
    resolver = new ResolverFactory(COMMON_RESOLVER_OPTIONS);
  }
  resolverByRootDirectory.set(rootDirectory, resolver);
  return resolver;
};

const isInsideNodeModules = (absoluteFilePath: string): boolean =>
  absoluteFilePath.split(/[\\/]/).includes("node_modules");

// Resolves `specifier` as imported from `fromFilename` to an absolute file
// path via oxc-resolver (relative specifiers, tsconfig `paths` aliases,
// extension aliasing like `./x.js` -> `x.ts`). Returns null — never throws —
// when `fromFilename` is not absolute, resolution fails, or the resolved
// file lives inside node_modules (cross-file analysis follows user code
// only; installed packages are out of scope).
export const resolveImportWithOxc = (fromFilename: string, specifier: string): string | null => {
  try {
    if (!path.isAbsolute(fromFilename)) return null;
    const fromDirectory = path.dirname(fromFilename);
    const resolver = getResolverForRootDirectory(findResolutionRootDirectory(fromDirectory));
    const resolveResult = resolver.sync(fromDirectory, specifier);
    if (!resolveResult.path) return null;
    if (isInsideNodeModules(resolveResult.path)) return null;
    return resolveResult.path;
  } catch {
    return null;
  }
};

// Exposed for tests; production callers rely on the per-root resolver cache
// living for the whole lint process.
export const __clearResolveImportWithOxcCacheForTests = (): void => {
  resolverByRootDirectory.clear();
};
