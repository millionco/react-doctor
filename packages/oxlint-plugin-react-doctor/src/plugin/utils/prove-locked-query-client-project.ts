import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { hasReviewedQueryClientAndNextIntlYarnLock } from "./has-reviewed-query-client-and-next-intl-yarn-lock.js";
import { getSupportedNextIntlRequestPath } from "./get-supported-next-intl-request-path.js";
import { reviewedQueryClientPackageFiles } from "./reviewed-query-client-package-files.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";

type OrdinaryFileEntry = "file" | "directory" | "absent" | "unsupported";

const unsupportedProjectFiles = [
  ".babelrc",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.json",
  ".babelrc.mjs",
  ".npmrc",
  ".pnp.cjs",
  ".pnp.js",
  ".pnp.loader.mjs",
  ".swcrc",
  ".yarn",
  ".yarnrc",
  ".yarnrc.yml",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.json",
  "bun.lock",
  "bun.lockb",
  "jsconfig.json",
  "next.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.cts",
  "next.config.mts",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
  "webpack.config.js",
  "webpack.config.ts",
];

const packageFileExtensions = [
  ".js",
  ".json",
  ".node",
  ".ts",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

const readOrdinaryFileEntry = (candidate: string): OrdinaryFileEntry => {
  recordExistenceProbe(candidate);
  try {
    const entry = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!entry) return "absent";
    if (entry.isFile()) return "file";
    if (entry.isDirectory()) return "directory";
  } catch {
    return "unsupported";
  }
  return "unsupported";
};

const isInsideDirectory = (filename: string, directory: string): boolean => {
  const relative = path.relative(directory, filename);
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
};

const isOrdinaryDirectoryChain = (directory: string, root: string): boolean => {
  if (directory !== root && !isInsideDirectory(directory, root)) return false;
  let current = directory;
  while (true) {
    if (readOrdinaryFileEntry(current) !== "directory") return false;
    if (current === root) return true;
    current = path.dirname(current);
  }
};

export const isOrdinaryFileWithinQueryClientProject = (filename: string, root: string): boolean =>
  isInsideDirectory(filename, root) &&
  isOrdinaryDirectoryChain(path.dirname(filename), root) &&
  readOrdinaryFileEntry(filename) === "file";

const readBoundedText = (filename: string): string | null => {
  recordContentProbe(filename);
  try {
    if (fs.statSync(filename).size > 2_000_000) return null;
    return fs.readFileSync(filename, "utf8");
  } catch {
    return null;
  }
};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOrdinaryNextScripts = (scripts: unknown): boolean =>
  isJsonObject(scripts) &&
  scripts.build === "next build" &&
  typeof scripts.dev === "string" &&
  ["next dev", "next dev --turbo", "next dev --turbopack"].includes(scripts.dev) &&
  (scripts.start === undefined || scripts.start === "next start") &&
  ["preinstall", "install", "postinstall", "prepare", "predev", "prebuild", "prestart"].every(
    (name) => !(name in scripts),
  );

const hasNoNestedCompilerConfig = (directory: string, root: string): boolean => {
  let current = directory;
  while (current !== root) {
    if (
      [...unsupportedProjectFiles, "tsconfig.json"].some(
        (name) => readOrdinaryFileEntry(path.join(current, name)) !== "absent",
      )
    )
      return false;
    current = path.dirname(current);
  }
  return true;
};

const hasOrdinaryNextTypeScriptResolution = (filename: string): boolean => {
  const contents = readBoundedText(filename);
  if (contents === null) return false;
  try {
    const config: unknown = JSON.parse(contents);
    if (
      !isJsonObject(config) ||
      "extends" in config ||
      "references" in config ||
      !isJsonObject(config.compilerOptions)
    )
      return false;
    const options = config.compilerOptions;
    if (
      options.moduleResolution !== "bundler" ||
      options.module !== "esnext" ||
      [
        "baseUrl",
        "customConditions",
        "moduleSuffixes",
        "jsxImportSource",
        "verbatimModuleSyntax",
      ].some((name) => name in options)
    )
      return false;
    const paths = options.paths;
    return (
      paths === undefined ||
      (isJsonObject(paths) &&
        Object.keys(paths).length === 1 &&
        Array.isArray(paths["@/*"]) &&
        paths["@/*"].length === 1 &&
        paths["@/*"][0] === "./src/*")
    );
  } catch {
    return false;
  }
};

