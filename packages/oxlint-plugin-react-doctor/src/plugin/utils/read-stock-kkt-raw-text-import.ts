import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

interface StockKktRawTextImport {
  readonly installationRoot: string;
  readonly importerDirectory: string;
  readonly specifier: string;
  readonly rawSuffix: string;
}

const RAW_TEXT_REQUEST =
  /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)\/((?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*[.]txt)$/u;

const physicalDirectory = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};

// The caller qualifies the stock CRA resolver and the exact KKT raw-loader
// operation. A matched .txt import in that route contributes data only.
export const readStockKktRawTextImport = ({
  installationRoot,
  importerDirectory,
  specifier,
  rawSuffix,
}: StockKktRawTextImport): string | null => {
  const request = RAW_TEXT_REQUEST.exec(specifier);
  if (
    rawSuffix !== ".txt" ||
    !request ||
    !path.isAbsolute(installationRoot) ||
    !path.isAbsolute(importerDirectory) ||
    !isPathInside(importerDirectory, installationRoot)
  )
    return null;
  const [, packageName, member] = request;
  if (packageName === "node_modules" || member.split("/").includes("node_modules")) return null;

  try {
    if (!physicalDirectory(installationRoot) || !physicalDirectory(importerDirectory)) return null;
    for (
      let directory = importerDirectory;
      isPathInside(directory, installationRoot);
      directory = path.dirname(directory)
    ) {
      const packageDirectory = path.join(directory, "node_modules", packageName);
      recordExistenceProbe(packageDirectory);
      const candidate = fs.lstatSync(packageDirectory, { throwIfNoEntry: false });
      if (candidate) {
        if (!candidate.isDirectory() || !physicalDirectory(packageDirectory)) return null;
        const manifest = readProviderMember(path.join(packageDirectory, "package.json"));
        if (!manifest || manifest.length > 64 * 1024) return null;
        const info = JSON.parse(manifest.toString("utf8"));
        if (
          info.name !== packageName ||
          Object.hasOwn(info, "browser") ||
          Object.hasOwn(info, "exports")
        ) {
          return null;
        }
        const filename = path.join(packageDirectory, member);
        return readProviderMember(filename) ? filename : null;
      }
      if (directory === installationRoot) break;
    }
    return null;
  } catch {
    return null;
  }
};
