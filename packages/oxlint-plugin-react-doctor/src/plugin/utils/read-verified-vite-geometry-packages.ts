import * as fs from "node:fs";
import * as path from "node:path";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";
import {
  resolveStockPhysicalEntry,
  readProviderMember,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import profile from "./geometry-stock-packages.json" with { type: "json" };
import contracts from "./geometry-stock-bindings.json" with { type: "json" };
// JSON array inference represents absent members as optional properties.
const stockProfile = {
  ...profile,
  packages: profile.packages.map(({ entryMembers, ...packageFields }) => ({
    ...packageFields,
    entryMembers: Object.fromEntries(
      Object.entries(entryMembers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  })),
};

interface ObservedSourceIssuer {
  readonly filename: string;
  readonly requests: readonly string[];
}

export const hasVerifiedViteGeometryPackages = (
  root: string,
  observedSourceIssuers: readonly ObservedSourceIssuer[],
): boolean => {
  try {
    if (
      !path.isAbsolute(root) ||
      fs.realpathSync(root) !== root ||
      observedSourceIssuers.length === 0 ||
      !verifyStockNpmCompilerPackages(root, stockProfile)
    )
      return false;

    for (const issuer of observedSourceIssuers) {
      if (
        !path.isAbsolute(issuer.filename) ||
        !issuer.filename.startsWith(root + path.sep) ||
        issuer.filename.includes(path.sep + "node_modules" + path.sep) ||
        !readProviderMember(issuer.filename) ||
        issuer.requests.length === 0
      )
        return false;

      for (const specifier of issuer.requests) {
        const packageName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (!packageName || !Object.hasOwn(contracts, packageName)) return false;
        const contract = contracts[packageName as keyof typeof contracts];
        const selected = resolveStockPhysicalEntry({
          projectRoot: root,
          importerDirectory: path.dirname(issuer.filename),
          specifier,
          profile: "vite-production-import",
          contract,
        });
        if (
          !selected ||
          selected.packageDirectory !== path.join(root, "node_modules", packageName)
        ) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
};
