import { lstatSync } from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "../cross-file-probe-recorder.js";
import {
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
} from "./resolve-stock-physical-entry.js";
import { STOCK_REACTDOM18_BROWSER_MODULE } from "./stock-react18-browser-provider.js";

export const STOCK_SCHEDULER23_BROWSER_MODULE = {
  packageName: "scheduler",
  version: "0.23.2",
  files: {
    "package.json": "0893643a24576d727174e639586b8833a53f2a7b4a2199a719b9cfcebe9bae88",
    "index.js": "b413b3aac7bd209fd82cbe2241fda1467558daaef830744f45ed8396fac9185e",
    "cjs/scheduler.production.min.js":
      "f6cb8cf42696980c702f6b879417ab8bd489660485eb012b46f67e92e18a78ee",
  },
} satisfies StockPackageContract;

const hasLocalPackageScope = (directory: string): boolean => {
  const manifest = path.join(directory, "package.json");
  recordExistenceProbe(manifest);
  return lstatSync(manifest, { throwIfNoEntry: false }) !== undefined;
};

// The caller owns the stock Vite/browser production profile, including the
// CommonJS transform and production NODE_ENV branch selection.
export const readStockReact18BrowserScheduler = (
  projectRoot: string,
  renderer: StockPhysicalEntry,
): (StockPhysicalEntry & { readonly productionMember: string }) | null => {
  try {
    const client = resolveStockPhysicalEntry({
      projectRoot,
      importerDirectory: path.dirname(renderer.entry),
      specifier: "react-dom/client",
      profile: "vite-production-require",
      contract: STOCK_REACTDOM18_BROWSER_MODULE,
    });
    if (client?.packageDirectory !== renderer.packageDirectory || client?.entry !== renderer.entry)
      return null;

    // Stock ReactDOM index.js -> cjs/react-dom.production.min.js -> require("scheduler").
    const issuer = path.join(renderer.packageDirectory, "cjs");
    if (hasLocalPackageScope(issuer)) return null;
    const scheduler = resolveStockPhysicalEntry({
      projectRoot,
      importerDirectory: issuer,
      specifier: "scheduler",
      profile: "vite-production-require",
      contract: STOCK_SCHEDULER23_BROWSER_MODULE,
    });
    if (!scheduler || hasLocalPackageScope(path.join(scheduler.packageDirectory, "cjs")))
      return null;
    return {
      ...scheduler,
      productionMember: path.join(scheduler.packageDirectory, "cjs/scheduler.production.min.js"),
    };
  } catch {
    return null;
  }
};
