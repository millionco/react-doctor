import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../cross-file-probe-recorder.js";
import { isPathInside } from "../is-path-inside.js";
import {
  haveNoPhysicalPackageCandidates,
  readProviderMember,
  resolveStockPhysicalEntry,
  type StockPhysicalEntry,
  type StockProviderProfile,
} from "./resolve-stock-physical-entry.js";
import { STOCK_VITE6_CSS_PACKAGES } from "./stock-vite6-css-catalogue.js";

const STYLES = {
  "tw-animate-css": { packageName: "tw-animate-css", member: "dist/tw-animate.css" },
  "katex/dist/katex.min.css": { packageName: "katex", member: "dist/katex.min.css" },
  "lightgallery/css/lightgallery.css": {
    packageName: "lightgallery",
    member: "css/lightgallery.css",
  },
  "lightgallery/css/lg-thumbnail.css": {
    packageName: "lightgallery",
    member: "css/lg-thumbnail.css",
  },
  "lightgallery/css/lg-autoplay.css": {
    packageName: "lightgallery",
    member: "css/lg-autoplay.css",
  },
} as const;

type StockPackageName = keyof typeof STOCK_VITE6_CSS_PACKAGES;
type StylesheetSpecifier = keyof typeof STYLES;

export const isStockVite6StylesheetSpecifier = (specifier: string): boolean =>
  Object.hasOwn(STYLES, specifier);

export interface StockVite6StylesheetImport {
  readonly importerFile: string;
  readonly specifier: string;
  readonly kind: "css-import" | "module-import";
}

export interface StockVite6StylesheetProviderInput {
  readonly projectRoot: string;
  readonly viteEntry: StockPhysicalEntry;
  readonly profile: "vite-production-import";
  readonly postcssConfigFile: string;
  readonly tailwindConfigFiles: readonly string[];
  readonly stylesheetImports: readonly StockVite6StylesheetImport[];
}

export interface StockVite6Stylesheet {
  readonly packageName: string;
  readonly version: string;
  readonly member: string;
  readonly text: string;
  readonly provider: StockPhysicalEntry;
}

export interface StockVite6StylesheetProviders {
  readonly vite: StockPhysicalEntry;
  readonly postcss: StockPhysicalEntry;
  readonly postcssEsm: StockPhysicalEntry;
  readonly sass: StockPhysicalEntry;
  readonly tailwind: StockPhysicalEntry;
  readonly tailwindAnimate: StockPhysicalEntry;
  readonly autoprefixer: StockPhysicalEntry;
  readonly externalStyles: ReadonlyMap<string, StockVite6Stylesheet>;
}

const sameEntry = (left: StockPhysicalEntry | null, right: StockPhysicalEntry): boolean =>
  left?.packageDirectory === right.packageDirectory && left.entry === right.entry;

const hasPath = (filename: string): boolean => {
  recordExistenceProbe(filename);
  return lstatSync(filename, { throwIfNoEntry: false }) !== undefined;
};

const hasSafeSource = (filename: string, projectRoot: string, seen: Set<string>): boolean => {
  if (!path.isAbsolute(filename) || !isPathInside(filename, projectRoot)) return false;
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  recordContentProbe(filename);
  if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) return false;
  for (
    let directory = path.dirname(filename);
    directory !== projectRoot;
    directory = path.dirname(directory)
  ) {
    if (seen.has(directory)) break;
    if (hasPath(path.join(directory, "package.json"))) return false;
    seen.add(directory);
  }
  return true;
};

const createReader = (projectRoot: string) => {
  const checked = new Set<string>();
  return (
    directory: string,
    packageName: StockPackageName,
    profile: StockProviderProfile,
    subpath = "",
  ): StockPhysicalEntry | null => {
    const contract = STOCK_VITE6_CSS_PACKAGES[packageName];
    const result = resolveStockPhysicalEntry({
      projectRoot,
      importerDirectory: directory,
      specifier: packageName + subpath,
      profile,
      contract,
    });
    if (!result) return null;
    for (const member of Object.keys(contract.files)) {
      for (
        let current = path.dirname(path.join(result.packageDirectory, member));
        current !== result.packageDirectory;
        current = path.dirname(current)
      ) {
        if (checked.has(current)) break;
        if (hasPath(path.join(current, "package.json"))) return null;
        checked.add(current);
      }
    }
    return result;
  };
};

type ReadEntry = ReturnType<typeof createReader>;

