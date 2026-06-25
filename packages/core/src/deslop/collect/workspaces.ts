import { resolve, join, relative, dirname } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import fg from "fast-glob";
import { extractReactRouterRouteModuleEntries } from "./parse.js";

export interface WorkspacePackage {
  name: string;
  directory: string;
  entryFiles: string[];
  isDeclaredWorkspace: boolean;
  depthFromRoot: number;
}

export interface WorkspaceDiscoveryResult {
  packages: WorkspacePackage[];
  excludedDirectories: string[];
  hasRootLevelWorkspacePatterns: boolean;
}

export const resolveWorkspaces = (rootDir: string): WorkspaceDiscoveryResult => {
  const rootPatterns = collectWorkspacePatterns(rootDir);
  const hasRootLevelWorkspacePatterns = rootPatterns.length > 0;
  let expandedDirectories = hasRootLevelWorkspacePatterns
    ? expandWorkspaceGlobs(rootPatterns, rootDir)
    : [];

  const implicitSubProjects = discoverImplicitSubProjects(rootDir, expandedDirectories);

  if (expandedDirectories.length === 0 && implicitSubProjects.length > 0) {
    for (const subProjectDirectory of implicitSubProjects) {
      const subPatterns = collectWorkspacePatterns(subProjectDirectory);
      if (subPatterns.length > 0) {
        const subExpanded = expandWorkspaceGlobs(subPatterns, subProjectDirectory);
        expandedDirectories.push(subProjectDirectory, ...subExpanded);
      }
    }
  }

  const declaredDirectorySet = new Set(expandedDirectories);
  const excludedDirectories: string[] = [];
  const filteredImplicitSubProjects = implicitSubProjects;
  const allDirectories = [...new Set([...expandedDirectories, ...filteredImplicitSubProjects])];

  const workspacePackages: WorkspacePackage[] = [];

  for (const directory of allDirectories) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    try {
      const packageContent = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageContent);
      const packageName = packageJson.name || relative(rootDir, directory);
      const entryFiles = extractWorkspaceEntries(packageJson, directory);

      const relativePath = relative(rootDir, directory);
      const depthFromRoot = relativePath.split("/").filter(Boolean).length;
      workspacePackages.push({
        name: packageName,
        directory,
        entryFiles,
        isDeclaredWorkspace: declaredDirectorySet.has(directory),
        depthFromRoot,
      });
    } catch {}
  }

  return { packages: workspacePackages, excludedDirectories, hasRootLevelWorkspacePatterns };
};

const IMPLICIT_SUB_PROJECT_SEARCH_DEPTH = 3;

const STANDALONE_PROJECT_LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
];

const isStandaloneProject = (directory: string): boolean =>
  STANDALONE_PROJECT_LOCKFILES.some((lockfile) => existsSync(join(directory, lockfile)));

const discoverImplicitSubProjects = (
  rootDir: string,
  alreadyDiscoveredDirectories: string[],
): string[] => {
  const knownDirectories = new Set(alreadyDiscoveredDirectories);
  const hasDeclaredWorkspaces = alreadyDiscoveredDirectories.length > 0;
  const subProjectDirectories: string[] = [];

  const subPackageJsonPaths = fg.sync("**/package.json", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    deep: IMPLICIT_SUB_PROJECT_SEARCH_DEPTH + 1,
  });

  for (const packageJsonPath of subPackageJsonPaths) {
    const directory = packageJsonPath.replace(/\/package\.json$/, "");
    if (directory === rootDir) continue;
    if (knownDirectories.has(directory)) continue;
    if (hasDeclaredWorkspaces && isStandaloneProject(directory)) continue;

    subProjectDirectories.push(directory);
  }

  return subProjectDirectories;
};

