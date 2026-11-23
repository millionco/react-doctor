import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { hasStockNodeNpmCompilerEnvironment } from "./has-stock-node-npm-compiler-environment.js";
import { isPathInside } from "./is-path-inside.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import type {
  StockPackageContract,
  StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { STOCK_ELECTRON_RENDERER_PROFILE } from "./stock-electron-renderer-profile.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";

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
      !hasStockNodeNpmCompilerEnvironment(root)
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
    if (!verifyStockNpmCompilerPackages(root, STOCK_ELECTRON_RENDERER_PROFILE)) return null;
    const packages = STOCK_ELECTRON_RENDERER_PROFILE.packages;
    const byName = new Map(
      packages
        .filter((item) => item.directory === `node_modules/${item.name}`)
        .map((item) => [item.name, item]),
    );
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