// Check the same lexical ancestor search Node uses for an unaliased bare
// package request. A package found outside the project is not a local install.
const findOrdinaryInstalledPackage = (
  directory: string,
  root: string,
  name: string,
): string | null | false => {
  let current = directory;
  const parts = name.split("/");
  while (true) {
    const modules = path.join(current, "node_modules");
    const moduleEntry = readOrdinaryFileEntry(modules);
    if (moduleEntry !== "absent") {
      if (moduleEntry !== "directory") return false;
      const scopeDirectory = parts.length === 2 ? path.join(modules, parts[0]) : modules;
      const scopeEntry =
        scopeDirectory === modules ? "directory" : readOrdinaryFileEntry(scopeDirectory);
      if (scopeEntry !== "absent") {
        if (scopeEntry !== "directory") return false;
        const packageDirectory = path.join(scopeDirectory, parts.at(-1) ?? "");
        if (
          packageFileExtensions.some(
            (extension) => readOrdinaryFileEntry(packageDirectory + extension) !== "absent",
          )
        )
          return false;
        const packageEntry = readOrdinaryFileEntry(packageDirectory);
        if (packageEntry !== "absent") {
          return packageEntry === "directory" && isInsideDirectory(packageDirectory, root)
            ? packageDirectory
            : false;
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const hasNoInstalledModuleDirectories = (directory: string): boolean => {
  let current = directory;
  while (true) {
    if (readOrdinaryFileEntry(path.join(current, "node_modules")) !== "absent") return false;
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
};

const hasReviewedInstalledSources = (
  directory: string,
  hashes: Readonly<Record<string, string>>,
): boolean => {
  for (const [relative, digest] of Object.entries(hashes)) {
    const filename = path.join(directory, relative);
    if (!isOrdinaryFileWithinQueryClientProject(filename, directory)) return false;
    recordContentProbe(filename);
    try {
      if (
        fs.statSync(filename).size > 2_000_000 ||
        createHash("sha256").update(fs.readFileSync(filename)).digest("hex") !== digest
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
};

const hasOrdinaryNextLauncher = (root: string, next: string): boolean => {
  const bin = path.join(root, "node_modules", ".bin");
  if (!isOrdinaryDirectoryChain(bin, root)) return false;
  const launcher = path.join(bin, "next");
  if (
    [".cmd", ".bat", ".exe", ".com", ".ps1"].some(
      (extension) => readOrdinaryFileEntry(launcher + extension) !== "absent",
    )
  )
    return false;
  recordExistenceProbe(launcher);
  try {
    const target = fs.readlinkSync(launcher);
    return path.resolve(bin, target) === path.join(next, "dist", "bin", "next");
  } catch {
    return false;
  }
};

const hasOrdinaryQueryClientProviders = (root: string, provider: string): boolean => {
  const intl = findOrdinaryInstalledPackage(root, root, "next-intl");
  const next = findOrdinaryInstalledPackage(root, root, "next");
  const query = findOrdinaryInstalledPackage(path.dirname(provider), root, "@tanstack/react-query");
  const react = findOrdinaryInstalledPackage(path.dirname(provider), root, "react");
  if (intl === false || next === false || query === false || react === false) return false;
  if (intl === null && next === null && query === null && react === null) {
    // A source checkout can use the reviewed locked dependency graph. A
    // partial or different local install must not fall back to that graph.
    return hasNoInstalledModuleDirectories(path.dirname(provider));
  }
  if (
    !intl ||
    !next ||
    !query ||
    !react ||
    !hasOrdinaryNextLauncher(root, next) ||
    !hasReviewedInstalledSources(intl, reviewedQueryClientPackageFiles.nextIntl) ||
    !hasReviewedInstalledSources(query, reviewedQueryClientPackageFiles.reactQuery) ||
    !hasReviewedInstalledSources(next, reviewedQueryClientPackageFiles.next) ||
    !hasReviewedInstalledSources(react, reviewedQueryClientPackageFiles.react)
  )
    return false;
  const core = findOrdinaryInstalledPackage(
    path.join(query, "build", "modern"),
    root,
    "@tanstack/query-core",
  );
  const legacyCore = findOrdinaryInstalledPackage(
    path.join(query, "build", "legacy"),
    root,
    "@tanstack/query-core",
  );
  return (
    typeof core === "string" &&
    core === legacyCore &&
    hasReviewedInstalledSources(core, reviewedQueryClientPackageFiles.queryCore)
  );
};

export const proveLockedQueryClientProject = (
  filename: string,
  provider: string,
): string | null => {
  const root = findNearestPackageDirectory(filename);
  if (
    !root ||
    !isOrdinaryDirectoryChain(root, path.parse(root).root) ||
    !isOrdinaryFileWithinQueryClientProject(filename, root) ||
    !isOrdinaryFileWithinQueryClientProject(provider, root) ||
    findNearestPackageDirectory(provider) !== root ||
    !isOrdinaryFileWithinQueryClientProject(path.join(root, "package.json"), root)
  )
    return null;
  const manifest = readPackageManifest(root);
  if (
    !manifest ||
    !("packageManager" in manifest) ||
    typeof manifest.packageManager !== "string" ||
    !/^yarn@1\.\d+\.\d+(?:\+sha512\.[0-9a-f]+)?$/i.test(manifest.packageManager) ||
    ["alias", "babel", "browser", "imports", "overrides", "pnpm", "resolutions", "workspaces"].some(
      (name) => name in manifest,
    ) ||
    !hasOrdinaryNextScripts(manifest.scripts) ||
    manifest.dependencies?.next !== "15.2.4" ||
    manifest.dependencies?.react !== "^19.0.0"
  )
    return null;
  const reactQueryRange = manifest.dependencies?.["@tanstack/react-query"];
  const nextIntlRange = manifest.dependencies?.["next-intl"];
  if (typeof reactQueryRange !== "string" || typeof nextIntlRange !== "string") return null;
  if (
    ["next", "react", "next-intl", "@tanstack/react-query", "@tanstack/query-core"].some((name) =>
      [manifest.devDependencies, manifest.optionalDependencies, manifest.peerDependencies].some(
        (group) => group?.[name] !== undefined,
      ),
    )
  )
    return null;
  if (
    unsupportedProjectFiles.some(
      (name) => readOrdinaryFileEntry(path.join(root, name)) !== "absent",
    ) ||
    !hasNoNestedCompilerConfig(path.dirname(provider), root) ||
    !hasNoNestedCompilerConfig(path.dirname(filename), root)
  )
    return null;
  const tsconfig = path.join(root, "tsconfig.json");
  const nextConfig = path.join(root, "next.config.ts");
  const lockfile = path.join(root, "yarn.lock");
  if (
    [tsconfig, nextConfig, lockfile].some(
      (candidate) => readOrdinaryFileEntry(candidate) !== "file",
    ) ||
    !hasOrdinaryNextTypeScriptResolution(tsconfig)
  )
    return null;
  const lockText = readBoundedText(lockfile);
  if (
    lockText === null ||
    !hasReviewedQueryClientAndNextIntlYarnLock(lockText, { reactQueryRange, nextIntlRange }) ||
    !hasOrdinaryQueryClientProviders(root, provider)
  )
    return null;
  const config = parseSourceFile(nextConfig);
  if (!config) return null;
  attachParentReferences(config);
  const request = getSupportedNextIntlRequestPath(config, analyzeScopes(config), "4.0.2");
  return request && isOrdinaryFileWithinQueryClientProject(path.resolve(root, request), root)
    ? root
    : null;
};
