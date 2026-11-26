import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import stockProfile from "./stock-kkt-compiler-profile.json" with { type: "json" };
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import {
  captureCrossFileProbes,
  isProbeRecorderActive,
  type CapturedCrossFileProbes,
  recordContentProbe,
  replayCrossFileProbes,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { StockNpmWorkspaceLayout } from "./read-stock-npm-workspace-layout.js";
import type { StockKktConfigOperations } from "./read-stock-kkt-config-operations.js";
import { discoverStockNpmWorkspaceLayout } from "./discover-stock-npm-workspace-layout.js";
import { hasBoundedStockCraTsconfig } from "./has-bounded-stock-cra-tsconfig.js";
import { hasStockNodeNpmCompilerEnvironment } from "./has-stock-node-npm-compiler-environment.js";
import { hasVerifiedCraTsxReachability } from "./read-verified-cra-tsx-reachability.js";
import { readSelectedStockKktConfig } from "./read-selected-stock-kkt-config.js";
import { resolveCraBrowserSourceProvider } from "./resolve-cra-browser-source-provider.js";
import {
  resolveVerifiedStockKktCraSuppliers,
  type StockKktCraSuppliers,
} from "./resolve-verified-stock-kkt-cra-suppliers.js";
import type { RuleContext } from "./rule-context.js";
import { readStockKktRawTextImport } from "./read-stock-kkt-raw-text-import.js";
import { readConditionInvariantCraJsxRuntime } from "./read-condition-invariant-cra-jsx-runtime.js";

const probes = {
  existence: recordExistenceProbe,
  realpath: recordRealpathProbe,
  content: recordContentProbe,
};

interface SelectedKktProject {
  readonly operations: StockKktConfigOperations;
  readonly suppliers: StockKktCraSuppliers;
}

const compilerByBuildRoot = new Map<string, CapturedCrossFileProbes<SelectedKktProject | null>>();
let useManagedCompilerCache = false;

export const resetStockKktCompilerCache = (): void => {
  compilerByBuildRoot.clear();
  useManagedCompilerCache = true;
};

const hasEmptyCompilerCache = (
  installationRoot: string,
  layout: StockNpmWorkspaceLayout,
): boolean => {
  return layout.moduleRoots.every((moduleRoot) => {
    const cache = path.join(installationRoot, moduleRoot, ".cache");
    recordExistenceProbe(cache);
    return !fs.lstatSync(cache, { throwIfNoEntry: false });
  });
};

const readStockKktProject = (
  installationRoot: string,
  buildRoot: string,
): SelectedKktProject | null => {
  if (!hasBoundedStockCraTsconfig(buildRoot, installationRoot)) return null;
  const operations = readSelectedStockKktConfig(buildRoot);
  if (!operations) return null;
  const layout = discoverStockNpmWorkspaceLayout(installationRoot, buildRoot);
  if (!layout || !hasEmptyCompilerCache(installationRoot, layout)) return null;
  const suppliers = resolveVerifiedStockKktCraSuppliers({
    installationRoot,
    buildRoot,
    profile: { ...stockProfile, snapshot: { ...stockProfile.snapshot, layout } },
  });
  return suppliers &&
    operations.pluginOrder.every(({ source }) => suppliers.configSuppliers.has(source))
    ? { operations, suppliers }
    : null;
};

const readManagedStockKktProject = (
  installationRoot: string,
  buildRoot: string,
): SelectedKktProject | null => {
  if (!useManagedCompilerCache) return readStockKktProject(installationRoot, buildRoot);
  const cached = compilerByBuildRoot.get(buildRoot);
  if (cached) {
    if (isProbeRecorderActive()) replayCrossFileProbes(cached.trace);
    return cached.value;
  }
  const captured = captureCrossFileProbes(() => readStockKktProject(installationRoot, buildRoot));
  compilerByBuildRoot.set(buildRoot, captured);
  return captured.value;
};

const hasNoJitiConfigCache = (buildRoot: string): boolean => {
  const temporaryDirectory = tmpdir();
  if (!path.isAbsolute(temporaryDirectory) || path.resolve(temporaryDirectory) === buildRoot) {
    return false;
  }
  const cache = path.join(temporaryDirectory, "node-jiti");
  recordExistenceProbe(cache);
  return !fs.lstatSync(cache, { throwIfNoEntry: false });
};

export const hasAutomaticStockKktJsx = (context: RuleContext): boolean => {
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const reportedFilename = context.filename;
  if (!rootDirectory || !path.isAbsolute(rootDirectory) || !reportedFilename?.endsWith(".tsx"))
    return false;
  const buildRoot = path.resolve(rootDirectory);
  const installationRoot = path.dirname(buildRoot);
  const filename = path.resolve(buildRoot, reportedFilename);
  try {
    if (
      process.env.DISABLE_NEW_JSX_TRANSFORM ||
      process.env.GENERATE_SOURCEMAP ||
      Object.entries(process.env).some(
        ([name, value]) => value && /^(?:JITI_|BROWSERSLIST(?:_|$))/u.test(name),
      ) ||
      !hasNoJitiConfigCache(buildRoot) ||
      !hasStockNodeNpmCompilerEnvironment(buildRoot)
    )
      return false;
    const project = readManagedStockKktProject(installationRoot, buildRoot);
    if (!project) return false;
    const { operations, suppliers } = project;
    const emittedRuntime = readConditionInvariantCraJsxRuntime({
      installationRoot,
      importerDirectory: path.dirname(filename),
      contract: stockProfile.react,
      compilerSelectedReact: suppliers.reactJsxRuntime,
    });
    if (emittedRuntime?.entry !== suppliers.reactJsxRuntime.entry) return false;
    return hasVerifiedCraTsxReachability({
      appSrc: path.join(buildRoot, "src"),
      filename,
      context,
      provesExternalRuntimeSource: (specifier, issuer) => {
        if (
          readStockKktRawTextImport({
            installationRoot,
            importerDirectory: path.dirname(issuer),
            specifier,
            rawSuffix: operations.rawSuffix,
          })
        )
          return true;
        return (
          resolveCraBrowserSourceProvider({ installationRoot, issuer, specifier, probes }) !== null
        );
      },
    });
  } catch {
    return false;
  }
};