const collectWorkspacePatterns = (rootDir: string): string[] => {
  const patterns: string[] = [];

  const packageJsonPath = join(rootDir, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      if (Array.isArray(packageJson.workspaces)) {
        patterns.push(...packageJson.workspaces);
      } else if (packageJson.workspaces?.packages) {
        patterns.push(...packageJson.workspaces.packages);
      }
    } catch {}
  }

  const pnpmWorkspacePath = join(rootDir, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    try {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const packageLines = extractPnpmWorkspacePackages(content);
      patterns.push(...packageLines);
    } catch {}
  }

  const lernaJsonPath = join(rootDir, "lerna.json");
  if (existsSync(lernaJsonPath)) {
    try {
      const content = readFileSync(lernaJsonPath, "utf-8");
      const lernaJson = JSON.parse(content);
      if (Array.isArray(lernaJson.packages)) {
        patterns.push(
          ...lernaJson.packages.filter(
            (pattern: unknown): pattern is string =>
              typeof pattern === "string" && !pattern.startsWith("!"),
          ),
        );
      }
    } catch {}
  }

  return patterns;
};

const extractPnpmWorkspacePackages = (yamlContent: string): string[] => {
  const packages: string[] = [];
  let inPackagesSection = false;

  for (const line of yamlContent.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine === "packages:") {
      inPackagesSection = true;
      continue;
    }
    if (inPackagesSection) {
      if (trimmedLine.startsWith("- ")) {
        const pattern = trimmedLine
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (pattern && !pattern.startsWith("!")) {
          packages.push(pattern);
        }
      } else if (trimmedLine && !trimmedLine.startsWith("#")) {
        break;
      }
    }
  }

  return packages;
};

const expandWorkspaceGlobs = (patterns: string[], rootDir: string): string[] => {
  const directories: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const globPattern = pattern.endsWith("/")
        ? `${pattern}package.json`
        : `${pattern}/package.json`;
      try {
        const matchedFiles = fg.sync(globPattern, {
          cwd: rootDir,
          absolute: true,
          onlyFiles: true,
        });
        for (const matchedPath of matchedFiles) {
          directories.push(matchedPath.replace(/\/package\.json$/, ""));
        }
      } catch {}
    } else {
      const absoluteDirectory = resolve(rootDir, pattern);
      if (existsSync(join(absoluteDirectory, "package.json"))) {
        directories.push(absoluteDirectory);
      }
    }
  }

  return [...new Set(directories)];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];

const OUTPUT_DIR_PREFIXES = [
  "dist/",
  "build/",
  "lib/",
  "lib-dist/",
  "esm/",
  "cjs/",
  "out/",
  "./dist/",
  "./lib-dist/",
];
const SOURCE_INDEX_FALLBACK_STEMS = ["src/index", "src/main", "index", "main"];

const resolveSourcePath = (distPath: string, directory: string): string[] => {
  const relativeToDist = relative(directory, distPath);
  const isOutputDirEntry = OUTPUT_DIR_PREFIXES.some((prefix) => relativeToDist.startsWith(prefix));

  if (isOutputDirEntry) {
    const sourceVariants = OUTPUT_DIR_PREFIXES.map((prefix) =>
      relativeToDist.replace(new RegExp(`^${prefix.replace(".", "\\.")}`), "src/"),
    ).filter((variant) => variant !== relativeToDist);

    for (const variant of sourceVariants) {
      const withoutExtension = variant.replace(/\.[^.]+$/, "");
      for (const sourceExtension of SOURCE_EXTENSIONS) {
        const sourceCandidate = resolve(directory, withoutExtension + sourceExtension);
        if (existsSync(sourceCandidate)) {
          return [sourceCandidate];
        }
      }
    }

    for (const stem of SOURCE_INDEX_FALLBACK_STEMS) {
      for (const sourceExtension of SOURCE_EXTENSIONS) {
        const fallbackCandidate = resolve(directory, stem + sourceExtension);
        if (existsSync(fallbackCandidate)) {
          return [fallbackCandidate];
        }
      }
    }

    return [];
  }

  const resolvedDistPath = resolve(directory, relativeToDist);
  const candidates: string[] = [];

  const withoutJsExtension = relativeToDist.replace(/\.[cm]?js$/, "");
  if (withoutJsExtension !== relativeToDist) {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const directSourceCandidate = resolve(directory, withoutJsExtension + sourceExtension);
      if (existsSync(directSourceCandidate)) {
        candidates.push(directSourceCandidate);
      }
    }
    const indexCandidate = resolve(directory, withoutJsExtension, "index.ts");
    if (existsSync(indexCandidate) && !candidates.includes(indexCandidate)) {
      candidates.push(indexCandidate);
    }
  }

  const withoutTsExtension = relativeToDist.replace(/\.ts$/, "");
  if (withoutTsExtension !== relativeToDist && !existsSync(resolvedDistPath)) {
    const tsxCandidate = resolve(directory, withoutTsExtension + ".tsx");
    if (existsSync(tsxCandidate) && !candidates.includes(tsxCandidate)) {
      candidates.push(tsxCandidate);
    }
  }

  if (candidates.length === 0 && existsSync(resolvedDistPath)) {
    candidates.push(resolvedDistPath);
  }

  return candidates;
};

