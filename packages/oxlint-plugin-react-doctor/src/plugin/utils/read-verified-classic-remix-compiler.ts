import * as fs from "node:fs";
import * as path from "node:path";
import { hasStockNodeNpmCompilerEnvironment } from "./has-stock-node-npm-compiler-environment.js";
import type { DeclaredClassicRemixRoute } from "./read-declared-classic-remix-route.js";
import { STOCK_CLASSIC_REMIX_PROFILE } from "./stock-classic-remix-profile.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExpectedLauncher = (launcher: string, relativeTarget: string): boolean => {
  if (fs.lstatSync(launcher, { throwIfNoEntry: false })?.isSymbolicLink() !== true) return false;
  const target = path.resolve(path.dirname(launcher), relativeTarget);
  if (fs.readlinkSync(launcher) !== relativeTarget || fs.realpathSync(launcher) !== target)
    return false;
  const info = fs.lstatSync(target, { throwIfNoEntry: false });
  return info?.isFile() === true && (info.mode & 0o111) !== 0;
};

const NPM_RUNNER_OVERRIDES = new Set([
  "npm_config_workspace",
  "npm_config_workspaces",
  "npm_config_include_workspace_root",
  "npm_config_global",
]);

const hasStockNpmRunner = (projectRoot: string): boolean => {
  if (
    fs.readdirSync(projectRoot).some((entry) => entry.startsWith("build:")) ||
    Object.entries(process.env).some(([name, value]) => {
      const key = name.toLowerCase();
      return value && (NPM_RUNNER_OVERRIDES.has(key) || key.startsWith("npm_package_config_"));
    })
  ) {
    return false;
  }
  for (let directory = projectRoot; ; directory = path.dirname(directory)) {
    if (
      fs.lstatSync(path.join(directory, "node_modules", ".bin", "npm"), { throwIfNoEntry: false })
    )
      return false;
    if (path.dirname(directory) === directory) break;
  }

  const runtime = fs.realpathSync(process.execPath);
  const npmCli = path.resolve(path.dirname(runtime), "../lib/node_modules/npm/bin/npm-cli.js");
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && (!path.isAbsolute(npmExecPath) || fs.realpathSync(npmExecPath) !== npmCli))
    return false;
  const entries = process.env.PATH?.split(path.delimiter) ?? [];
  for (const entry of entries) {
    if (!path.isAbsolute(entry)) return false;
    const launcher = path.join(entry, "npm");
    if (!fs.lstatSync(launcher, { throwIfNoEntry: false })) continue;
    return fs.realpathSync(launcher) === npmCli && (fs.statSync(npmCli).mode & 0o111) !== 0;
  }
  return false;
};

export const hasVerifiedClassicRemixCompiler = (route: DeclaredClassicRemixRoute): boolean => {
  try {
    const { projectRoot, filename, requiredPackageScript } = route;
    if (
      !hasStockNodeNpmCompilerEnvironment(projectRoot) ||
      Object.entries(process.env).some(([name, value]) => name.startsWith("REMIX_") && value)
    ) {
      return false;
    }
    const projectManifest = readProviderMember(path.join(projectRoot, "package.json"));
    const manifest: unknown = projectManifest ? JSON.parse(projectManifest.toString("utf8")) : null;
    if (
      !isObject(manifest) ||
      [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(
        (dependencies) =>
          isObject(dependencies) && Object.hasOwn(dependencies, "@vanilla-extract/css"),
      )
    ) {
      return false;
    }
    for (let directory = projectRoot; ; directory = path.dirname(directory)) {
      if (
        [".pnp.cjs", ".pnp.js", ".pnp.loader.mjs"].some(
          (name) =>
            fs.lstatSync(path.join(directory, name), { throwIfNoEntry: false }) !== undefined,
        )
      )
        return false;
      if (path.dirname(directory) === directory) break;
    }

    const bin = path.join(projectRoot, "node_modules", ".bin");
    if (!hasExpectedLauncher(path.join(bin, "remix"), "../@remix-run/dev/dist/cli.js"))
      return false;
    if (
      requiredPackageScript === "build:remix" &&
      (Object.hasOwn(manifest, "config") ||
        !hasExpectedLauncher(path.join(bin, "run-s"), "../npm-run-all/bin/run-s/index.js") ||
        !hasStockNpmRunner(projectRoot))
    ) {
      return false;
    }
    if (!verifyStockNpmCompilerPackages(projectRoot, STOCK_CLASSIC_REMIX_PROFILE)) return false;

    const resolve = (name: string, importerDirectory: string, specifier = name) => {
      const packageProfile = STOCK_CLASSIC_REMIX_PROFILE.packages.find(
        (profile) => profile.directory === `node_modules/${name}`,
      );
      if (!packageProfile) return null;
      return resolveStockPhysicalEntry({
        projectRoot,
        importerDirectory,
        specifier,
        profile: "node-require",
        contract: {
          packageName: name,
          version: packageProfile.version,
          files: packageProfile.entryMembers,
        },
      });
    };
    const remix = resolve("@remix-run/dev", projectRoot);
    if (!remix?.entry.endsWith("/dist/index.js")) return false;
    const remixCompiler = path.join(remix.packageDirectory, "dist", "compiler");
    const browserBuilder = resolve("esbuild", path.join(remixCompiler, "js"));
    const serverBuilder = resolve("esbuild", path.join(remixCompiler, "server"));
    const cssBuilder = resolve("esbuild", path.join(remixCompiler, "css"));
    if (
      !browserBuilder ||
      browserBuilder.entry !== serverBuilder?.entry ||
      browserBuilder.entry !== cssBuilder?.entry
    )
      return false;
    const nativeBuilder = resolve(
      "@esbuild/linux-x64",
      path.dirname(browserBuilder.entry),
      "@esbuild/linux-x64/bin/esbuild",
    );
    if (!nativeBuilder || (fs.statSync(nativeBuilder.entry).mode & 0o111) === 0) return false;
    const react = resolve("react", path.dirname(filename), "react/jsx-runtime");
    return react?.packageDirectory === path.join(projectRoot, "node_modules", "react");
  } catch {
    return false;
  }
};
