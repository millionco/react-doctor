import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";

export const DOTLOTTIE_REACT_PACKAGE = "@lottiefiles/dotlottie-react";
export const DOTLOTTIE_WEB_PACKAGE = "@lottiefiles/dotlottie-web";
export type StockDotLottieAdapter = "0.8.12" | "0.13.5";

// SHA256 of the public registry members, independently checked against the
// registry tarball's integrity. These pin the package entry map as well as
// every stock entry path the modeled browser/CJS/ESM routes might choose.
const knownPackages = {
  "0.8.12": {
    react: {
      "package.json": "86a8664067a21735caae12a7617449f149bf8cc6b3f957c45d7aed5c68ba4671",
      "dist/index.js": "d2f5cf7bdf4e840a1e9a19ea029640586a68dd4e8fbac4cc1c027db68749f2c3",
    },
    web: {
      "package.json": "6db955ec7446908cca92368756eea6f9cec96e58af1bac38f3ddf6729728f57b",
      "dist/index.cjs": "4f4530d1ce5e94fe05bd047c580fb0e900af8bd2388fb7bb2606a8d11c968a79",
      "dist/index.js": "2210aa0b60d9913eecebc55878e448b0c0e68365af9005e9a5dafd8cb614486b",
    },
  },
  "0.13.5": {
    react: {
      "package.json": "dc523f8a91caecc50421f52a3d5ad433d91b7a4313359692a02479427b8a3987",
      "dist/index.js": "486f9fcefdfe8e6147e44a3a013af118f3584e59a05b43b381116863d7466a20",
      "dist/browser/index.js": "1795a9ca6d28e1d561d00b6370b4c1036abae804c97321d4b1cae77382a5503a",
    },
    web: {
      "package.json": "d0f15f4d0038616feb533523b143b6f41dcb1cc0257fe2ca1246e4941709764a",
      "dist/index.cjs": "d9e94a1fac5d7da1cc42ef3733a189f3f7a599082c9ee8dda133d8875ba40f1a",
      "dist/index.js": "177c148f3cb784002154bc274019abfd25814194e4fd78fc5b9b9defffbd704a",
    },
  },
} as const;

type PathKind = "file" | "directory" | "missing" | "unsupported";

export const getDotLottieRoutePathKind = (directory: string, filename: string): PathKind => {
  if (!isPathInside(filename, directory)) return "unsupported";
  recordExistenceProbe(directory);
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return "unsupported";
  let current = directory;
  const segments = relative(directory, filename).split(sep);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    recordExistenceProbe(current);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry) return "missing";
    if (index === segments.length - 1) {
      if (entry.isFile()) return "file";
      return entry.isDirectory() ? "directory" : "unsupported";
    }
    if (!entry.isDirectory()) return "unsupported";
  }
  return "unsupported";
};

const matchesPackage = (
  workspace: string,
  packageDirectory: string,
  expected: Readonly<Record<string, string>>,
): boolean =>
  Object.entries(expected).every(([member, digest]) => {
    const filename = join(packageDirectory, member);
    if (
      getDotLottieRoutePathKind(workspace, filename) !== "file" ||
      lstatSync(filename).size > 1_000_000
    )
      return false;
    recordContentProbe(filename);
    return createHash("sha256").update(readFileSync(filename)).digest("hex") === digest;
  });

const findOwnedWebPackage = (workspace: string, adapter: string): string | null => {
  let directory = adapter;
  while (isPathInside(directory, workspace)) {
    const candidate = join(directory, "node_modules", DOTLOTTIE_WEB_PACKAGE);
    const kind = getDotLottieRoutePathKind(workspace, candidate);
    if (kind === "directory") return candidate;
    if (kind !== "missing") return null;
    if (directory === workspace) return null;
    directory = dirname(directory);
  }
  return null;
};

/** The caller must prove that the effective resolver selects this workspace. */
export const hasStockInstalledDotLottieProvider = (
  workspace: string,
  version: StockDotLottieAdapter,
): boolean => {
  const adapter = join(workspace, "node_modules", DOTLOTTIE_REACT_PACKAGE);
  const expected = knownPackages[version];
  if (!matchesPackage(workspace, adapter, expected.react)) return false;
  const web = findOwnedWebPackage(workspace, adapter);
  return web !== null && matchesPackage(workspace, web, expected.web);
};
