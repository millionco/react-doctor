import { createRequire } from "node:module";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { hasStockNodeNpmCompilerEnvironment } from "./has-stock-node-npm-compiler-environment.js";
import { isStockPnpmPackageDirectory } from "./read-stock-stencil2-pnpm-providers.js";
import { readsVerifiedPackageLauncher } from "./stock-vite-providers/reads-verified-package-launcher.js";
import {
  readProviderMember,
  resolveStockPhysicalPackageDirectory,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";
import catalogue from "./stock-generated-stencil-launchers.json" with { type: "json" };

const esbuildRelease = "0.21.5";
const nativeEsbuildDigest = "b567f467fdac92c606717c86ea5cd1d6c30145c616776c0f2ff5429ad48586ba";
const javascriptEsbuildDigest = "9ce5381d8403ef3e2738e32d1dcf9728d65a0b9e76c242110419d86dc034d62c";
const stockEnvironmentConfigAllowlist = new Set(["npm_config_user_agent"]);
const environmentOverrides =
  /^(?:npm_config_|pnpm_|corepack_|ld_|css_transformer_wasm$|esbuild_|node_extra_ca_certs$|node_tls_reject_unauthorized$|destdir$|prefix$|bash_env$|env$|ifs$|cdpath$)/iu;

const lstat = (file: string): fs.Stats | undefined => {
  recordExistenceProbe(file);
  return fs.lstatSync(file, { throwIfNoEntry: false });
};

const canonicalPath = (file: string): string => {
  recordRealpathProbe(file);
  return fs.realpathSync(file);
};

const isAbsentOrEmpty = (filename: string): boolean => {
  if (!path.isAbsolute(filename)) return false;
  const info = lstat(filename);
  return !info || (info.isFile() && info.size === 0 && canonicalPath(filename) === filename);
};

const resolveWorkspaceRoot = (projectDirectory: string): string | null | undefined => {
  for (let directory = projectDirectory; ; directory = path.dirname(directory)) {
    if (lstat(path.join(directory, "pnpm-workspace.yml"))) return undefined;
    const manifest = path.join(directory, "pnpm-workspace.yaml");
    const entry = lstat(manifest);
    if (entry)
      return entry.isFile() && canonicalPath(manifest) === manifest ? directory : undefined;
    if (directory === path.dirname(directory)) return null;
  }
};

const firstCommand = (directories: readonly string[], name: string): string | null => {
  for (const directory of directories) {
    const command = path.join(directory, name);
    if (lstat(command)) return command;
  }
  return null;
};

const hasDefaultPnpmBuildPolicy = (
  pnpmRoot: string,
  projectDirectory: string,
  workspaceDirectory: string | null,
): boolean => {
  if (
    Object.entries(process.env).some(
      ([name, value]) =>
        value &&
        environmentOverrides.test(name) &&
        !stockEnvironmentConfigAllowlist.has(name.toLowerCase()),
    )
  )
    return false;
  const userHome = homedir();
  const configHome = process.env.XDG_CONFIG_HOME || path.join(userHome, ".config");
  if (!path.isAbsolute(userHome) || !path.isAbsolute(configHome)) return false;
  const user = path.join(userHome, ".npmrc");
  const project = path.join(projectDirectory, ".npmrc");
  const workspace = workspaceDirectory ? path.join(workspaceDirectory, ".npmrc") : project;
  const global = path.resolve(process.execPath, "../../etc/npmrc");
  const pnpmConfig = path.join(configHome, "pnpm", "rc");
  // npm-conf asks Node for npm's builtin file through the last global
  // resolution root. Resolving the entry does not load or evaluate npm.
  const resolveFromPnpm = createRequire(path.join(pnpmRoot, "dist", "pnpm.cjs")).resolve;
  const searchDirectories = resolveFromPnpm.paths("npm");
  if (!searchDirectories?.length) return false;
  let npmBuiltin: string | null = null;
  try {
    const npmEntry = resolveFromPnpm("npm", { paths: searchDirectories.slice(-1) });
    npmBuiltin = path.resolve(path.dirname(npmEntry), "../npmrc");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "MODULE_NOT_FOUND")
      return false;
  }
  return [user, project, workspace, global, pnpmConfig, ...(npmBuiltin ? [npmBuiltin] : [])].every(
    isAbsentOrEmpty,
  );
};

