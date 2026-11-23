import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import {
  haveNoPhysicalPackageCandidates,
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import type {
  StockPackageContract,
  StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { STOCK_ELECTRON_RENDERER_PROFILE } from "./stock-electron-renderer-profile.js";
import type { ElectronCompilerPackageProfile } from "./stock-electron-renderer-profile.js";

export interface VerifiedElectronRendererCompiler {
  readonly electronVite: StockPhysicalEntry;
  readonly vite: StockPhysicalEntry;
  readonly reactPlugin: StockPhysicalEntry;
  readonly esbuild: StockPhysicalEntry;
  readonly jsxRuntime: StockPhysicalEntry;
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
const CONFIG_NAMES = ["js", "ts", "cjs", "mts", "cts"];
const ENVIRONMENT_OVERRIDES = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "ESBUILD_BINARY_PATH",
  "ESBUILD_WORKER_THREADS",
  "npm_config_script_shell",
  "npm_config_node_options",
  "npm_config_prefix",
  "PREFIX",
]);
const hasStockEnvironment = (): boolean =>
  process.platform === "linux" &&
  process.arch === "x64" &&
  process.release.name === "node" &&
  !process.versions.bun &&
  !process.versions.electron &&
  process.versions.node.startsWith("24.") &&
  process.execArgv.length === 0 &&
  (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "production") &&
  Object.entries(process.env).every(
    ([key, value]) =>
      !value ||
      (!ENVIRONMENT_OVERRIDES.has(key) &&
        !ENVIRONMENT_OVERRIDES.has(key.toLowerCase()) &&
        !/^(?:ELECTRON_|VITE_|BABEL_)/u.test(key)),
  );

const isEmptyOrMissingConfig = (filename: string): boolean => {
  if (!path.isAbsolute(filename)) return false;
  const info = stat(filename);
  return !info || (info.isFile() && info.size === 0 && fs.realpathSync(filename) === filename);
};

const hasStockNpmConfiguration = (root: string): boolean => {
  // A selected npm config can change the build script shell. Inspect only
  // candidate file metadata because npm config may contain credentials.
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (!isEmptyOrMissingConfig(path.join(directory, ".npmrc"))) return false;
    if (path.dirname(directory) === directory) break;
  }
  const defaults = [
    ["npm_config_userconfig", path.join(homedir(), ".npmrc")],
    ["npm_config_globalconfig", path.resolve(path.dirname(process.execPath), "../etc/npmrc")],
  ] as const;
  for (const [variable, fallback] of defaults) {
    const configured = Object.entries(process.env)
      .filter(([key, value]) => key.toLowerCase() === variable && value)
      .map(([, value]) => value!);
    if (!(configured.length > 0 ? configured : [fallback]).every(isEmptyOrMissingConfig))
      return false;
  }
  return true;
};

const nearestPackageDirectory = (filename: string): string | null => {
  for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
    if (stat(path.join(directory, "package.json"))) return directory;
    if (path.dirname(directory) === directory) return null;
  }
};
const readManifest = (directory: string): Record<string, unknown> | null => {
  const bytes = readProviderMember(path.join(directory, "package.json"));
  return bytes ? object(JSON.parse(bytes.toString("utf8"))) : null;
};
const stockNodeShebang = (root: string): boolean => {
  // npm prepends ancestor node_modules/.bin directories before PATH. Refuse
  // their node shadows, then require the first ordinary PATH node to be the
  // same trusted runtime that is evaluating this proof.
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (stat(path.join(directory, "node_modules", ".bin", "node"))) return false;
    if (path.dirname(directory) === directory) break;
  }
  const runtime = fs.realpathSync(process.execPath);
  const npmRuntime = process.env.npm_node_execpath;
  if (npmRuntime && fs.realpathSync(npmRuntime) !== runtime) return false;
  const entries = process.env.PATH?.split(path.delimiter);
  if (!entries?.length) return false;
  for (const entry of entries) {
    if (!entry || !path.isAbsolute(entry)) return false;
    const candidate = path.join(entry, "node");
    if (!stat(candidate)) continue;
    const selected = fs.realpathSync(candidate);
    const target = stat(selected);
    return selected === runtime && Boolean(target?.isFile() && target.mode & 0o111);
  }
  return false;
};

// Close the regular npm package layout, including extensionless require
// shadows and nested package candidates. No package code is loaded.
const packageCandidate = (issuer: string, name: string): string | null => {
  for (let directory = issuer; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    for (const extension of [".js", ".json", ".node"]) {
      if (stat(candidate + extension)) return null;
    }
    const info = stat(candidate);
    if (info)
      return info.isDirectory() && fs.realpathSync(candidate) === candidate ? candidate : null;
    if (path.dirname(directory) === directory) return null;
  }
};
const verifyPackage = (
  root: string,
  profile: ElectronCompilerPackageProfile,
  expectedPackages: ReadonlySet<string>,
): boolean => {
  const directory = path.join(root, profile.directory);
  if (fs.realpathSync(directory) !== directory || !stat(directory)?.isDirectory()) return false;
  const discovered: Array<[string, number, string]> = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          if (![...expectedPackages].some((candidate) => isPathInside(candidate, filename)))
            return false;
          continue;
        }
        pending.push(filename);
      } else if (entry.isFile()) {
        const member = path.relative(directory, filename).split(path.sep).join("/");
        const bytes = readProviderMember(filename);
        if (!bytes) return false;
        discovered.push([member, bytes.length, createHash("sha256").update(bytes).digest("hex")]);
      } else return false;
    }
  }
  discovered.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (
    discovered.length !== profile.memberCount ||
    createHash("sha256").update(JSON.stringify(discovered)).digest("hex") !== profile.contentDigest
  )
    return false;
  const manifest = readManifest(directory);
  return manifest?.name === profile.name && manifest.version === profile.version;
};

