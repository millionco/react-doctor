import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";

const CONFIG_STRING_ENTRY_GLOBS = [
  "webpack.config.{js,ts,mjs,cjs}",
  "**/webpack*.config.{js,ts,mjs,cjs,babel.js}",
  "**/configs/webpack.config.{js,ts,mjs,cjs,babel.js}",
  "**/configs/webpack*.config.{js,ts,mjs,cjs,babel.js}",
  "jest.config.{js,ts,mjs,cjs,cts}",
  "**/jest.config.{js,ts,mjs,cjs,cts}",
  "vitest.config.{js,ts,mjs,mts}",
  "**/vitest.config.{js,ts,mjs,mts}",
  "**/vitest.*.config.{js,ts,mjs,mts}",
  "vite.config.{js,ts,mjs,mts}",
  "tailwind.config.{js,ts,cjs,mjs}",
  "**/tailwind.config.{js,ts,cjs,mjs}",
  "electron.vite.config.{js,ts,mjs}",
  "electron-builder.config.{js,ts,cjs}",
  "esbuild*.ts",
  "**/esbuild.entrypoints.ts",
  "metro.config.{js,ts}",
  "playwright.config.{js,ts}",
  "cypress.config.{js,ts}",
  "rollup.config.{js,ts,mjs,cjs}",
  "rollup.*.config.js",
  "**/.erb/configs/webpack*.config.{js,ts}",
  "**/.erb/configs/webpack.config.*.{js,ts}",
  "**/astro-tina-directive/register.js",
  "rspack.config.{js,ts,mjs,cjs}",
  "rsbuild.config.{js,ts,mjs,cjs}",
  "**/scripts/build.ts",
  "**/scripts/utils/createJestConfig.js",
];

const CONFIG_RELATIVE_PATH_PATTERN = /['"`]((\.{1,2}\/|\.\.\/)[^'"`\n]+?|\.\/[^'"`\n]+?)['"`]/g;