const readCompilerProviders = (input: StockVite6StylesheetProviderInput, read: ReadEntry) => {
  const vite = read(input.projectRoot, "vite", "node-import");
  if (
    !vite ||
    !sameEntry(vite, input.viteEntry) ||
    vite.entry !== path.join(vite.packageDirectory, "dist/node/index.js")
  )
    return null;
  // The pinned CSS chunk contains the stock postcss wrappers and Sass loader.
  const viteCssIssuer = path.join(vite.packageDirectory, "dist/node/chunks");
  const postcssEsm = read(viteCssIssuer, "postcss", "node-import");
  const postcss = read(path.dirname(input.postcssConfigFile), "postcss", "node-require");
  if (
    !postcss ||
    postcssEsm?.packageDirectory !== postcss.packageDirectory ||
    !sameEntry(read(viteCssIssuer, "postcss", "node-require"), postcss)
  )
    return null;

  if (!haveNoPhysicalPackageCandidates([input.projectRoot, viteCssIssuer], "sass-embedded"))
    return null;
  const sassIssuer = haveNoPhysicalPackageCandidates([input.projectRoot], "sass")
    ? viteCssIssuer
    : input.projectRoot;
  const sass = read(sassIssuer, "sass", "node-require");
  if (!sass || sass.entry !== path.join(sass.packageDirectory, "sass.node.js")) return null;

  const configIssuer = path.dirname(input.postcssConfigFile);
  const tailwind = read(configIssuer, "tailwindcss", "node-require");
  const autoprefixer = read(configIssuer, "autoprefixer", "node-require");
  if (
    !tailwind ||
    !autoprefixer ||
    ![tailwind, autoprefixer].every(({ entry }) =>
      sameEntry(read(path.dirname(entry), "postcss", "node-require"), postcss),
    )
  )
    return null;

  let tailwindAnimate: StockPhysicalEntry | null = null;
  for (const tailwindConfigFile of input.tailwindConfigFiles) {
    const provider = read(path.dirname(tailwindConfigFile), "tailwindcss-animate", "node-require");
    if (!provider || (tailwindAnimate && !sameEntry(provider, tailwindAnimate))) return null;
    // Stock tailwindcss-animate requires the extensionless Tailwind plugin entry.
    const plugin = read(path.dirname(provider.entry), "tailwindcss", "node-require", "/plugin.js");
    if (plugin?.packageDirectory !== tailwind.packageDirectory) return null;
    tailwindAnimate = provider;
  }
  if (
    !tailwindAnimate ||
    ["plugin", "lib/plugin", "lib/public/create-plugin"].some((member) =>
      hasPath(path.join(tailwind.packageDirectory, member)),
    )
  )
    return null;
  return { vite, postcss, postcssEsm, sass, tailwind, tailwindAnimate, autoprefixer };
};

const readExternalStyles = (
  input: StockVite6StylesheetProviderInput,
  read: ReadEntry,
): ReadonlyMap<string, StockVite6Stylesheet> | null => {
  const externalStyles = new Map<string, StockVite6Stylesheet>();
  for (const { importerFile, specifier, kind } of input.stylesheetImports) {
    if (
      !isStockVite6StylesheetSpecifier(specifier) ||
      (kind !== "css-import" && kind !== "module-import")
    )
      return null;
    const { packageName, member } = STYLES[specifier as StylesheetSpecifier];
    const issuer = path.dirname(importerFile);
    // Vite's CSS @import resolver tries a relative file before a bare package.
    // Sass import rules differ and are outside this external CSS selector.
    if (kind === "css-import") {
      const relative = path.join(issuer, specifier);
      if (!importerFile.endsWith(".css") || hasPath(relative) || hasPath(relative + ".css"))
        return null;
    }
    const provider = read(
      issuer,
      packageName,
      kind === "css-import" ? "vite-style" : input.profile,
      specifier.slice(packageName.length),
    );
    if (!provider || provider.entry !== path.join(provider.packageDirectory, member)) return null;
    const previous = externalStyles.get(specifier);
    if (previous) {
      if (!sameEntry(provider, previous.provider)) return null;
      continue;
    }
    const contract = STOCK_VITE6_CSS_PACKAGES[packageName];
    const digest = (contract.files as Readonly<Record<string, string>>)[member];
    const source = digest && readProviderMember(provider.entry, digest);
    if (!source) return null;
    externalStyles.set(specifier, {
      packageName,
      version: contract.version,
      member,
      text: source.toString("utf8"),
      provider,
    });
  }
  return externalStyles;
};

/**
 * Use only with a qualified stock production Vite config and static stylesheet
 * and source-import traversal. Caller owns aliases, config precedence/options,
 * selected plugins, local Sass directives and workspace/build entry selection.
 * This verifies selected filesystem providers without evaluating any of them.
 */
export const readStockVite6StylesheetProviders = (
  input: StockVite6StylesheetProviderInput,
): StockVite6StylesheetProviders | null => {
  const { projectRoot, postcssConfigFile, tailwindConfigFiles, stylesheetImports, profile } = input;
  if (
    !path.isAbsolute(projectRoot) ||
    profile !== "vite-production-import" ||
    path.dirname(postcssConfigFile) !== projectRoot ||
    !tailwindConfigFiles.length ||
    !stylesheetImports.length
  )
    return null;
  try {
    const rootManifest = readProviderMember(path.join(projectRoot, "package.json"));
    const manifest = rootManifest && JSON.parse(rootManifest.toString("utf8"));
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      Object.hasOwn(manifest, "browser")
    )
      return null;
    const seen = new Set<string>();
    if (
      ![
        postcssConfigFile,
        ...tailwindConfigFiles,
        ...stylesheetImports.map(({ importerFile }) => importerFile),
      ].every((filename) => hasSafeSource(filename, projectRoot, seen))
    )
      return null;

    const read = createReader(projectRoot);
    const compilers = readCompilerProviders(input, read);
    const externalStyles = compilers && readExternalStyles(input, read);
    return compilers && externalStyles ? { ...compilers, externalStyles } : null;
  } catch {
    return null;
  }
};