/**
 * Verifies only the stock compiler installation for a separately proved
 * renderer route. The caller owns config AST, renderer-only reachability,
 * source pragmas, and disabling both cache layers. No memoization is used.
 */
export const readVerifiedElectronRendererCompiler = (input: {
  readonly projectRoot: string;
  readonly filename: string;
  readonly configFile: string;
}): VerifiedElectronRendererCompiler | null => {
  try {
    if (!hasStockEnvironment()) return null;
    const report = object(process.report?.getReport());
    if (typeof object(report?.header)?.glibcVersionRuntime !== "string") return null;
    const root = path.resolve(input.projectRoot);
    const filename = path.resolve(input.filename);
    const config = path.resolve(input.configFile);
    if (
      !path.isAbsolute(input.projectRoot) ||
      !path.isAbsolute(input.filename) ||
      !path.isAbsolute(input.configFile) ||
      fs.realpathSync(root) !== root ||
      fs.realpathSync(filename) !== filename ||
      fs.realpathSync(config) !== config ||
      !isPathInside(filename, root) ||
      nearestPackageDirectory(filename) !== root ||
      config !== path.join(root, "electron.vite.config.mjs") ||
      !stockNodeShebang(root) ||
      !hasStockNpmConfiguration(root)
    )
      return null;
    const manifest = readManifest(root);
    const scripts = object(manifest?.scripts);
    if (
      !scripts ||
      scripts.build !== "electron-vite build" ||
      Object.hasOwn(scripts, "prebuild") ||
      Object.hasOwn(scripts, "postbuild")
    )
      return null;
    for (const extension of CONFIG_NAMES) {
      if (stat(path.join(root, `electron.vite.config.${extension}`))) return null;
    }
    for (const name of [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs"]) {
      for (let directory = root; ; directory = path.dirname(directory)) {
        if (stat(path.join(directory, name))) return null;
        if (path.dirname(directory) === directory) break;
      }
    }
    const packages = STOCK_ELECTRON_RENDERER_PROFILE.packages;
    const byName = new Map(
      packages
        .filter((item) => item.directory === `node_modules/${item.name}`)
        .map((item) => [item.name, item]),
    );
    const expectedPackages = new Set(packages.map((item) => path.join(root, item.directory)));
    for (const profile of packages)
      if (!verifyPackage(root, profile, expectedPackages)) return null;
    for (const edge of STOCK_ELECTRON_RENDERER_PROFILE.edges) {
      if (
        packageCandidate(path.join(root, edge.issuer), edge.specifier) !==
        path.join(root, edge.target)
      )
        return null;
    }
    for (const missing of STOCK_ELECTRON_RENDERER_PROFILE.missing) {
      if (!haveNoPhysicalPackageCandidates([path.join(root, missing.issuer)], missing.specifier))
        return null;
    }
    const resolve = (
      name: string,
      issuer: string,
      specifier = name,
      profile: "node-import" | "node-require" | "vite-production-import" = "node-import",
    ) => {
      const catalog = byName.get(name);
      if (!catalog) return null;
      const contract: StockPackageContract = {
        packageName: name,
        version: catalog.version,
        files: catalog.entryMembers,
      };
      return resolveStockPhysicalEntry({
        projectRoot: root,
        importerDirectory: issuer,
        specifier,
        profile,
        contract,
      });
    };
    const electronVite = resolve("electron-vite", root);
    const reactPlugin = resolve("@vitejs/plugin-react", root);
    if (!electronVite || !reactPlugin) return null;
    const launcher = path.join(root, "node_modules", ".bin", "electron-vite");
    if (
      !stat(launcher)?.isSymbolicLink() ||
      fs.readlinkSync(launcher) !== "../electron-vite/bin/electron-vite.js"
    )
      return null;
    const launcherTarget = path.join(electronVite.packageDirectory, "bin", "electron-vite.js");
    if (
      fs.realpathSync(launcher) !== launcherTarget ||
      !stat(launcherTarget)?.isFile() ||
      !(stat(launcherTarget)!.mode & 0o111)
    )
      return null;
    const vite = resolve("vite", path.join(electronVite.packageDirectory, "dist", "chunks"));
    const esbuild = vite
      ? resolve("esbuild", path.join(vite.packageDirectory, "dist", "node", "chunks"))
      : null;
    const jsxRuntime = resolve(
      "react",
      path.dirname(filename),
      "react/jsx-runtime",
      "vite-production-import",
    );
    if (
      !vite ||
      !esbuild ||
      !jsxRuntime ||
      jsxRuntime.packageDirectory !== path.join(root, "node_modules", "react")
    )
      return null;
    const pluginVite = resolve("vite", path.dirname(reactPlugin.entry));
    const configEsbuild = resolve(
      "esbuild",
      path.join(electronVite.packageDirectory, "dist", "chunks"),
    );
    const native = resolve(
      "@esbuild/linux-x64",
      path.dirname(esbuild.entry),
      "@esbuild/linux-x64/bin/esbuild",
      "node-require",
    );
    if (
      pluginVite?.packageDirectory !== vite.packageDirectory ||
      configEsbuild?.packageDirectory !== esbuild.packageDirectory ||
      !native ||
      !(stat(native.entry)!.mode & 0o111)
    )
      return null;
    return { electronVite, vite, reactPlugin, esbuild, jsxRuntime };
  } catch {
    return null;
  }
};
