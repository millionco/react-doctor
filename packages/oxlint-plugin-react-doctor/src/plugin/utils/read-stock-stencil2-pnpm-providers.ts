import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { readsVerifiedPackageLauncher } from "./stock-vite-providers/reads-verified-package-launcher.js";
import {
  resolveStockPhysicalEntry,
  type StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";
import stock from "./stock-stencil2-pnpm-providers.json" with { type: "json" };

interface SelectedStencil2Providers {
  readonly workspaceRoot: string;
  readonly projectDirectory: string;
  readonly subjectDirectory: string;
}

type Providers = typeof stock;

export const isStockPnpmPackageDirectory = (
  virtualStore: string,
  packageDirectory: string,
  packageName: string,
  version: string,
): boolean => {
  const relative = path.relative(virtualStore, packageDirectory).split(path.sep);
  const locator = relative[0];
  const prefix = packageName.replace("/", "+") + "@" + version;
  return Boolean(
    locator &&
    (locator === prefix || locator.startsWith(prefix + "_")) &&
    relative[1] === "node_modules" &&
    relative.slice(2).join("/") === packageName,
  );
};

const fileExists = (file: string): boolean => {
  recordExistenceProbe(file);
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
};

export const readStockStencil2PnpmProviders = ({
  workspaceRoot,
  projectDirectory,
  subjectDirectory,
}: SelectedStencil2Providers): {
  readonly stencilDirectory: string;
  readonly nativeCss: string;
  readonly lightningCssEntry: string;
} | null => {
  const root = workspaceRoot;
  if (
    !path.isAbsolute(root) ||
    !path.isAbsolute(projectDirectory) ||
    !path.isAbsolute(subjectDirectory)
  )
    return null;
  const virtualStore = path.join(root, "node_modules", ".pnpm");
  const resolve = (
    name: keyof Providers,
    issuer: string,
    specifier = stock[name].packageName,
  ): StockPhysicalEntry | null => {
    const selected = resolveStockPhysicalEntry({
      projectRoot: root,
      importerDirectory: issuer,
      specifier,
      profile: "node-require",
      contract: stock[name],
    });
    return selected &&
      isStockPnpmPackageDirectory(
        virtualStore,
        selected.packageDirectory,
        stock[name].packageName,
        stock[name].version,
      )
      ? selected
      : null;
  };
  try {
    const stencil = resolve("stencil", projectDirectory, "@stencil/core/package.json");
    const source = resolve("stencil", subjectDirectory);
    if (!stencil || !source || stencil.packageDirectory !== source.packageDirectory) return null;
    if (
      !readsVerifiedPackageLauncher({
        projectRoot: root,
        projectDirectory,
        packageDirectory: stencil.packageDirectory,
        binary: "stencil",
        pnpm: {
          packageName: stock.stencil.packageName,
          entry: path.join(stencil.packageDirectory, "bin", "stencil"),
          virtualStore,
        },
      })
    )
      return null;

    const css = resolve("lightningCss", projectDirectory);
    if (!css) return null;
    const cssIssuer = path.dirname(css.entry);
    const libc = resolve("detectLibc", cssIssuer);
    const native = resolve("lightningCssNative", cssIssuer);
    if (
      !libc ||
      !native ||
      ["pkg", "pkg.js", "lightningcss.linux-x64-gnu.node"].some((member) =>
        fileExists(path.join(css.packageDirectory, member)),
      )
    )
      return null;

    const packageInventory = (resolved: StockPhysicalEntry, name: keyof Providers) => ({
      directory: path.relative(root, resolved.packageDirectory),
      name: stock[name].packageName,
      version: stock[name].version,
      memberCount: stock[name].memberCount,
      contentDigest: stock[name].contentDigest,
      entryMembers: stock[name].files,
    });
    if (
      !verifyStockNpmCompilerPackages(root, {
        packages: [
          packageInventory(stencil, "stencil"),
          packageInventory(css, "lightningCss"),
          packageInventory(libc, "detectLibc"),
          packageInventory(native, "lightningCssNative"),
        ],
        edges: [],
        missing: [],
      })
    )
      return null;
    return {
      stencilDirectory: stencil.packageDirectory,
      nativeCss: native.entry,
      lightningCssEntry: css.entry,
    };
  } catch {
    return null;
  }
};
