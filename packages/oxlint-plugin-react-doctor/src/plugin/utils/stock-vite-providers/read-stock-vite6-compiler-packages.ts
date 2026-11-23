import * as path from "node:path";
import {
  resolveStockPhysicalEntry,
  type StockPackageContract,
  type StockPhysicalEntry,
  type StockProviderProfile,
} from "./resolve-stock-physical-entry.js";
import packageMembers from "./stock-vite6-package-members.json" with { type: "json" };

interface ProviderRequest {
  readonly projectRoot: string;
  readonly configurationDirectory: string;
  readonly usesSvgr: boolean;
  readonly eagerOptionalImports: ReadonlyArray<OptionalPackage>;
}
type OptionalPackage =
  | "rollup-plugin-visualizer"
  | "vite-plugin-istanbul"
  | "vite-plugin-total-bundle-size";
type PackageName = keyof typeof packageMembers;

interface PackageEdge {
  readonly role: string;
  readonly packageName: PackageName;
  readonly profile?: StockProviderProfile;
  readonly issuerRole?: string;
  readonly issuerMember?: string;
  readonly samePackageAs?: string;
}

const contracts: Readonly<Record<PackageName, StockPackageContract>> = packageMembers;
const compilerEdges: readonly PackageEdge[] = [
  { role: "vite", packageName: "vite" },
  { role: "vite-require", packageName: "vite", profile: "node-require", samePackageAs: "vite" },
  { role: "jsx-transformer", packageName: "@vitejs/plugin-react" },
  {
    role: "jsx-transformer-require",
    packageName: "@vitejs/plugin-react",
    profile: "node-require",
    samePackageAs: "jsx-transformer",
  },
  {
    role: "jsx-transformer-vite",
    packageName: "vite",
    issuerRole: "jsx-transformer",
    samePackageAs: "vite",
  },
  { role: "babel", packageName: "@babel/core", issuerRole: "jsx-transformer" },
  {
    role: "esbuild",
    packageName: "esbuild",
    issuerRole: "vite",
    issuerMember: "dist/node/chunks/dep-Dq2t6Dq0.js",
  },
  {
    role: "rollup",
    packageName: "rollup",
    issuerRole: "vite",
    issuerMember: "dist/node/chunks/dep-Dq2t6Dq0.js",
  },
];

const svgEdges: readonly PackageEdge[] = [
  { role: "svgr", packageName: "vite-plugin-svgr" },
  { role: "svgr-vite", packageName: "vite", issuerRole: "svgr", samePackageAs: "vite" },
  { role: "svgr-core", packageName: "@svgr/core", issuerRole: "svgr" },
  { role: "svgr-jsx", packageName: "@svgr/plugin-jsx", issuerRole: "svgr" },
  {
    role: "svgr-svgo",
    packageName: "@svgr/plugin-svgo",
    issuerRole: "svgr-core",
    profile: "node-require",
  },
  { role: "svgo-engine", packageName: "svgo", issuerRole: "svgr-svgo", profile: "node-require" },
  {
    role: "jsx-svgr-core",
    packageName: "@svgr/core",
    issuerRole: "svgr-jsx",
    profile: "node-require",
    samePackageAs: "svgr-core",
  },
  {
    role: "svgo-svgr-core",
    packageName: "@svgr/core",
    issuerRole: "svgr-svgo",
    profile: "node-require",
    samePackageAs: "svgr-core",
  },
  {
    role: "svgr-core-cosmiconfig",
    packageName: "cosmiconfig",
    issuerRole: "svgr-core",
    profile: "node-require",
  },
  {
    role: "svgr-svgo-cosmiconfig",
    packageName: "cosmiconfig",
    issuerRole: "svgr-svgo",
    profile: "node-require",
    samePackageAs: "svgr-core-cosmiconfig",
  },
];

export const readStockVite6CompilerPackages = (
  request: ProviderRequest,
): ReadonlyMap<string, StockPhysicalEntry> | null => {
  const entries = new Map<string, StockPhysicalEntry>();
  const additional = request.eagerOptionalImports.map((packageName) => ({
    role: packageName,
    packageName,
  }));
  const edges: readonly PackageEdge[] = [
    ...compilerEdges,
    ...(request.usesSvgr ? svgEdges : []),
    ...additional,
  ];
  for (const edge of edges) {
    const issuer = edge.issuerRole ? entries.get(edge.issuerRole) : undefined;
    if (edge.issuerRole && !issuer) return null;
    const issuerFile =
      edge.issuerMember && issuer
        ? path.join(issuer.packageDirectory, edge.issuerMember)
        : issuer?.entry;
    const found = resolveStockPhysicalEntry({
      projectRoot: request.projectRoot,
      importerDirectory: issuerFile ? path.dirname(issuerFile) : request.configurationDirectory,
      profile: edge.profile ?? "node-import",
      specifier: edge.packageName,
      contract: contracts[edge.packageName],
    });
    if (
      !found ||
      (edge.samePackageAs &&
        found.packageDirectory !== entries.get(edge.samePackageAs)?.packageDirectory)
    ) {
      return null;
    }
    entries.set(edge.role, found);
  }
  return entries;
};
