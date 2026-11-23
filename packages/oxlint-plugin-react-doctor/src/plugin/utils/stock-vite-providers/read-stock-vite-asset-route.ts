import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../cross-file-probe-recorder.js";
import { hasNoImplicitSvgConfig } from "./has-no-implicit-svg-config.js";
import { isPathInside } from "../is-path-inside.js";
import {
  discoverDefaultViteStyleRequests,
  readDefaultViteStyleRoute,
  type StyleRouteInput,
} from "../read-default-vite-style-route.js";
import { readProviderMember, type StockPhysicalEntry } from "./resolve-stock-physical-entry.js";
import {
  isStockVite6StylesheetSpecifier,
  readStockVite6StylesheetProviders,
  type StockVite6StylesheetImport,
} from "./read-stock-vite6-stylesheet-providers.js";
import { isStaticSvgSource } from "./is-static-svg-source.js";

export interface ViteSvgAsset {
  readonly filename: string;
  readonly kind: "component" | "url";
}

export interface StockViteAssetRouteInput {
  readonly projectRoot: string;
  readonly viteEntry: StockPhysicalEntry;
  readonly sourceAliases: ReadonlyMap<string, string>;
  readonly localStylesheetFiles: readonly string[];
  readonly moduleStylesheetImports: readonly {
    readonly importerFile: string;
    readonly specifier: string;
  }[];
  readonly svgAssets: readonly ViteSvgAsset[];
  // Supplied by the verified compiler profile, including literal SVG option
  // values, provider identities, resolver aliases and the declared runtime.
  readonly svgTransform:
    | { readonly kind: "none" }
    | { readonly kind: "stock-svgr"; readonly implicitConfigHome: string | null };
}

type FileMarker = "missing" | "file" | "directory" | "opaque";

/**
 * lstat treats dangling links as meaningful while the historical existence
 * fingerprint follows links. Also record the actual parent directory when
 * a candidate is absent, so newly dangling candidates cannot replay a proof.
 */
const createFileProbe = () => {
  const seenDirectories = new Set<string>();
  const addParent = (filename: string) => {
    for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
      if (seenDirectories.has(directory)) return;
      recordExistenceProbe(directory);
      const stat = lstatSync(directory, { throwIfNoEntry: false });
      if (stat?.isDirectory() && realpathSync(directory) === directory) {
        recordRealpathProbe(directory);
        recordDirectoryProbe(directory);
        seenDirectories.add(directory);
        return;
      }
      if (stat || path.dirname(directory) === directory) return;
    }
  };
  return (filename: string): FileMarker => {
    recordExistenceProbe(filename);
    const entry = lstatSync(filename, { throwIfNoEntry: false });
    if (!entry) {
      addParent(filename);
      return "missing";
    }
    recordRealpathProbe(filename);
    if (entry.isSymbolicLink() || realpathSync(filename) !== filename) return "opaque";
    return entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "opaque";
  };
};

const makeStylesheetLookup = (
  root: string,
  probe: (filename: string) => FileMarker,
): StyleRouteInput["lookup"] => {
  const selected = new Map<string, ReturnType<StyleRouteInput["lookup"]>>();
  return (relativeName) => {
    const file = path.resolve(root, relativeName);
    if (path.isAbsolute(relativeName) || !isPathInside(file, root) || file === root)
      return { kind: "blocked" };
    const previous = selected.get(file);
    if (previous) return previous;
    const marker = probe(file);
    const bytes = marker === "file" ? readProviderMember(file) : null;
    const answer =
      bytes !== null
        ? ({ kind: "file", text: bytes.toString("utf8") } as const)
        : marker === "missing"
          ? ({ kind: "absent" } as const)
          : ({ kind: "blocked" } as const);
    selected.set(file, answer);
    return answer;
  };
};

const readManifest = (filename: string): Record<string, unknown> | null => {
  const raw = readProviderMember(filename);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw.toString("utf8"));
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const readSvgAssets = (
  input: StockViteAssetRouteInput,
  probe: (filename: string) => FileMarker,
): boolean => {
  const seen = new Set<string>();
  for (const { filename, kind } of input.svgAssets) {
    if (
      !path.isAbsolute(filename) ||
      !isPathInside(filename, input.projectRoot) ||
      !filename.endsWith(".svg") ||
      probe(filename) !== "file" ||
      (kind !== "url" && kind !== "component") ||
      (kind === "component" && input.svgTransform.kind !== "stock-svgr")
    )
      return false;
    if (seen.has(filename)) continue;
    const bytes = readProviderMember(filename);
    if (!bytes || !isStaticSvgSource(filename, bytes.toString("utf8"))) return false;
    // The stock transform loads its implicit config while processing matching
    // SVG files, before its consumer chooses an SVG component or asset URL.
    if (
      input.svgTransform.kind === "stock-svgr" &&
      input.svgTransform.implicitConfigHome !== null &&
      !hasNoImplicitSvgConfig({
        assetFilename: filename,
        workingDirectory: input.projectRoot,
        homeDirectory: input.svgTransform.implicitConfigHome,
        probe,
        readPackage: readManifest,
      })
    )
      return false;
    seen.add(filename);
  }
  return true;
};

export const readStockViteAssetRoute = (input: StockViteAssetRouteInput) => {
  const { projectRoot, sourceAliases } = input;
  try {
    const probe = createFileProbe();
    if (
      !path.isAbsolute(projectRoot) ||
      probe(projectRoot) !== "directory" ||
      !readSvgAssets(input, probe)
    )
      return null;
    const localRoots = input.localStylesheetFiles.map((filename) =>
      path.isAbsolute(filename) && isPathInside(filename, projectRoot)
        ? path.relative(projectRoot, filename).split(path.sep).join("/")
        : null,
    );
    if (localRoots.some((filename) => filename === null)) return null;
    const styleInputs = {
      localRoots: localRoots.filter((filename): filename is string => filename !== null),
      externalRoots: input.moduleStylesheetImports.map(({ specifier }) => specifier),
      sourceAliases,
      lookup: makeStylesheetLookup(projectRoot, probe),
    };
    const candidate = discoverDefaultViteStyleRequests(
      styleInputs,
      isStockVite6StylesheetSpecifier,
    );
    if (!candidate) return null;
    const stylesheetImports: StockVite6StylesheetImport[] = input.moduleStylesheetImports.map(
      ({ importerFile, specifier }) => ({ importerFile, specifier, kind: "module-import" }),
    );
    for (const edge of candidate.edges) {
      if (edge.selected.startsWith("package:"))
        stylesheetImports.push({
          importerFile: path.join(projectRoot, edge.from),
          specifier: edge.source,
          kind: "css-import",
        });
    }
    const [postcss, tailwind] = candidate.configFiles;
    if (!postcss || !tailwind) return null;
    const physical = readStockVite6StylesheetProviders({
      projectRoot,
      viteEntry: input.viteEntry,
      profile: "vite-production-import",
      postcssConfigFile: path.join(projectRoot, postcss),
      tailwindConfigFiles: [path.join(projectRoot, tailwind)],
      stylesheetImports,
    });
    if (!physical) return null;
    const stylesheets = readDefaultViteStyleRoute({
      ...styleInputs,
      externalStyles: physical.externalStyles,
    });
    return stylesheets ? { stylesheets, physical } : null;
  } catch {
    return null;
  }
};
