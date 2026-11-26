import * as path from "node:path";
import * as fs from "node:fs";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { resolveStockPhysicalEntry } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import {
  verifyStockNpmCompilerPackages,
  type StockNpmCompilerProfile,
} from "./verify-stock-npm-compiler-packages.js";
/** Internal authenticated-profile seam; never accept a profile from user settings. */
export function readVerifiedVite5ReactTailwindProviders(
  workspace: string,
  configDirectory: string,
  profile: StockNpmCompilerProfile,
): ReadonlyMap<string, string> | null {
  const versions = new Map([
    ["vite", "5.4.21"],
    ["@vitejs/plugin-react", "4.7.0"],
    ["@tailwindcss/vite", "4.2.2"],
    ["tailwindcss", "4.2.2"],
    ["esbuild", "0.21.5"],
    ["rollup", "4.60.1"],
    ["react", "18.3.1"],
    ["react-dom", "18.3.1"],
  ]);
  const result = new Map<string, string>();
  try {
    if (
      !path.isAbsolute(workspace) ||
      !path.isAbsolute(configDirectory) ||
      (configDirectory !== workspace && !configDirectory.startsWith(workspace + path.sep)) ||
      !verifyStockNpmCompilerPackages(workspace, profile)
    )
      return null;
    for (const [name, version] of versions) {
      const selected = profile.packages.filter((p) => p.name === name && p.version === version);
      if (selected.length !== 1) return null;
      const p = selected[0]!;
      let found = false;
      for (let directory = configDirectory; ; directory = path.dirname(directory)) {
        if (path.basename(directory) !== "node_modules") {
          const candidate = path.join(directory, "node_modules", name);
          for (const ext of [".js", ".json", ".node"]) {
            recordExistenceProbe(candidate + ext);
            if (fs.lstatSync(candidate + ext, { throwIfNoEntry: false })) return null;
          }
          recordExistenceProbe(candidate);
          const info = fs.lstatSync(candidate, { throwIfNoEntry: false });
          if (info) {
            if (
              !info.isDirectory() ||
              info.isSymbolicLink() ||
              candidate !== path.join(workspace, p.directory)
            )
              return null;
            found = true;
            break;
          }
        }
        if (directory === workspace || path.dirname(directory) === directory) break;
      }
      if (!found) return null;
      const entry = resolveStockPhysicalEntry({
        projectRoot: workspace,
        importerDirectory: configDirectory,
        specifier: name,
        profile: "node-import",
        contract: { packageName: name, version, files: p.entryMembers },
      });
      if (!entry || entry.packageDirectory !== path.join(workspace, p.directory)) return null;
      result.set(name, entry.entry);
    }
    return result;
  } catch {
    return null;
  }
}