const extractWorkspaceEntries = (
  packageJson: Record<string, unknown>,
  directory: string,
): string[] => {
  const entries: string[] = [];

  const addWithSourceResolution = (filePath: string) => {
    const resolved = resolve(directory, filePath);
    const sourceVariants = resolveSourcePath(resolved, directory);
    if (sourceVariants.length > 0) {
      entries.push(...sourceVariants);
    } else {
      entries.push(resolved);
    }
  };

  const entryFields = ["main", "module", "browser", "types", "typings", "source"];
  for (const field of entryFields) {
    const fieldValue = packageJson[field];
    if (typeof fieldValue === "string") {
      addWithSourceResolution(fieldValue);
    }
  }

  if (packageJson.exports) {
    const exportPaths: string[] = [];
    collectExportPaths(packageJson.exports, directory, exportPaths);
    for (const exportPath of exportPaths) {
      const sourceVariants = resolveSourcePath(exportPath, directory);
      if (sourceVariants.length > 0) {
        entries.push(...sourceVariants);
      } else {
        entries.push(exportPath);
      }
    }
  }

  if (packageJson.bin) {
    if (typeof packageJson.bin === "string") {
      addWithSourceResolution(packageJson.bin);
    } else if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
      for (const binPath of Object.values(packageJson.bin)) {
        if (typeof binPath === "string") {
          addWithSourceResolution(binPath);
        }
      }
    }
  }

  return [...new Set(entries)];
};

const collectExportPaths = (exportValue: unknown, rootDir: string, entries: string[]): void => {
  if (typeof exportValue === "string") {
    if (exportValue.startsWith(".")) {
      if (exportValue.includes("*")) {
        const globPattern = exportValue.replace(/^\.\/?/, "");
        try {
          const expandedFiles = fg.sync(globPattern, {
            cwd: rootDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          });
          entries.push(...expandedFiles);
        } catch {}
      } else {
        entries.push(resolve(rootDir, exportValue));
      }
    }
    return;
  }

  if (typeof exportValue !== "object" || exportValue === null) return;

  for (const nestedValue of Object.values(exportValue)) {
    collectExportPaths(nestedValue, rootDir, entries);
  }
};

const NEXTJS_APP_ROUTER_CONVENTIONS = [
  "page",
  "layout",
  "loading",
  "error",
  "not-found",
  "template",
  "default",
  "route",
  "global-error",
  "forbidden",
  "unauthorized",
  "middleware",
  "instrumentation",
  "manifest",
  "robots",
  "sitemap",
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
  "actions",
];

const FRAMEWORK_FILE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs}";

const FRAMEWORK_FILE_GLOB_WITH_MDX = "**/*.{ts,tsx,js,jsx,mdx,md,mjs,cjs}";

const NEXTJS_ENABLERS = ["next"];
const REACT_ROUTER_ENABLERS = ["@react-router/dev"];
const REMIX_ENABLERS = [
  "@remix-run/node",
  "@remix-run/react",
  "@remix-run/cloudflare",
  "@remix-run/cloudflare-pages",
  "@remix-run/deno",
];
const NUXT_ENABLERS = ["nuxt"];
const SVELTEKIT_ENABLERS = ["@sveltejs/kit"];
const ASTRO_ENABLERS = ["astro"];
const GATSBY_ENABLERS = ["gatsby"];

const readDependencies = (directory: string): Record<string, string> => {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return {};
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    return {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };
  } catch {
    return {};
  }
};

