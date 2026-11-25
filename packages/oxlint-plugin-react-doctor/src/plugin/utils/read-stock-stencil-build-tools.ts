import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { isStockPnpmPackageDirectory } from "./read-stock-stencil2-pnpm-providers.js";
import { readsVerifiedPackageLauncher } from "./stock-vite-providers/reads-verified-package-launcher.js";
import { resolveStockPhysicalPackageDirectory } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import {
  verifyStockNpmCompilerPackages,
  type StockNpmCompilerPackage,
} from "./verify-stock-npm-compiler-packages.js";
import stock from "./stock-generated-stencil-build-tools.json" with { type: "json" };

interface StockBuildToolsInput {
  readonly workspaceRoot: string;
  readonly projectDirectory: string;
  readonly createsLibraryDirectory: boolean;
}
interface BuildToolPackage {
  readonly name: string;
  readonly version: string;
  readonly memberCount: number;
  readonly contentDigest: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

const packages: Readonly<Record<string, BuildToolPackage>> = stock;
const npmRunAllCommands = {
  "run-p": "bin/run-p/index.js",
  "run-s": "bin/run-s/index.js",
};
const crossEnvCommands = { "cross-env": "src/bin/cross-env.js" };
const mkdirpCommands = { mkdirp: "bin/cmd.js" };

const selectedCommandDirectory = (
  projectDirectory: string,
  workspaceRoot: string,
  name: string,
): string | null => {
  for (const directory of [projectDirectory, workspaceRoot]) {
    const command = path.join(directory, "node_modules", ".bin", name);
    recordExistenceProbe(command);
    if (fs.lstatSync(command, { throwIfNoEntry: false })) return directory;
  }
  return null;
};

export const readStockStencilBuildTools = ({
  workspaceRoot,
  projectDirectory,
  createsLibraryDirectory,
}: StockBuildToolsInput): {
  readonly selectedCommands: Readonly<Record<string, string>>;
} | null => {
  if (
    !isPathInside(projectDirectory, workspaceRoot) ||
    path.relative(workspaceRoot, projectDirectory).split(path.sep).includes("node_modules")
  )
    return null;
  const virtualStore = path.join(workspaceRoot, "node_modules", ".pnpm");
  const inventories = new Map<string, StockNpmCompilerPackage>();
  const selectPackage = (issuer: string, locator: string): string | null => {
    const profile = packages[locator];
    if (!profile) return null;
    const directory = resolveStockPhysicalPackageDirectory(workspaceRoot, issuer, profile.name);
    if (
      !directory ||
      !isStockPnpmPackageDirectory(virtualStore, directory, profile.name, profile.version)
    )
      return null;
    const alreadySelected = inventories.get(directory);
    if (alreadySelected) return alreadySelected.version === profile.version ? directory : null;
    inventories.set(directory, {
      directory: path.relative(workspaceRoot, directory),
      name: profile.name,
      version: profile.version,
      memberCount: profile.memberCount,
      contentDigest: profile.contentDigest,
      entryMembers: {},
      allowPnpmGeneratedBinDirectory: true,
    });
    for (const dependency of Object.values(profile.dependencies)) {
      if (!selectPackage(directory, dependency)) return null;
    }
    return directory;
  };
  const selectedCommands: Record<string, string> = {};
  const bindCommands = (locator: string, commands: Readonly<Record<string, string>>): boolean => {
    const packageDirectory = selectPackage(projectDirectory, locator);
    const profile = packages[locator];
    if (!packageDirectory || !profile) return false;
    for (const [binary, member] of Object.entries(commands)) {
      const commandDirectory = selectedCommandDirectory(projectDirectory, workspaceRoot, binary);
      const entry = path.join(packageDirectory, member);
      if (
        !commandDirectory ||
        !readsVerifiedPackageLauncher({
          projectRoot: workspaceRoot,
          projectDirectory: commandDirectory,
          packageDirectory,
          binary,
          pnpm: { packageName: profile.name, entry, virtualStore },
        })
      )
        return false;
      selectedCommands[binary] = entry;
    }
    return true;
  };

  try {
    if (
      selectedCommandDirectory(projectDirectory, workspaceRoot, "node") ||
      !bindCommands("npm-run-all@4.1.5", npmRunAllCommands) ||
      !bindCommands("cross-env@7.0.3", crossEnvCommands) ||
      (createsLibraryDirectory && !bindCommands("mkdirp@1.0.4", mkdirpCommands)) ||
      !verifyStockNpmCompilerPackages(workspaceRoot, {
        packages: [...inventories.values()],
        edges: [],
        missing: [],
      })
    )
      return null;
    return { selectedCommands };
  } catch {
    return null;
  }
};
