import * as path from "node:path";
import {
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
} from "./resolve-stock-physical-entry.js";

export const STOCK_REACT18_BROWSER_MODULE = {
  packageName: "react",
  version: "18.3.1",
  files: {
    "package.json": "d4e68a5c96babb20cad1daafea8b78822eae45b341552cf5418d06a5304fa64c",
    "index.js": "a216c390bf956cbb906c66d29fdb2e2ad6999464a5ca83e476533a6f25ad0ef3",
    "cjs/react.production.min.js":
      "4b35e378f469c4f492c7514bb106b5833746dbbae80496bd4aa9acc6e9ac4b42",
  },
} satisfies StockPackageContract;

export const STOCK_REACT18_BROWSER_JSX = {
  packageName: "react",
  version: "18.3.1",
  files: {
    "package.json": "d4e68a5c96babb20cad1daafea8b78822eae45b341552cf5418d06a5304fa64c",
    "index.js": "a216c390bf956cbb906c66d29fdb2e2ad6999464a5ca83e476533a6f25ad0ef3",
    "cjs/react.production.min.js":
      "4b35e378f469c4f492c7514bb106b5833746dbbae80496bd4aa9acc6e9ac4b42",
    "jsx-runtime.js": "28170e60f2ff0bc045bc7d175f5849e86f68dd02d76d7255369420718b30295a",
    "cjs/react-jsx-runtime.production.min.js":
      "76e3364c46895ed2c4a8d5cc332e5e4ef31d6f732d35b1e56826dc5895245452",
  },
} satisfies StockPackageContract;

export const STOCK_REACTDOM18_BROWSER_MODULE = {
  packageName: "react-dom",
  version: "18.3.1",
  files: {
    "package.json": "d2f29e31bd48b833e48cd7bbf41f192e8ee4ff8da249fdbe10d4ac4114b8b12e",
    "index.js": "f26fcb81b5d1dc32c6edea34645c75b60d259916293d3208c8be48ac33e882e4",
    "client.js": "a510041dfc40d69b3aa574e5e111864186c711fbeb3db41aa2f27196b27c429f",
    "cjs/react-dom.production.min.js":
      "cbf7fe6b9726ee65f8bcd5715289cc5161c8dacf74d0b8aaa0d29412516f5f47",
  },
} satisfies StockPackageContract;

const readReactModule = (
  projectRoot: string,
  importerDirectory: string,
  profile: "vite-production-import" | "vite-production-require",
): StockPhysicalEntry | null =>
  resolveStockPhysicalEntry({
    projectRoot,
    importerDirectory,
    specifier: "react",
    profile,
    contract: STOCK_REACT18_BROWSER_MODULE,
  });

const sameModule = (left: StockPhysicalEntry | null, right: StockPhysicalEntry): boolean =>
  left?.packageDirectory === right.packageDirectory && left.entry === right.entry;

// Use only after a caller qualifies the actual browser-production Vite route.
// Each direct consumer must agree on the real React package and entry. Equal
// hashes or displayed package versions alone do not prove shared hook state.
export const readSameStockReact18BrowserModule = (
  projectRoot: string,
  importerDirectories: readonly string[],
): StockPhysicalEntry | null => {
  const first = importerDirectories[0];
  if (!first) return null;
  const shared = readReactModule(projectRoot, first, "vite-production-import");
  if (!shared) return null;
  for (const importer of importerDirectories) {
    if (
      !sameModule(readReactModule(projectRoot, importer, "vite-production-import"), shared) ||
      !sameModule(readReactModule(projectRoot, importer, "vite-production-require"), shared)
    )
      return null;
  }
  return shared;
};

export interface BrowserReact18OwnershipInput {
  readonly projectRoot: string;
  readonly reactImporterDirectories: readonly string[];
  readonly jsxImporterDirectories: readonly string[];
  readonly rendererImporterDirectory: string;
}

export const readSameStockReact18BrowserRenderer = (
  input: BrowserReact18OwnershipInput,
): { readonly react: StockPhysicalEntry; readonly renderer: StockPhysicalEntry } | null => {
  const {
    projectRoot,
    reactImporterDirectories,
    jsxImporterDirectories,
    rendererImporterDirectory,
  } = input;
  if (!reactImporterDirectories.length || !jsxImporterDirectories.length) return null;
  const react = readSameStockReact18BrowserModule(projectRoot, [
    ...reactImporterDirectories,
    ...jsxImporterDirectories,
    rendererImporterDirectory,
  ]);
  if (!react) return null;
  const renderer = resolveStockPhysicalEntry({
    projectRoot,
    importerDirectory: rendererImporterDirectory,
    specifier: "react-dom/client",
    profile: "vite-production-import",
    contract: STOCK_REACTDOM18_BROWSER_MODULE,
  });
  if (!renderer) return null;
  const rendererModule = resolveStockPhysicalEntry({
    projectRoot,
    importerDirectory: path.dirname(renderer.entry),
    specifier: "react-dom",
    profile: "vite-production-require",
    contract: STOCK_REACTDOM18_BROWSER_MODULE,
  });
  if (
    rendererModule?.packageDirectory !== renderer.packageDirectory ||
    !sameModule(
      readReactModule(
        projectRoot,
        path.join(renderer.packageDirectory, "cjs"),
        "vite-production-require",
      ),
      react,
    )
  )
    return null;
  for (const importer of jsxImporterDirectories) {
    const jsx = resolveStockPhysicalEntry({
      projectRoot,
      importerDirectory: importer,
      specifier: "react/jsx-runtime",
      profile: "vite-production-import",
      contract: STOCK_REACT18_BROWSER_JSX,
    });
    if (
      jsx?.packageDirectory !== react.packageDirectory ||
      !sameModule(
        readReactModule(
          projectRoot,
          path.join(jsx.packageDirectory, "cjs"),
          "vite-production-require",
        ),
        react,
      )
    )
      return null;
  }
  return { react, renderer };
};