const hasAnyEnabler = (dependencies: Record<string, string>, enablers: string[]): boolean =>
  enablers.some((enabler) => enabler in dependencies);

const extractReactRouterAppDirectory = (directory: string): string => {
  const configCandidates = [
    "react-router.config.ts",
    "react-router.config.js",
    "react-router.config.mjs",
    "react-router.config.cjs",
  ];

  for (const configFile of configCandidates) {
    const configPath = join(directory, configFile);
    if (!existsSync(configPath)) continue;

    try {
      const content = readFileSync(configPath, "utf-8");
      const appDirectoryMatch = content.match(/appDirectory\s*:\s*['"`]([^'"`]+)['"`]/);
      if (appDirectoryMatch) {
        return appDirectoryMatch[1].replace(/^\.\//, "");
      }
    } catch {
      // fall through
    }
  }

  return "app";
};

const ROUTE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const resolveRouteModulePath = (
  modulePath: string,
  routesFileDirectory: string,
): string | undefined => {
  const normalizedPath = modulePath.startsWith("./") ? modulePath.slice(2) : modulePath;

  const hasExtension = ROUTE_FILE_EXTENSIONS.some((extension) =>
    normalizedPath.endsWith(extension),
  );
  if (hasExtension) {
    const absolutePath = resolve(routesFileDirectory, normalizedPath);
    if (existsSync(absolutePath)) return absolutePath;
    return undefined;
  }

  for (const extension of ROUTE_FILE_EXTENSIONS) {
    const absolutePath = resolve(routesFileDirectory, normalizedPath + extension);
    if (existsSync(absolutePath)) return absolutePath;
  }

  for (const extension of ROUTE_FILE_EXTENSIONS) {
    const absolutePath = resolve(routesFileDirectory, normalizedPath, `index${extension}`);
    if (existsSync(absolutePath)) return absolutePath;
  }

  return undefined;
};

const extractRouteModuleEntriesFromRoutesFiles = (
  rootDir: string,
  appDirectory: string,
): string[] => {
  const routesFileCandidates = fg.sync(
    [
      `${appDirectory}/routes.{ts,js,mts,mjs}`,
      `${appDirectory}/routes/**/*.{ts,js,mts,mjs}`,
      `src/routes.{ts,js,mts,mjs}`,
    ],
    { cwd: rootDir, absolute: true, onlyFiles: true, ignore: ["**/node_modules/**"] },
  );

  const resolvedEntries: string[] = [];
  for (const routesFilePath of routesFileCandidates) {
    const routesFileDirectory = dirname(routesFilePath);
    const modulePaths = extractReactRouterRouteModuleEntries(routesFilePath);
    for (const modulePath of modulePaths) {
      const resolvedPath = resolveRouteModulePath(modulePath, routesFileDirectory);
      if (resolvedPath) {
        resolvedEntries.push(resolvedPath);
      }
    }
  }
  return resolvedEntries;
};

export const detectFrameworkEntries = (rootDir: string): string[] => {
  const entryPoints: string[] = [];
  const dependencies = readDependencies(rootDir);

  const isNextjs = hasAnyEnabler(dependencies, NEXTJS_ENABLERS);
  const isReactRouter = hasAnyEnabler(dependencies, REACT_ROUTER_ENABLERS);
  const isRemix = hasAnyEnabler(dependencies, REMIX_ENABLERS);
  const isNuxt = hasAnyEnabler(dependencies, NUXT_ENABLERS);
  const isSvelteKit = hasAnyEnabler(dependencies, SVELTEKIT_ENABLERS);
  const isAstro = hasAnyEnabler(dependencies, ASTRO_ENABLERS);
  const isGatsby = hasAnyEnabler(dependencies, GATSBY_ENABLERS);

  if (isNextjs) {
    const appRouterConventionGlob = NEXTJS_APP_ROUTER_CONVENTIONS.map(
      (convention) => `**/${convention}.{ts,tsx,js,jsx,mdx}`,
    ).join(",");

    const appDirs = [join(rootDir, "app"), join(rootDir, "src", "app")];
    for (const appDir of appDirs) {
      if (existsSync(appDir) && statSync(appDir).isDirectory()) {
        entryPoints.push(
          ...fg.sync(`{${appRouterConventionGlob}}`, {
            cwd: appDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }

    const pagesDirs = [join(rootDir, "pages"), join(rootDir, "src", "pages")];
    for (const pagesDir of pagesDirs) {
      if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
        entryPoints.push(
          ...fg.sync(FRAMEWORK_FILE_GLOB, {
            cwd: pagesDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }

    entryPoints.push(
      ...fg.sync(
        [
          "middleware.{ts,js}",
          "src/middleware.{ts,js}",
          "instrumentation.{ts,js}",
          "instrumentation-client.{ts,js}",
          "src/instrumentation.{ts,js}",
          "src/instrumentation-client.{ts,js}",
          "mdx-components.{ts,tsx,js,jsx}",
          "src/mdx-components.{ts,tsx,js,jsx}",
        ],
        { cwd: rootDir, absolute: true, onlyFiles: true, ignore: ["**/node_modules/**"] },
      ),
    );
  }

  if (isReactRouter || isRemix) {
    const reactRouterAppDirectory = extractReactRouterAppDirectory(rootDir);
    entryPoints.push(
      ...fg.sync(
        [
          `${reactRouterAppDirectory}/routes/**/*.{ts,tsx,js,jsx}`,
          `${reactRouterAppDirectory}/root.{ts,tsx,js,jsx}`,
          `${reactRouterAppDirectory}/entry.client.{ts,tsx,js,jsx}`,
          `${reactRouterAppDirectory}/entry.server.{ts,tsx,js,jsx}`,
          `${reactRouterAppDirectory}/routes.{ts,js,mts,mjs}`,
        ],
        { cwd: rootDir, absolute: true, onlyFiles: true, ignore: ["**/node_modules/**"] },
      ),
    );

    const routeModuleEntries = extractRouteModuleEntriesFromRoutesFiles(
      rootDir,
      reactRouterAppDirectory,
    );
    entryPoints.push(...routeModuleEntries);
  }

  if (isNuxt) {
    const nuxtDirs = ["pages", "layouts", "middleware", "server", "composables", "plugins"];
    for (const nuxtDir of nuxtDirs) {
      const dirPath = join(rootDir, nuxtDir);
      if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
        entryPoints.push(
          ...fg.sync("**/*.{ts,tsx,js,jsx,vue}", {
            cwd: dirPath,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  }

  if (isSvelteKit) {
    const svelteDirs = [
      join(rootDir, "src", "routes"),
      join(rootDir, "src", "lib"),
      join(rootDir, "src", "params"),
    ];
    for (const svelteDir of svelteDirs) {
      if (existsSync(svelteDir) && statSync(svelteDir).isDirectory()) {
        entryPoints.push(
          ...fg.sync("**/*.{ts,tsx,js,jsx,svelte}", {
            cwd: svelteDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  }

  if (isAstro) {
    const astroDirs = [
      join(rootDir, "src", "pages"),
      join(rootDir, "src", "layouts"),
      join(rootDir, "src", "content"),
    ];
    for (const astroDir of astroDirs) {
      if (existsSync(astroDir) && statSync(astroDir).isDirectory()) {
        entryPoints.push(
          ...fg.sync(FRAMEWORK_FILE_GLOB_WITH_MDX, {
            cwd: astroDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  }

  if (isGatsby) {
    const gatsbyDirs = [join(rootDir, "src", "pages"), join(rootDir, "src", "templates")];
    for (const gatsbyDir of gatsbyDirs) {
      if (existsSync(gatsbyDir) && statSync(gatsbyDir).isDirectory()) {
        entryPoints.push(
          ...fg.sync(FRAMEWORK_FILE_GLOB, {
            cwd: gatsbyDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          }),
        );
      }
    }
  }

  const storyPatterns = [
    "**/*.stories.{ts,tsx,js,jsx,mts,mjs}",
    "**/*.story.{ts,tsx,js,jsx,mts,mjs}",
    ".storybook/**/*.{ts,tsx,js,jsx,mts,mjs}",
  ];

  entryPoints.push(
    ...fg.sync(storyPatterns, {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    }),
  );

  const nonConfigEntryPatterns = [
    "env.{ts,js,mjs}",
    "src/env.{ts,js,mjs}",
    "src/routeTree.gen.{ts,tsx}",
    "src/router.{ts,tsx}",
  ];

  entryPoints.push(
    ...fg.sync(nonConfigEntryPatterns, {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    }),
  );

  const alwaysEntryDirs = ["e2e", "cypress"];
  for (const entryDir of alwaysEntryDirs) {
    const dirPath = join(rootDir, entryDir);
    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      entryPoints.push(
        ...fg.sync(FRAMEWORK_FILE_GLOB, {
          cwd: dirPath,
          absolute: true,
          onlyFiles: true,
          dot: entryDir.startsWith("."),
        }),
      );
    }
  }

  entryPoints.push(...discoverElectronEntryPoints(rootDir));
  entryPoints.push(...discoverMobileEntryPoints(rootDir));

  return [...new Set(entryPoints)];
};

const ELECTRON_ENABLERS = ["electron", "electron-builder", "@electron-forge/cli", "electron-vite"];

const ELECTRON_ENTRY_PATTERNS = [
  "src/main/**/*.{ts,js}",
  "src/preload/**/*.{ts,js}",
  "electron/main.{ts,js}",
  "electron.vite.config.{ts,js,mjs}",
  "forge.config.{ts,js,cjs}",
  "electron-builder.{yml,yaml,json,json5,toml}",
];

const discoverElectronEntryPoints = (rootDir: string): string[] => {
  const packageJsonPath = join(rootDir, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };

    const isElectronProject = ELECTRON_ENABLERS.some((enabler) => enabler in allDependencies);
    if (!isElectronProject) return [];

    return fg.sync(ELECTRON_ENTRY_PATTERNS, {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch {
    return [];
  }
};

const EXPO_ENABLERS = ["expo"];
const EXPO_ROUTER_ENABLERS = ["expo-router"];

const EXPO_ENTRY_PATTERNS = [
  "App.{ts,tsx,js,jsx}",
  "src/App.{ts,tsx,js,jsx}",
  "app.config.{ts,js,mjs,cjs}",
  "metro.config.{ts,js,mjs,cjs}",
  "babel.config.{ts,js,mjs,cjs}",
];

const EXPO_ROUTER_ENTRY_PATTERNS = [
  "app/**/*.{ts,tsx,js,jsx}",
  "src/app/**/*.{ts,tsx,js,jsx}",
  "app.config.{ts,js,mjs,cjs}",
  "metro.config.{ts,js,mjs,cjs}",
  "babel.config.{ts,js,mjs,cjs}",
];

const REACT_NATIVE_ENABLERS = ["react-native"];

const REACT_NATIVE_ENTRY_PATTERNS = [
  "index.{ts,tsx,js,jsx}",
  "index.android.{ts,tsx,js,jsx}",
  "index.ios.{ts,tsx,js,jsx}",
  "index.native.{ts,tsx,js,jsx}",
  "App.{ts,tsx,js,jsx}",
  "src/App.{ts,tsx,js,jsx}",
  "metro.config.{ts,js}",
  "react-native.config.{ts,js}",
];

const discoverMobileEntryPoints = (directory: string): string[] => {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };

    const detectedPatterns: string[] = [];

    const hasExpoRouter = EXPO_ROUTER_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasExpoRouter) {
      detectedPatterns.push(...EXPO_ROUTER_ENTRY_PATTERNS);
    } else {
      const hasExpo = EXPO_ENABLERS.some((enabler) => enabler in allDependencies);
      if (hasExpo) {
        detectedPatterns.push(...EXPO_ENTRY_PATTERNS);
      }
    }

    const hasReactNative = REACT_NATIVE_ENABLERS.some((enabler) => enabler in allDependencies);
    if (hasReactNative) {
      detectedPatterns.push(...REACT_NATIVE_ENTRY_PATTERNS);
    }

    if (detectedPatterns.length === 0) return [];

    return fg.sync(detectedPatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });
  } catch {
    return [];
  }
};