const JEST_ROOT_DIR_PATH_PATTERN = /<rootDir>\/([^'"`\n]+?)(?:['"`]|$)/g;

const RESOLVE_CALL_PATH_PATTERN = /resolve\s*\(\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const PATH_JOIN_STRING_PATTERN = /path\.(?:join|resolve)\(\s*[^,]+,\s*['"`]([^'"`\n]+?)['"`]/g;

const ENTRY_POINTS_STRING_PATTERN = /entryPoints:\s*\[\s*['"`]([^'"`\n]+?)['"`]/g;

const ADD_PREAMBLE_PATTERN = /addPreamble\s*\(\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const ROLLUP_INPUT_PATTERN = /\binput\s*:\s*['"`]([^'"`\n]+?)['"`]/g;

const VITEST_ENVIRONMENT_PATTERN = /environment\s*:\s*['"`](\.\/[^'"`\n]+?)['"`]/g;

const ASTRO_ENTRYPOINT_PATTERN = /entrypoint\s*:\s*['"`](\.\/[^'"`\n]+?)['"`]/g;

const WEBPACK_PATH_JOIN_ENTRY_PATTERN = /path\.join\(\s*[^,]+,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const WEBPACK_RENDERER_PATH_JOIN_PATTERN =
  /path\.join\(\s*webpackPaths\.srcRendererPath\s*,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const WEBPACK_MAIN_PATH_JOIN_PATTERN =
  /path\.join\(\s*webpackPaths\.srcMainPath\s*,\s*['"`]([^'"`\n]+?)['"`]\s*\)/g;

const BARE_CONFIG_PATH_PATTERN = /['"`](config\/[^'"`\n]+?)['"`]/g;

const stripModuleImportStatements = (content: string): string =>
  content
    .replace(/^\s*import\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"`][^'"`\n]+['"`]\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+['"`][^'"`\n]+['"`]\s*;?\s*$/gm, "");

const shouldSkipConfigPath = (rawPath: string): boolean => {
  if (rawPath.includes("*") || rawPath.includes("?")) return true;
  if (rawPath.endsWith(".json") && !rawPath.includes("/src/")) return true;
  if (rawPath.startsWith("node:")) return true;
  if (rawPath.startsWith("@")) return true;
  return false;
};

const addResolvedConfigPath = (
  rawPath: string,
  configDirectory: string,
  projectRootDirectory: string,
  entries: Set<string>,
): void => {
  if (shouldSkipConfigPath(rawPath)) return;

  const rootDirectory = rawPath.startsWith(".") ? configDirectory : projectRootDirectory;
  const normalizedPath = rawPath.startsWith(".") ? rawPath : `./${rawPath}`;
  const absolutePath = resolve(rootDirectory, normalizedPath);
  const resolvedEntry = resolveEntryWithExtensions(absolutePath);
  if (resolvedEntry) {
    entries.add(resolvedEntry);
    return;
  }

  if (rawPath.startsWith(".")) {
    const projectRootResolvedEntry = resolveEntryWithExtensions(
      resolve(projectRootDirectory, rawPath),
    );
    if (projectRootResolvedEntry) entries.add(projectRootResolvedEntry);
  }
};

const collectResolvedPathsFromStrings = (
  content: string,
  configDirectory: string,
  projectRootDirectory: string,
  entries: Set<string>,
): void => {
  const contentWithoutImports = stripModuleImportStatements(content);

  const patterns = [
    CONFIG_RELATIVE_PATH_PATTERN,
    RESOLVE_CALL_PATH_PATTERN,
    PATH_JOIN_STRING_PATTERN,
    ENTRY_POINTS_STRING_PATTERN,
    ADD_PREAMBLE_PATTERN,
    ROLLUP_INPUT_PATTERN,
    VITEST_ENVIRONMENT_PATTERN,
    ASTRO_ENTRYPOINT_PATTERN,
    WEBPACK_PATH_JOIN_ENTRY_PATTERN,
    BARE_CONFIG_PATH_PATTERN,
  ];

  for (const pattern of patterns) {
    let pathMatch: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((pathMatch = pattern.exec(contentWithoutImports)) !== null) {
      addResolvedConfigPath(pathMatch[1], configDirectory, projectRootDirectory, entries);
    }
  }

  let rendererEntryMatch: RegExpExecArray | null;
  WEBPACK_RENDERER_PATH_JOIN_PATTERN.lastIndex = 0;
  while (
    (rendererEntryMatch = WEBPACK_RENDERER_PATH_JOIN_PATTERN.exec(contentWithoutImports)) !== null
  ) {
    addResolvedConfigPath(
      `src/renderer/${rendererEntryMatch[1]}`,
      configDirectory,
      projectRootDirectory,
      entries,
    );
  }

  let mainEntryMatch: RegExpExecArray | null;
  WEBPACK_MAIN_PATH_JOIN_PATTERN.lastIndex = 0;
  while ((mainEntryMatch = WEBPACK_MAIN_PATH_JOIN_PATTERN.exec(contentWithoutImports)) !== null) {
    addResolvedConfigPath(
      `src/main/${mainEntryMatch[1]}`,
      configDirectory,
      projectRootDirectory,
      entries,
    );
  }

  let rootDirMatch: RegExpExecArray | null;
  JEST_ROOT_DIR_PATH_PATTERN.lastIndex = 0;
  while ((rootDirMatch = JEST_ROOT_DIR_PATH_PATTERN.exec(content)) !== null) {
    addResolvedConfigPath(rootDirMatch[1], configDirectory, projectRootDirectory, entries);
  }
};

export const extractConfigStringReferencedEntries = (directory: string): string[] => {
  const entries = new Set<string>();

  const configPaths = fg.sync(CONFIG_STRING_ENTRY_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 6,
  });

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      collectResolvedPathsFromStrings(content, dirname(configPath), directory, entries);
    } catch {
      continue;
    }
  }

  return [...entries];
};
