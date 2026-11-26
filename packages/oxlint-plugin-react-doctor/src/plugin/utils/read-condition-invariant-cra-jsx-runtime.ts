import * as path from "node:path";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";

interface CraJsxRuntimeRequest {
  readonly installationRoot: string;
  readonly importerDirectory: string;
  readonly contract: StockPackageContract;
  readonly compilerSelectedReact: StockPhysicalEntry;
}

// Under the already-qualified stock CRA resolver and issuer manifest,
// React's unconditional export has the same physical winner for Node's
// factory check and the generated browser import. Conditional exports or
// package browser remaps need their own Webpack resolution proof.
export const readConditionInvariantCraJsxRuntime = ({
  installationRoot,
  importerDirectory,
  contract,
  compilerSelectedReact,
}: CraJsxRuntimeRequest): StockPhysicalEntry | null => {
  if (contract.packageName !== "react") return null;
  try {
    const request = {
      projectRoot: installationRoot,
      importerDirectory,
      specifier: "react/jsx-runtime",
      contract,
    };
    const issuerSelected = resolveStockPhysicalEntry({ ...request, profile: "node-require" });
    if (!issuerSelected || issuerSelected.entry !== compilerSelectedReact.entry) return null;

    const manifestDigest = contract.files["package.json"];
    if (!manifestDigest) return null;
    const bytes = readProviderMember(
      path.join(issuerSelected.packageDirectory, "package.json"),
      manifestDigest,
    );
    if (!bytes) return null;
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (
      Object.hasOwn(manifest, "browser") ||
      !manifest.exports ||
      manifest.exports["./jsx-runtime"] !== "./jsx-runtime.js"
    )
      return null;
    return issuerSelected.entry === path.join(issuerSelected.packageDirectory, "jsx-runtime.js")
      ? issuerSelected
      : null;
  } catch {
    return null;
  }
};
