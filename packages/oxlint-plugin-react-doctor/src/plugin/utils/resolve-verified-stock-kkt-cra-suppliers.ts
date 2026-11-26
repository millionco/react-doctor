import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { hasExpectedNpmLauncher } from "./has-stock-node-npm-compiler-environment.js";
import { isPathInside } from "./is-path-inside.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import {
  verifyStockNpmCompilerSnapshot,
  type StockNpmCompilerSnapshot,
} from "./verify-stock-npm-compiler-snapshot.js";

export interface StockKktCraProfile {
  readonly snapshot: StockNpmCompilerSnapshot;
  readonly kkt: StockPackageContract;
  readonly reactScripts: StockPackageContract;
  readonly reactDevUtils: StockPackageContract;
  readonly autoConfigLoader: StockPackageContract;
  readonly babelPresetReactApp: StockPackageContract;
  readonly babelPresetReact: StockPackageContract;
  readonly react: StockPackageContract;
  readonly configSuppliers: readonly StockPackageContract[];
}

export interface StockKktCraRequest {
  readonly installationRoot: string;
  readonly buildRoot: string;
  readonly profile: StockKktCraProfile;
}

export interface StockKktCraSuppliers {
  readonly kkt: StockPhysicalEntry;
  readonly reactScripts: StockPhysicalEntry;
  readonly reactDevUtils: StockPhysicalEntry;
  readonly autoConfigLoader: StockPhysicalEntry;
  readonly babelPresetReactApp: StockPhysicalEntry;
  readonly babelPresetReact: StockPhysicalEntry;
  readonly reactJsxRuntime: StockPhysicalEntry;
  readonly configSuppliers: ReadonlyMap<string, StockPhysicalEntry>;
}

const KKT_BIN = "lib/bin/kkt.js";
const KKT_PATH_ISSUER = "lib/utils/path.js";
const CRA_WEBPACK_CONFIG = "config/webpack.config.js";

const hasMembers = (contract: StockPackageContract, members: readonly string[]): boolean =>
  members.every((filename) => Object.hasOwn(contract.files, filename));

const readBuildScript = (buildRoot: string): boolean => {
  const bytes = readProviderMember(path.join(buildRoot, "package.json"));
  if (!bytes || bytes.length > 64 * 1024) return false;
  const scripts = (JSON.parse(bytes.toString("utf8")) as { scripts?: unknown }).scripts;
  return (
    typeof scripts === "object" &&
    scripts !== null &&
    !Array.isArray(scripts) &&
    (scripts as Record<string, unknown>).build === "kkt build" &&
    !Object.hasOwn(scripts, "prebuild") &&
    !Object.hasOwn(scripts, "postbuild")
  );
};

const isPhysicalDirectory = (directory: string): boolean => {
  recordExistenceProbe(directory);
  recordRealpathProbe(directory);
  return (
    fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true &&
    fs.realpathSync(directory) === directory
  );
};

const hasVerifiedInstallationDirectories = (
  installationRoot: string,
  buildRoot: string,
  snapshot: StockNpmCompilerSnapshot,
): boolean => {
  if (!isPhysicalDirectory(installationRoot) || !isPhysicalDirectory(buildRoot)) return false;
  for (
    let directory = buildRoot;
    directory !== installationRoot;
    directory = path.dirname(directory)
  ) {
    const localModules = path.join(directory, "node_modules");
    recordExistenceProbe(localModules);
    if (fs.lstatSync(localModules, { throwIfNoEntry: false })) {
      if (!snapshot.layout?.moduleRoots.includes(path.relative(installationRoot, localModules)))
        return false;
      const nearerLauncher = path.join(localModules, ".bin", "kkt");
      recordExistenceProbe(nearerLauncher);
      if (fs.lstatSync(nearerLauncher, { throwIfNoEntry: false })) return false;
    }
  }
  return true;
};

