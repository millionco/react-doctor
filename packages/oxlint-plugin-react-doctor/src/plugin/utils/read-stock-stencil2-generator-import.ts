import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { isStockPnpmPackageDirectory } from "./read-stock-stencil2-pnpm-providers.js";
import {
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";
import stock from "./stock-stencil2-generator-providers-v2.json" with { type: "json" };

type GeneratorProvider = keyof typeof stock;
const providers = {
  "@stencil/react-output-target/dist/output-react": [
    "@stencil/react-output-target",
    "dist/output-react.js",
    "stencil-react-output-generator",
  ],
  "@stencil/react-output-target/dist/plugin": [
    "@stencil/react-output-target",
    "dist/plugin.js",
    "stencil-react-output-validator",
  ],
  "@stencil/react-output-target/dist/utils": [
    "@stencil/react-output-target",
    "dist/utils.js",
    "stencil-react-output-utils",
  ],
  "@stencil/vue-output-target/dist/output-vue": [
    "@stencil/vue-output-target",
    "dist/output-vue.js",
    "stencil-vue-output-generator",
  ],
  "@stencil/vue-output-target/dist/plugin": [
    "@stencil/vue-output-target",
    "dist/plugin.js",
    "stencil-vue-output-validator",
  ],
  "rollup-plugin-node-externals": [
    "rollup-plugin-node-externals",
    "dist/esm/index.js",
    "rollup-node-externals",
  ],
  sass: ["sass", "sass.node.mjs", "sass"],
} as const;
type GeneratorRole = (typeof providers)[keyof typeof providers][2];
const competingSuffixes = ["", ".tsx", ".ts", ".jsx", ".js", ".css", ".json", ".mjs", ".cjs"];

const exists = (filename: string): boolean => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false }) !== undefined;
};

const resolveProvider = (
  workspaceRoot: string,
  importerDirectory: string,
  name: GeneratorProvider,
  entry: string,
  subpath = false,
): StockPhysicalEntry | null => {
  const contract = stock[name];
  const selected = resolveStockPhysicalEntry({
    projectRoot: workspaceRoot,
    importerDirectory,
    specifier: subpath ? name + "/" + entry : name,
    profile: name === "immutable" ? "node-require" : "esbuild-node-import",
    contract,
  });
  return selected &&
    selected.entry === path.join(selected.packageDirectory, entry) &&
    isStockPnpmPackageDirectory(
      path.join(workspaceRoot, "node_modules", ".pnpm"),
      selected.packageDirectory,
      contract.packageName,
      contract.version,
    )
    ? selected
    : null;
};

const verifyProviderInventory = (
  workspaceRoot: string,
  selected: StockPhysicalEntry,
  contract: StockPackageContract & { readonly contentDigest: string; readonly memberCount: number },
): boolean =>
  verifyStockNpmCompilerPackages(workspaceRoot, {
    packages: [
      {
        directory: path.relative(workspaceRoot, selected.packageDirectory),
        name: contract.packageName,
        version: contract.version,
        entryMembers: contract.files,
        memberCount: contract.memberCount,
        contentDigest: contract.contentDigest,
      },
    ],
    edges: [],
    missing: [],
  });

export const readStockStencil2GeneratorImport = (
  workspaceRoot: string,
  projectDirectory: string,
  issuer: string,
  specifier: string,
  usesProjectBaseUrl: boolean,
): { readonly entry: string; readonly provider: GeneratorRole } | null => {
  if (!isPathInside(issuer, projectDirectory) || !Object.hasOwn(providers, specifier)) return null;
  const [name, member, provider] = providers[specifier as keyof typeof providers];
  try {
    if (
      usesProjectBaseUrl &&
      competingSuffixes.some((suffix) => exists(path.join(projectDirectory, specifier) + suffix))
    )
      return null;
    const selected = resolveProvider(
      workspaceRoot,
      path.dirname(issuer),
      name,
      member,
      specifier !== name,
    );
    if (!selected || !verifyProviderInventory(workspaceRoot, selected, stock[name])) return null;
    if (name === "sass") {
      const immutable = resolveProvider(
        workspaceRoot,
        path.dirname(selected.entry),
        "immutable",
        "dist/immutable.js",
      );
      if (!immutable || !verifyProviderInventory(workspaceRoot, immutable, stock.immutable))
        return null;
    }
    return { entry: selected.entry, provider };
  } catch {
    return null;
  }
};