const executable = (filename: string): boolean => {
  const info = lstat(filename);
  return Boolean(info?.isFile() && info.mode & 0o111);
};

export const hasStockGeneratedStencilGeneratorLaunch = (
  workspaceRoot: string,
  projectDirectory: string,
): boolean => {
  try {
    if (!hasStockNodeNpmCompilerEnvironment(projectDirectory)) return false;
    const workspaceDirectory = resolveWorkspaceRoot(projectDirectory);
    if (
      workspaceDirectory === undefined ||
      (workspaceDirectory ?? projectDirectory) !== workspaceRoot
    )
      return false;
    const pathDirectories = process.env.PATH?.split(path.delimiter);
    if (!pathDirectories?.length || pathDirectories.some((entry) => !path.isAbsolute(entry)))
      return false;
    const projectBins = path.join(projectDirectory, "node_modules", ".bin");
    const workspaceBins = path.join(workspaceRoot, "node_modules", ".bin");
    const search = [projectBins, workspaceBins, ...pathDirectories];
    const pnpm = firstCommand(search, "pnpm");
    if (!pnpm) return false;
    const pnpmEntry = canonicalPath(pnpm);
    const pnpmRoot = path.dirname(path.dirname(pnpmEntry));
    if (pnpmEntry !== path.join(pnpmRoot, "bin", "pnpm.cjs") || !executable(pnpmEntry))
      return false;
    const activePnpm = process.env.npm_execpath;
    if (activePnpm && (!path.isAbsolute(activePnpm) || canonicalPath(activePnpm) !== pnpmEntry))
      return false;
    const nodeGyp = path.join(pnpmRoot, "dist", "node-gyp-bin");
    const effectiveSearch = [projectBins, nodeGyp, workspaceBins, ...pathDirectories];
    for (const command of ["dirname", "sed", "uname"]) {
      const selected = firstCommand(effectiveSearch, command);
      if (!selected || canonicalPath(selected) !== canonicalPath(path.join("/usr/bin", command)))
        return false;
    }
    if (
      !verifyStockNpmCompilerPackages(pnpmRoot, {
        packages: [{ ...catalogue.pnpm, directory: "" }],
        edges: [],
        missing: [],
      }) ||
      !hasDefaultPnpmBuildPolicy(pnpmRoot, projectDirectory, workspaceDirectory)
    )
      return false;

    const virtualStore = path.join(workspaceRoot, "node_modules", ".pnpm");
    const esbuild = resolveStockPhysicalPackageDirectory(
      workspaceRoot,
      projectDirectory,
      "esbuild",
    );
    if (!esbuild || !isStockPnpmPackageDirectory(virtualStore, esbuild, "esbuild", esbuildRelease))
      return false;
    const native = resolveStockPhysicalPackageDirectory(
      workspaceRoot,
      path.join(esbuild, "lib"),
      "@esbuild/linux-x64",
    );
    if (
      !native ||
      !isStockPnpmPackageDirectory(virtualStore, native, "@esbuild/linux-x64", esbuildRelease)
    )
      return false;
    const entry = path.join(esbuild, "bin", "esbuild");
    if (!executable(entry) || !executable(path.join(native, "bin", "esbuild"))) return false;
    const optimized = Boolean(readProviderMember(entry, nativeEsbuildDigest));
    if (!optimized && !readProviderMember(entry, javascriptEsbuildDigest)) return false;
    if (
      !verifyStockNpmCompilerPackages(workspaceRoot, {
        packages: [
          {
            ...catalogue.esbuild,
            directory: path.relative(workspaceRoot, esbuild),
            allowPnpmGeneratedBinDirectory: true,
          },
          { ...catalogue.esbuildNative, directory: path.relative(workspaceRoot, native) },
        ],
        edges: [],
        missing: [],
      })
    )
      return false;
    const command = firstCommand(effectiveSearch, "esbuild");
    const commandRoot =
      command === path.join(projectBins, "esbuild")
        ? projectDirectory
        : command === path.join(workspaceBins, "esbuild")
          ? workspaceRoot
          : null;
    return (
      commandRoot !== null &&
      readsVerifiedPackageLauncher({
        projectRoot: workspaceRoot,
        projectDirectory: commandRoot,
        packageDirectory: esbuild,
        binary: "esbuild",
        pnpm: { packageName: "esbuild", entry, virtualStore, native: optimized },
      })
    );
  } catch {
    return false;
  }
};