// The caller supplies a trusted installation snapshot and independently
// qualifies npm/Node launch environment, the config callback, and Webpack's
// selected browser source graph. This function models only the Node suppliers.
export const resolveVerifiedStockKktCraSuppliers = ({
  installationRoot,
  buildRoot,
  profile,
}: StockKktCraRequest): StockKktCraSuppliers | null => {
  if (
    !path.isAbsolute(installationRoot) ||
    !path.isAbsolute(buildRoot) ||
    path.resolve(installationRoot) !== installationRoot ||
    path.resolve(buildRoot) !== buildRoot ||
    !isPathInside(buildRoot, installationRoot) ||
    path.relative(installationRoot, buildRoot).split(path.sep).includes("node_modules") ||
    (profile.kkt.version !== "7.5.4" && profile.kkt.version !== "7.5.5") ||
    profile.reactScripts.version !== "5.0.1" ||
    !hasMembers(profile.kkt, [
      KKT_BIN,
      "lib/scripts/build.js",
      KKT_PATH_ISSUER,
      "lib/utils/conf.js",
    ]) ||
    !hasMembers(profile.reactScripts, [
      CRA_WEBPACK_CONFIG,
      "config/paths.js",
      "scripts/build.js",
    ]) ||
    !hasMembers(profile.babelPresetReactApp, ["create.js"])
  )
    return null;

  const resolve = (
    importerDirectory: string,
    contract: StockPackageContract,
    specifier = contract.packageName,
  ): StockPhysicalEntry | null =>
    resolveStockPhysicalEntry({
      projectRoot: installationRoot,
      importerDirectory,
      specifier,
      profile: "node-require",
      contract,
    });

  try {
    if (
      !hasVerifiedInstallationDirectories(installationRoot, buildRoot, profile.snapshot) ||
      !readBuildScript(buildRoot)
    )
      return null;
    const kkt = resolve(buildRoot, profile.kkt, `kkt/${KKT_BIN}`);
    if (!kkt || kkt.packageDirectory !== path.join(installationRoot, "node_modules", "kkt"))
      return null;
    const launcher = path.join(installationRoot, "node_modules", ".bin", "kkt");
    recordExistenceProbe(launcher);
    recordRealpathProbe(launcher);
    recordExistenceProbe(kkt.entry);
    recordRealpathProbe(kkt.entry);
    if (!hasExpectedNpmLauncher(launcher, `../kkt/${KKT_BIN}`)) return null;

    const kktIssuer = path.dirname(path.join(kkt.packageDirectory, KKT_PATH_ISSUER));
    const reactScripts = resolve(kktIssuer, profile.reactScripts, "react-scripts/package.json");
    const reactDevUtils = resolve(kktIssuer, profile.reactDevUtils, "react-dev-utils/package.json");
    const autoConfigLoader = resolve(kktIssuer, profile.autoConfigLoader, "auto-config-loader");
    if (!reactScripts || !reactDevUtils || !autoConfigLoader) return null;

    const craIssuer = path.dirname(path.join(reactScripts.packageDirectory, CRA_WEBPACK_CONFIG));
    const babelPresetReactApp = resolve(
      craIssuer,
      profile.babelPresetReactApp,
      "babel-preset-react-app",
    );
    const reactJsxRuntime = resolve(craIssuer, profile.react, "react/jsx-runtime");
    const projectReactJsxRuntime = resolve(buildRoot, profile.react, "react/jsx-runtime");
    if (
      !babelPresetReactApp ||
      !reactJsxRuntime ||
      projectReactJsxRuntime?.entry !== reactJsxRuntime.entry
    )
      return null;
    const reactAppPresetIssuer = path.dirname(
      path.join(babelPresetReactApp.packageDirectory, "create.js"),
    );
    const babelPresetReact = resolve(
      reactAppPresetIssuer,
      profile.babelPresetReact,
      "@babel/preset-react",
    );
    if (!babelPresetReact) return null;

    const configSuppliers = new Map<string, StockPhysicalEntry>();
    for (const contract of profile.configSuppliers) {
      const resolved = resolve(buildRoot, contract);
      if (!resolved || configSuppliers.has(contract.packageName)) return null;
      if (contract.packageName === "webpack") {
        const compilerWebpack = resolve(craIssuer, contract);
        const buildScriptIssuer = path.join(reactScripts.packageDirectory, "scripts");
        const buildScriptWebpack = resolve(buildScriptIssuer, contract);
        if (
          compilerWebpack?.entry !== resolved.entry ||
          buildScriptWebpack?.entry !== resolved.entry
        )
          return null;
      }
      configSuppliers.set(contract.packageName, resolved);
    }
    if (
      !configSuppliers.has("webpack") ||
      !verifyStockNpmCompilerSnapshot(installationRoot, profile.snapshot)
    )
      return null;
    return {
      kkt,
      reactScripts,
      reactDevUtils,
      autoConfigLoader,
      babelPresetReactApp,
      babelPresetReact,
      reactJsxRuntime,
      configSuppliers,
    };
  } catch {
    return null;
  }
};
