import fg from "fast-glob";
import { parseJSONC, parseTOML, parseYAML } from "confbox";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { parseSync } from "oxc-parser";
import ts from "typescript";
import type {
  SourceFile,
  ProjectAnalysisConfig,
  ResolvedEntries,
  ViteProjectScope,
} from "../types.js";
import {
  DEFAULT_EXTENSIONS,
  DEFAULT_EXCLUSIONS,
  HIDDEN_DIRECTORY_ALLOWLIST,
  LEGACY_GRAPH_ONLY_PATTERNS,
  SCRIPT_FILE_PATTERN,
  SCRIPT_EXTENSIONLESS_FILE_PATTERN,
  SCRIPT_CONFIG_FILE_PATTERN,
  SHALLOW_WORKSPACE_MAX_DEPTH,
} from "../constants.js";
import { resolveWorkspaces, detectFrameworkEntries } from "./workspaces.js";
import type { WorkspacePackage } from "./workspaces.js";
import { extractExpoConfigPluginEntries } from "./expo-config-plugin-entries.js";
import { resolveSourcePath } from "../resolver/source-path.js";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { extractConfigStringReferencedEntries } from "./config-string-entries.js";
import { extractGraphqlCodegenEntries } from "./graphql-codegen-entries.js";
import { extractTaroPageEntries } from "./taro-page-entries.js";
import { extractSectionsModuleEntries } from "./sections-module-entries.js";
import { extractSiblingWorkspaceImportEntries } from "./sibling-workspace-import-entries.js";
import { extractUmiDvaModelEntries } from "./umi-dva-model-entries.js";
import { extractCoffeeScriptRequireEntries } from "./coffee-script-require-entries.js";
import { extractRuntimeConsumedDirectoryFiles } from "./runtime-consumed-directory-files.js";
import { extractSupabaseFunctionEntries } from "./supabase-function-entries.js";
import { extractStaticGlobbyEntries } from "./static-globby-entries.js";
import { extractNetlifyFunctionEntries } from "./netlify-function-entries.js";
import { extractMuiDocsMetadataEntries } from "./mui-docs-metadata-entries.js";
import { extractWordPressScriptEntries } from "./wordpress-script-entries.js";
import { extractReactEmailTemplateEntries } from "./react-email-template-entries.js";
import { extractPackageJsonEntries, findDefaultIndexEntry } from "./package-json-entries.js";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { toCanonicalPath } from "../../utils/to-canonical-path.js";
import { toPosixPath } from "../utils/to-posix-path.js";
import { extractLocalScriptFileReference } from "../utils/extract-local-script-file-reference.js";
import { collectExecutableMarkdownFilePaths } from "../utils/collect-executable-markdown-file-paths.js";
import { collectStringProperties } from "../utils/collect-string-properties.js";
import { collectHtmlElementAttributes } from "../utils/collect-html-element-attributes.js";
import { evaluateStaticConfig } from "../utils/evaluate-static-config.js";
import { extractScriptInvocations } from "../utils/extract-script-binary-names.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "../utils/oxc-ast-node.js";
import { visitOxcAstWithBindings } from "../utils/visit-oxc-ast-with-bindings.js";

export const collectSourceFiles = async (config: ProjectAnalysisConfig): Promise<SourceFile[]> => {
  const extensions =
    config.includeExtensions.length > 0 ? config.includeExtensions : DEFAULT_EXTENSIONS;

  const extensionGlob =
    extensions.length === 1 ? `**/*${extensions[0]}` : `**/*{${extensions.join(",")}}`;

  const ignorePatterns = [...DEFAULT_EXCLUSIONS, ...config.ignorePatterns].map(toPosixPath);
  const absoluteRoot = resolve(config.rootDir);

  const mainFiles = await fg(extensionGlob, {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

  const allowedHiddenGlobs = HIDDEN_DIRECTORY_ALLOWLIST.flatMap((directory) => [
    `${directory}/**/*{${extensions.join(",")}}`,
    `**/${directory}/**/*{${extensions.join(",")}}`,
  ]);
  const hiddenFiles =
    allowedHiddenGlobs.length > 0
      ? await fg(allowedHiddenGlobs, {
          cwd: absoluteRoot,
          absolute: true,
          ignore: ignorePatterns,
          dot: true,
          onlyFiles: true,
        })
      : [];

  const executableMarkdownFiles = collectExecutableMarkdownFilePaths(absoluteRoot, ignorePatterns);

  const files = [
    ...new Set([...mainFiles, ...hiddenFiles, ...executableMarkdownFiles].map(toPosixPath)),
  ];

  const sortedFiles = files.sort();

  return sortedFiles.map((filePath, fileIndex) => ({
    index: fileIndex,
    path: filePath,
  }));
};

export const getFrameworkExclusions = (rootDir: string): string[] => {
  const absoluteRoot = resolve(rootDir);
  const workspacePackages = resolveWorkspaces(absoluteRoot).packages;
  const directoriesToCheck = [
    absoluteRoot,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ];
  const ignorePatterns: string[] = [];

  for (const directory of directoriesToCheck) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    let allDependencies: Record<string, string> = {};
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
      };
    } catch {
      continue;
    }

    for (const plugin of FRAMEWORK_PATTERNS) {
      if (plugin.contentIgnorePatterns && isToolingPluginEnabled(plugin, allDependencies)) {
        for (const pattern of plugin.contentIgnorePatterns) {
          const absolutePattern = join(directory, pattern);
          ignorePatterns.push(absolutePattern);
        }
      }
    }
  }

  return ignorePatterns;
};

export const resolveEntries = async (config: ProjectAnalysisConfig): Promise<ResolvedEntries> => {
  const absoluteRoot = resolve(config.rootDir);

  const entryFiles =
    config.entryPatterns.length > 0
      ? await fg(config.entryPatterns, {
          cwd: absoluteRoot,
          absolute: true,
          onlyFiles: true,
        })
      : [];

  const packageJsonPath = resolve(absoluteRoot, "package.json");
  const packageJsonEntries = await extractPackageJsonEntries(packageJsonPath);

  const workspaceDiscovery = resolveWorkspaces(absoluteRoot);
  const workspacePackages = workspaceDiscovery.packages;
  const isEntryEligible = (workspacePackage: WorkspacePackage): boolean => {
    if (workspaceDiscovery.hasRootLevelWorkspacePatterns) return true;
    return workspacePackage.depthFromRoot <= SHALLOW_WORKSPACE_MAX_DEPTH;
  };

  const hasDeclaredWorkspaces = workspacePackages.some(
    (workspacePackage) => workspacePackage.isDeclaredWorkspace,
  );

  const workspaceEntries: string[] = [];
  const authoritativeWorkspaceEntries: string[] = [];
  const workspacePublicAssetFiles: string[] = [];
  for (const workspacePackage of workspacePackages) {
    const isEligible = isEntryEligible(workspacePackage);

    const shouldRunFrameworkDetection =
      workspaceDiscovery.hasRootLevelWorkspacePatterns && hasDeclaredWorkspaces
        ? workspacePackage.isDeclaredWorkspace && isEligible
        : isEligible;
    if (shouldRunFrameworkDetection) {
      const workspaceFrameworkEntries = detectFrameworkEntries(workspacePackage.directory);
      workspaceEntries.push(...workspaceFrameworkEntries);
      authoritativeWorkspaceEntries.push(...workspaceFrameworkEntries);
      const workspaceDependencies = readPackageJsonDependencies(
        join(workspacePackage.directory, "package.json"),
      );
      const hasPublicAssetHost = [
        "next",
        "vite",
        "gatsby",
        "astro",
        "nuxt",
        "react-scripts",
        "@sveltejs/kit",
        "@react-router/dev",
        "@remix-run/dev",
      ].some((dependencyName) => dependencyName in workspaceDependencies);
      if (hasPublicAssetHost) {
        workspacePublicAssetFiles.push(
          ...fg.sync("public/**/*", {
            cwd: workspacePackage.directory,
            absolute: true,
            onlyFiles: true,
          }),
        );
      }
    }

    const shouldExtractEntries =
      isEligible &&
      (workspacePackage.isDeclaredWorkspace || !workspaceDiscovery.hasRootLevelWorkspacePatterns);
    if (shouldExtractEntries) {
      const workspacePackageJsonPath = resolve(workspacePackage.directory, "package.json");
      const workspacePackageJsonEntries = await extractPackageJsonEntries(workspacePackageJsonPath);
      const hasValidEntries = workspacePackageJsonEntries.some((entryPath) =>
        existsSync(entryPath),
      );
      if (hasValidEntries) {
        workspaceEntries.push(...workspacePackageJsonEntries);
        authoritativeWorkspaceEntries.push(...workspacePackageJsonEntries);
      } else {
        const defaultFallback = findDefaultIndexEntry(workspacePackage.directory);
        if (defaultFallback) {
          workspaceEntries.push(defaultFallback);
        }
      }
    }
  }

  const frameworkEntries = detectFrameworkEntries(absoluteRoot);

  const entryEligiblePackages = workspacePackages.filter(isEntryEligible);

  const monorepoRootForEntries = findMonorepoRoot(absoluteRoot);
  const ancestorPackageJsonRoots =
    monorepoRootForEntries && monorepoRootForEntries !== absoluteRoot
      ? [monorepoRootForEntries]
      : [];

  const scriptEntries = extractScriptEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    scriptEntries.push(...extractScriptEntries(workspacePackage.directory));
  }
  for (const ancestorRoot of ancestorPackageJsonRoots) {
    for (const entryPath of extractScriptEntries(ancestorRoot)) {
      if (entryPath.startsWith(`${absoluteRoot}/`)) scriptEntries.push(entryPath);
    }
  }

  const webpackEntries = extractWebpackEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    webpackEntries.push(...extractWebpackEntryPoints(workspacePackage.directory));
  }

  const viteProjectScopes = extractViteProjectScopes(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    viteProjectScopes.push(...extractViteProjectScopes(workspacePackage.directory));
  }
  const viteEntries = viteProjectScopes.flatMap((viteProjectScope) => viteProjectScope.entryPaths);

  const bundlerConfigEntries = extractBundlerConfigEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    bundlerConfigEntries.push(...extractBundlerConfigEntryPoints(workspacePackage.directory));
  }

  const htmlScriptEntries = extractHtmlScriptEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    htmlScriptEntries.push(...extractHtmlScriptEntries(workspacePackage.directory));
  }

  const allDiscoveredEntries = [
    ...scriptEntries,
    ...webpackEntries,
    ...viteEntries,
    ...bundlerConfigEntries,
  ];
  for (const entryPath of allDiscoveredEntries) {
    if (entryPath.endsWith(".html") && existsSync(entryPath)) {
      htmlScriptEntries.push(...extractScriptTagsFromHtmlFile(entryPath));
    }
  }

  const angularEntries = extractAngularEntryPoints(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    angularEntries.push(...extractAngularEntryPoints(workspacePackage.directory));
  }

  const browserExtensionEntries = extractBrowserExtensionEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    browserExtensionEntries.push(...extractBrowserExtensionEntries(workspacePackage.directory));
  }

  const webWorkerEntries = extractWebWorkerEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    webWorkerEntries.push(...extractWebWorkerEntries(workspacePackage.directory));
  }

  const tsConfigIncludeEntries = extractTsConfigIncludeFilesEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    tsConfigIncludeEntries.push(...extractTsConfigIncludeFilesEntries(workspacePackage.directory));
  }

  const configStringEntries = extractConfigStringReferencedEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    configStringEntries.push(...extractConfigStringReferencedEntries(workspacePackage.directory));
  }

  const graphqlCodegenEntries = extractGraphqlCodegenEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    const workspaceGraphqlCodegenEntries = extractGraphqlCodegenEntries(workspacePackage.directory);
    graphqlCodegenEntries.schemaEntries.push(...workspaceGraphqlCodegenEntries.schemaEntries);
    graphqlCodegenEntries.documentEntries.push(...workspaceGraphqlCodegenEntries.documentEntries);
    graphqlCodegenEntries.generatedEntries.push(...workspaceGraphqlCodegenEntries.generatedEntries);
  }

  const rootPackageDependencies = readPackageJsonDependencies(join(absoluteRoot, "package.json"));
  const taroPageEntries = extractTaroPageEntries(absoluteRoot, rootPackageDependencies);
  const expoConfigPluginCollection = extractExpoConfigPluginEntries(
    absoluteRoot,
    rootPackageDependencies,
    absoluteRoot,
    false,
  );
  const expoConfigPluginEntries = [...expoConfigPluginCollection.filePaths];
  for (const workspacePackage of entryEligiblePackages) {
    const workspacePackageDependencies = readPackageJsonDependencies(
      join(workspacePackage.directory, "package.json"),
    );
    taroPageEntries.push(
      ...extractTaroPageEntries(workspacePackage.directory, workspacePackageDependencies),
    );
    const workspaceExpoCollection = extractExpoConfigPluginEntries(
      workspacePackage.directory,
      workspacePackageDependencies,
      absoluteRoot,
    );
    expoConfigPluginEntries.push(...workspaceExpoCollection.filePaths);
  }

  const sectionsModuleEntries = extractSectionsModuleEntries(absoluteRoot);

  const coffeeScriptRequireEntries = extractCoffeeScriptRequireEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    coffeeScriptRequireEntries.push(
      ...extractCoffeeScriptRequireEntries(workspacePackage.directory),
    );
  }

  const siblingWorkspaceImportEntries = extractSiblingWorkspaceImportEntries(absoluteRoot);

  const wranglerEntries = extractWranglerEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    wranglerEntries.push(...extractWranglerEntries(workspacePackage.directory));
  }

  const testSetupEntries = extractTestSetupFiles(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    testSetupEntries.push(...extractTestSetupFiles(workspacePackage.directory));
  }

  const pluginFileEntries = extractNextConfigPluginFiles(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    pluginFileEntries.push(...extractNextConfigPluginFiles(workspacePackage.directory));
  }

  const testRunnerDiscovery = discoverTestRunnerEntryPoints(absoluteRoot, entryEligiblePackages);
  const toolingDiscovery = discoverToolingEntryPoints(absoluteRoot, entryEligiblePackages);
  for (const toolingEntry of [...toolingDiscovery.entryFiles]) {
    if (toolingEntry.endsWith(".html")) {
      toolingDiscovery.entryFiles.push(...extractScriptTagsFromHtmlFile(toolingEntry));
    }
  }
  const runtimeConsumedDirectoryFiles = extractRuntimeConsumedDirectoryFiles(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    runtimeConsumedDirectoryFiles.push(
      ...extractRuntimeConsumedDirectoryFiles(workspacePackage.directory),
    );
  }
  const umiDvaModelEntries = extractUmiDvaModelEntries(absoluteRoot, rootPackageDependencies);
  for (const workspacePackage of entryEligiblePackages) {
    umiDvaModelEntries.push(
      ...extractUmiDvaModelEntries(
        workspacePackage.directory,
        readPackageJsonDependencies(join(workspacePackage.directory, "package.json")),
      ),
    );
  }
  const ciEntries = extractCiWorkflowEntries(absoluteRoot);
  const supabaseFunctionEntries = extractSupabaseFunctionEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    supabaseFunctionEntries.push(...extractSupabaseFunctionEntries(workspacePackage.directory));
  }
  const staticGlobbyEntries = extractStaticGlobbyEntries(
    [...packageJsonEntries, ...workspaceEntries, ...frameworkEntries],
    absoluteRoot,
  );
  const netlifyFunctionEntries = extractNetlifyFunctionEntries(absoluteRoot);
  const muiDocsMetadataEntries = extractMuiDocsMetadataEntries(absoluteRoot);
  const wordPressScriptEntries = extractWordPressScriptEntries(absoluteRoot);
  const reactEmailTemplateEntries = extractReactEmailTemplateEntries(absoluteRoot);
  for (const workspacePackage of entryEligiblePackages) {
    reactEmailTemplateEntries.push(...extractReactEmailTemplateEntries(workspacePackage.directory));
  }

  const normalizedEntryPathByPath = new Map<string, string>();
  const normalizeEntryPath = (entryPath: string): string => {
    const cachedEntryPath = normalizedEntryPathByPath.get(entryPath);
    if (cachedEntryPath) return cachedEntryPath;
    const normalizedEntryPath = toPosixPath(toCanonicalPath(entryPath));
    normalizedEntryPathByPath.set(entryPath, normalizedEntryPath);
    return normalizedEntryPath;
  };
  const testEntries = [
    ...new Set([...testRunnerDiscovery.entryFiles, ...testSetupEntries].map(normalizeEntryPath)),
  ];
  const testEntryPathSet = new Set(testEntries);
  const productionEntries = [
    ...new Set(
      [
        ...entryFiles,
        ...packageJsonEntries,
        ...workspaceEntries,
        ...frameworkEntries,
        ...scriptEntries,
        ...webpackEntries,
        ...viteEntries,
        ...bundlerConfigEntries,
        ...htmlScriptEntries,
        ...angularEntries,
        ...browserExtensionEntries,
        ...webWorkerEntries,
        ...tsConfigIncludeEntries,
        ...configStringEntries,
        ...graphqlCodegenEntries.schemaEntries,
        ...taroPageEntries,
        ...expoConfigPluginEntries,
        ...sectionsModuleEntries,
        ...coffeeScriptRequireEntries,
        ...siblingWorkspaceImportEntries,
        ...wranglerEntries,
        ...pluginFileEntries,
        ...toolingDiscovery.entryFiles,
        ...umiDvaModelEntries,
        ...ciEntries,
        ...supabaseFunctionEntries,
        ...staticGlobbyEntries,
        ...netlifyFunctionEntries,
        ...muiDocsMetadataEntries,
        ...wordPressScriptEntries,
        ...reactEmailTemplateEntries,
      ].map(normalizeEntryPath),
    ),
  ].filter((entryPath) => !testEntryPathSet.has(entryPath));
  const authoritativeProductionEntries = [
    ...new Set(
      [
        ...(config.hasExplicitEntryPatterns ? entryFiles : []),
        ...packageJsonEntries,
        ...authoritativeWorkspaceEntries,
        ...frameworkEntries,
        ...scriptEntries,
        ...webpackEntries,
        ...viteEntries,
        ...bundlerConfigEntries,
        ...htmlScriptEntries,
        ...angularEntries,
        ...browserExtensionEntries,
        ...webWorkerEntries,
        ...configStringEntries,
        ...graphqlCodegenEntries.schemaEntries,
        ...taroPageEntries,
        ...expoConfigPluginEntries,
        ...sectionsModuleEntries,
        ...coffeeScriptRequireEntries,
        ...siblingWorkspaceImportEntries,
        ...wranglerEntries,
        ...pluginFileEntries,
        ...toolingDiscovery.entryFiles,
        ...umiDvaModelEntries,
        ...ciEntries,
        ...supabaseFunctionEntries,
        ...staticGlobbyEntries,
        ...netlifyFunctionEntries,
        ...muiDocsMetadataEntries,
        ...wordPressScriptEntries,
        ...reactEmailTemplateEntries,
      ].map(normalizeEntryPath),
    ),
  ].filter((entryPath) => !testEntryPathSet.has(entryPath));
  const alwaysUsedFiles = [
    ...new Set(
      [
        ...toolingDiscovery.alwaysUsedFiles,
        ...testRunnerDiscovery.alwaysUsedFiles,
        ...runtimeConsumedDirectoryFiles,
      ].map(normalizeEntryPath),
    ),
  ];

  const externallyConsumedFiles = [
    ...new Set(graphqlCodegenEntries.documentEntries.map(normalizeEntryPath)),
  ];

  const legacyGraphOnlyFiles = fg.sync(LEGACY_GRAPH_ONLY_PATTERNS, {
    cwd: absoluteRoot,
    absolute: true,
    onlyFiles: true,
    ignore: [...DEFAULT_EXCLUSIONS, ...config.ignorePatterns],
  });

  const analysisExcludedFiles = [
    ...new Set(
      [
        ...graphqlCodegenEntries.generatedEntries,
        ...workspacePublicAssetFiles,
        ...legacyGraphOnlyFiles,
      ].map(normalizeEntryPath),
    ),
  ];

  return {
    productionEntries,
    authoritativeProductionEntries,
    explicitProductionEntries: config.hasExplicitEntryPatterns
      ? entryFiles.map(normalizeEntryPath)
      : [],
    testEntries,
    alwaysUsedFiles,
    externallyConsumedFiles,
    analysisExcludedFiles,
    viteProjectScopes: [
      ...new Map(
        viteProjectScopes.map((viteProjectScope) => [
          viteProjectScope.configPath,
          viteProjectScope,
        ]),
      ).values(),
    ],
  };
};

const SCRIPT_MULTIPLEXERS = new Set([
  "concurrently",
  "run-s",
  "run-p",
  "npm-run-all",
  "npm-run-all2",
  "wireit",
  "turbo",
  "lerna",
  "ultra",
]);

const TSCONFIG_PROJECT_FLAGS = new Set(["--project", "-p"]);

const CONFIG_LIKE_FLAGS = new Set([
  "--config",
  "-c",
  "--format",
  "--formatter",
  "--tsconfig",
  "--project",
  "-p",
  "--setup",
  "--global-setup",
]);

const IGNORED_CLI_TOOLS = new Set([
  "prettier",
  "eslint",
  "tslint",
  "stylelint",
  "biome",
  "oxlint",
  "oxfmt",
  "tsc",
  "tsup",
  "tsdown",
  "rollup",
  "webpack",
  "rimraf",
  "del-cli",
  "shx",
  "cpy-cli",
  "cpx",
  "echo",
  "cat",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "ls",
  "pwd",
  "test",

  "husky",
  "lint-staged",
  "commitlint",
  "changeset",
  "changesets",
  "typedoc",
  "api-extractor",
  "madge",
  "depcheck",
  "sort-package-json",
  "pnpm",
  "npm",
  "yarn",
  "ni",
  "nr",
  "nun",
  "next",
  "nuxt",
  "astro",
  "vite",
  "svelte-kit",
  "prisma",
  "drizzle-kit",
  "formatjs",
  "i18next",
  "i18next-parser",
  "lingui",
  "storybook",
  "chromatic",
  "msw",
  "patch-package",
  "syncpack",
  "manypkg",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "tap",
  "c8",
  "nyc",
  "playwright",
  "cypress",
  "puppeteer",
  "webdriver",
  "sequelize",
  "typeorm",
  "mikro-orm",
  "wait-on",
  "start-server-and-test",
  "remark",
  "markdownlint",
  "markdownlint-cli2",
  "textlint",
  "alex",
  "cspell",
  "ncu",
  "npm-check-updates",
  "size-limit",
  "bundlewatch",
  "dbdocs",
  "lobe-i18n",
  "lobe-seo",
]);

const looksLikeFilePath = (token: string): boolean => {
  if (token.startsWith("-") || token.includes("${{") || token.includes("://")) return false;
  if (token.includes("}}") && !token.includes("{{")) return false;
  const hasKnownExtension =
    /\.(?:[cm]?[jt]sx?|css|scss|json|yaml|yml|toml|html|mjs|cjs|mts|cts|graphql|gql|mdx|astro|vue|svelte)$/.test(
      token,
    );
  if (hasKnownExtension) return true;
  const hasGlobWithExtension = /\.\{[^}]+\}$/.test(token);
  if (hasGlobWithExtension) return true;
  if (token.startsWith("./") || token.startsWith("../")) return true;
  return token.includes("/") && !token.startsWith("@");
};

const isGlobPattern = (token: string): boolean => {
  return token.includes("*") || token.includes("{") || token.includes("?");
};

const extractScriptFileArguments = (scriptCommand: string, directory: string): string[] => {
  const entries: string[] = [];
  for (const invocation of extractScriptInvocations(scriptCommand)) {
    const binaryName = invocation.binaryName;
    if (SCRIPT_MULTIPLEXERS.has(binaryName)) continue;
    const isNonEntryBinary = IGNORED_CLI_TOOLS.has(binaryName);
    const tokens = invocation.argumentValues;

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];

      if (CONFIG_LIKE_FLAGS.has(token)) {
        if (tokenIndex + 1 < tokens.length && !tokens[tokenIndex + 1].startsWith("-")) {
          const configPath = tokens[tokenIndex + 1];
          if (looksLikeFilePath(configPath)) {
            const absoluteConfigPath = resolve(directory, configPath);
            if (existsSync(absoluteConfigPath)) {
              const isTscProjectFlag =
                TSCONFIG_PROJECT_FLAGS.has(token) &&
                TSCONFIG_PROJECT_PATTERN.test(absoluteConfigPath);
              if (isTscProjectFlag) {
                entries.push(...expandTsConfigProjectEntries(absoluteConfigPath));
              } else {
                entries.push(absoluteConfigPath);
              }
            }
          }
          tokenIndex++;
        }
        continue;
      }

      const equalsIndex = token.indexOf("=");
      if (equalsIndex > 0 && CONFIG_LIKE_FLAGS.has(token.slice(0, equalsIndex))) {
        const configValue = token.slice(equalsIndex + 1);
        const flagName = token.slice(0, equalsIndex);
        if (configValue && looksLikeFilePath(configValue)) {
          const absoluteConfigPath = resolve(directory, configValue);
          if (existsSync(absoluteConfigPath)) {
            const isTscProjectFlag =
              TSCONFIG_PROJECT_FLAGS.has(flagName) &&
              TSCONFIG_PROJECT_PATTERN.test(absoluteConfigPath);
            if (isTscProjectFlag) {
              entries.push(...expandTsConfigProjectEntries(absoluteConfigPath));
            } else {
              entries.push(absoluteConfigPath);
            }
          }
        }
        continue;
      }

      if (token.startsWith("-")) continue;

      if (isNonEntryBinary) continue;

      if (!looksLikeFilePath(token)) continue;

      if (isGlobPattern(token)) {
        const expandedFiles = fg.sync(token, {
          cwd: directory,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
        });
        entries.push(...expandedFiles);
      } else {
        const absoluteFilePath = resolve(directory, token);
        if (existsSync(absoluteFilePath)) {
          entries.push(absoluteFilePath);
        } else {
          const sourcePath = resolveSourcePath(absoluteFilePath, directory);
          if (sourcePath) {
            entries.push(sourcePath);
          }
        }
      }
    }
  }

  return entries;
};

const EXTENSIONLESS_SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs"];

const resolveExtensionlessScriptPath = (basePath: string): string | undefined => {
  for (const extension of EXTENSIONLESS_SCRIPT_EXTENSIONS) {
    const candidate = basePath + extension;
    if (existsSync(candidate)) return candidate;
  }
  const indexCandidate = resolve(basePath, "index.ts");
  if (existsSync(indexCandidate)) return indexCandidate;
  return undefined;
};

const parseOxcProgram = (filePath: string, sourceText: string): OxcAstNode | undefined => {
  try {
    const parsedModule = parseSync(filePath, sourceText, { sourceType: "unambiguous" });
    if (parsedModule.errors.some((error) => error.severity === "Error")) return undefined;
    return isOxcAstNode(parsedModule.program) ? parsedModule.program : undefined;
  } catch {
    return undefined;
  }
};

const getOxcStaticString = (value: unknown): string | undefined => {
  if (!isOxcAstNode(value)) return undefined;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (
    value.type === "TemplateLiteral" &&
    Array.isArray(value.expressions) &&
    value.expressions.length === 0 &&
    Array.isArray(value.quasis) &&
    value.quasis.length === 1 &&
    isOxcAstNode(value.quasis[0]) &&
    value.quasis[0].value &&
    typeof value.quasis[0].value === "object" &&
    "cooked" in value.quasis[0].value &&
    typeof value.quasis[0].value.cooked === "string"
  ) {
    return value.quasis[0].value.cooked;
  }
  return undefined;
};

const extractExtensionlessScriptImports = (scriptPath: string): string[] => {
  const entries: string[] = [];
  let sourceText = "";
  try {
    sourceText = readFileSync(scriptPath, "utf-8");
  } catch {
    return entries;
  }
  const program = parseOxcProgram(scriptPath, sourceText);
  if (!program) return entries;
  visitOxcAstWithBindings(program, (node, bindingNames) => {
    if (
      node.type === "CallExpression" &&
      getIdentifierName(node.callee) === "require" &&
      !bindingNames.has("require") &&
      Array.isArray(node.arguments) &&
      node.arguments.length === 1
    ) {
      const requirePath = getOxcStaticString(node.arguments[0]);
      if (requirePath && (requirePath.startsWith("./") || requirePath.startsWith("../"))) {
        const resolvedEntry = resolveEntryWithExtensions(resolve(dirname(scriptPath), requirePath));
        if (resolvedEntry) entries.push(resolvedEntry);
      }
    }
  });
  return entries;
};

const extractScriptEntries = (directory: string): string[] => {
  const packageJsonPath = resolve(directory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  const entries: string[] = [];
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts;
    if (scripts && typeof scripts === "object") {
      for (const scriptCommand of Object.values(scripts)) {
        if (typeof scriptCommand !== "string") continue;

        const localScriptReference = extractLocalScriptFileReference(scriptCommand);
        if (localScriptReference) {
          const localScriptPath = resolve(directory, localScriptReference);
          if (existsSync(localScriptPath)) {
            entries.push(...extractExtensionlessScriptImports(localScriptPath));
          }
        }

        const match = scriptCommand.match(SCRIPT_FILE_PATTERN);
        if (match?.[1]) {
          const scriptFilePath = resolve(directory, match[1]);
          if (existsSync(scriptFilePath)) {
            entries.push(scriptFilePath);
          } else {
            const sourcePath = resolveSourcePath(scriptFilePath, directory);
            if (sourcePath) {
              entries.push(sourcePath);
            }
          }
        } else {
          const extensionlessMatch = scriptCommand.match(SCRIPT_EXTENSIONLESS_FILE_PATTERN);
          if (extensionlessMatch?.[1]) {
            const extensionlessPath = extensionlessMatch[1];
            const resolved = resolveExtensionlessScriptPath(resolve(directory, extensionlessPath));
            if (resolved) {
              entries.push(resolved);
            }
          }
        }

        const configMatch = scriptCommand.match(SCRIPT_CONFIG_FILE_PATTERN);
        if (configMatch?.[1]) {
          const configFilePath = resolve(directory, configMatch[1]);
          if (existsSync(configFilePath)) {
            entries.push(configFilePath);
          } else {
            const sourcePath = resolveSourcePath(configFilePath, directory);
            if (sourcePath) {
              entries.push(sourcePath);
            }
          }
        }

        entries.push(...extractScriptFileArguments(scriptCommand, directory));
      }
    }
  } catch {}

  return entries;
};

const extractCiRunCommands = (content: string): string[] => {
  const workflow = parseYAML<unknown>(content);
  return collectStringProperties(workflow, "run");
};

const extractCiWorkflowEntries = (rootDir: string): string[] => {
  const entries: string[] = [];
  const workflowsDir = join(rootDir, ".github", "workflows");
  if (!existsSync(workflowsDir)) return entries;

  // Standalone tool packages vendored under .github (a workflow `cp`s the
  // directory and runs `npm run build` inside it) reference their scripts
  // through their own package.json, not the workflow yml.
  const nestedToolPackageJsonPaths = fg.sync("**/package.json", {
    cwd: join(rootDir, ".github"),
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
  for (const nestedPackageJsonPath of nestedToolPackageJsonPaths) {
    entries.push(...extractScriptEntries(dirname(nestedPackageJsonPath)));
  }

  const workflowFiles = fg.sync("*.{yml,yaml}", {
    cwd: workflowsDir,
    absolute: true,
    onlyFiles: true,
  });

  for (const workflowFile of workflowFiles) {
    try {
      const content = readFileSync(workflowFile, "utf-8");
      const runCommands = extractCiRunCommands(content);
      for (const command of runCommands) {
        const scriptMatch = command.match(SCRIPT_FILE_PATTERN);
        if (scriptMatch?.[1]) {
          const scriptFilePath = resolve(rootDir, scriptMatch[1]);
          if (existsSync(scriptFilePath)) {
            entries.push(scriptFilePath);
          }
        }
        const configMatch = command.match(SCRIPT_CONFIG_FILE_PATTERN);
        if (configMatch?.[1]) {
          const configFilePath = resolve(rootDir, configMatch[1]);
          if (existsSync(configFilePath)) {
            entries.push(configFilePath);
          }
        }
      }
    } catch {}
  }

  return entries;
};

interface StaticConfigObject {
  [propertyName: string]: unknown;
}

const isStaticConfigObject = (value: unknown): value is StaticConfigObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const collectStaticConfigObjects = (value: unknown): StaticConfigObject[] => {
  if (Array.isArray(value)) return value.flatMap(collectStaticConfigObjects);
  return isStaticConfigObject(value) ? [value] : [];
};

const getStaticConfigValue = (value: unknown, propertyPath: string[]): unknown => {
  let currentValue = value;
  for (const propertyName of propertyPath) {
    if (!isStaticConfigObject(currentValue)) return undefined;
    currentValue = currentValue[propertyName];
  }
  return currentValue;
};

const collectStaticStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStaticStringValues);
  if (!isStaticConfigObject(value)) return [];
  return Object.values(value).flatMap(collectStaticStringValues);
};

const extractViteRoot = (config: unknown, configDirectory: string): string => {
  const rootValue = collectStaticConfigObjects(config)
    .map((configObject) => getStaticConfigValue(configObject, ["root"]))
    .find((value): value is string => typeof value === "string");
  return rootValue
    ? isAbsolute(rootValue)
      ? rootValue
      : resolve(configDirectory, rootValue)
    : configDirectory;
};

const extractViteProjectScopes = (directory: string): ViteProjectScope[] => {
  const viteProjectScopes: ViteProjectScope[] = [];
  const viteConfigPaths = fg.sync("vite.config.{js,ts,mjs,mts}", {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });

  for (const configPath of viteConfigPaths) {
    try {
      const entries: string[] = [];
      const content = readFileSync(configPath, "utf-8");
      const configDirectory = dirname(configPath);
      const config = evaluateStaticConfig(content, configPath);
      const viteRoot = extractViteRoot(config, configDirectory);
      const defaultHtmlEntry = resolve(viteRoot, "index.html");
      if (existsSync(defaultHtmlEntry)) entries.push(defaultHtmlEntry);
      const inputPaths = collectStaticConfigObjects(config).flatMap((configObject) =>
        collectStaticStringValues(
          getStaticConfigValue(configObject, ["build", "rollupOptions", "input"]),
        ),
      );
      for (const entryPath of inputPaths) {
        const absoluteEntryPath = isAbsolute(entryPath)
          ? entryPath
          : resolve(viteRoot, entryPath.replace(/^\//, ""));
        if (existsSync(absoluteEntryPath)) entries.push(absoluteEntryPath);
      }
      viteProjectScopes.push({
        configPath,
        configDirectory,
        rootDirectory: viteRoot,
        entryPaths: entries,
      });
    } catch {}
  }

  return viteProjectScopes;
};

const extractBundlerConfigEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const configPaths = fg.sync(["tsdown.config.{ts,js,cjs,mjs}", "tsup.config.{ts,js,cjs,mjs}"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = evaluateStaticConfig(content, configPath);
      const entryPaths = collectStaticConfigObjects(config).flatMap((configObject) =>
        collectStaticStringValues(getStaticConfigValue(configObject, ["entry"])),
      );
      for (const entryPath of entryPaths) {
        if (entryPath.includes("*")) {
          entries.push(
            ...fg.sync(entryPath, {
              cwd: directory,
              absolute: true,
              onlyFiles: true,
              ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
            }),
          );
          continue;
        }
        const absoluteEntryPath = isAbsolute(entryPath) ? entryPath : resolve(directory, entryPath);
        const resolvedPath = resolveEntryWithExtensions(absoluteEntryPath);
        if (resolvedPath) {
          entries.push(resolvedPath);
        }
      }
    } catch {}
  }

  return entries;
};

const extractLiteralWebpackEntries = (
  sourceText: string,
  configPath: string,
  projectDirectory: string,
): string[] => {
  const entries: string[] = [];
  const staticConfig = evaluateStaticConfig(sourceText, configPath);
  const entryPaths = collectStaticConfigObjects(staticConfig).flatMap((configObject) =>
    collectStaticStringValues(getStaticConfigValue(configObject, ["entry"])),
  );
  for (const entryPath of entryPaths) {
    const absoluteEntryPath = isAbsolute(entryPath)
      ? entryPath
      : resolve(projectDirectory, entryPath);
    const resolvedEntry = resolveEntryWithExtensions(absoluteEntryPath);
    if (resolvedEntry) entries.push(resolvedEntry);
  }
  return entries;
};

const collectWebpackConfigModules = (configPath: string): string[] => {
  const configModulePaths: string[] = [];
  const pendingModulePaths = [configPath];
  const visitedModulePaths = new Set<string>();

  for (let moduleIndex = 0; moduleIndex < pendingModulePaths.length; moduleIndex++) {
    const modulePath = pendingModulePaths[moduleIndex];
    if (visitedModulePaths.has(modulePath)) continue;
    visitedModulePaths.add(modulePath);
    configModulePaths.push(modulePath);

    const sourceFile = ts.createSourceFile(
      modulePath,
      readFileSync(modulePath, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const importedModulePath = resolveEntryWithExtensions(
        resolve(dirname(modulePath), specifier),
      );
      if (importedModulePath) pendingModulePaths.push(importedModulePath);
    }
  }

  return configModulePaths;
};

const extractComputedWebpackEntries = (configPath: string, projectDirectory: string): string[] => {
  const entries: string[] = [];
  for (const modulePath of collectWebpackConfigModules(configPath)) {
    const sourceText = readFileSync(modulePath, "utf-8");
    const sourceFile = ts.createSourceFile(modulePath, sourceText, ts.ScriptTarget.Latest, true);
    const program = parseOxcProgram(modulePath, sourceText);
    if (program) {
      visitOxcAstWithBindings(program, (node, bindingNames) => {
        if (
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression"
        ) {
          return false;
        }
        if (
          node.type !== "CallExpression" ||
          getIdentifierName(node.callee) !== "require" ||
          bindingNames.has("require") ||
          !Array.isArray(node.arguments) ||
          node.arguments.length !== 1
        ) {
          return;
        }
        const requirePath = getOxcStaticString(node.arguments[0]);
        if (!requirePath?.startsWith(".")) return;
        const resolvedEntry = resolveEntryWithExtensions(resolve(dirname(modulePath), requirePath));
        if (resolvedEntry) entries.push(resolvedEntry);
      });
    }
    const objectInitializers = new Map<string, ts.ObjectLiteralExpression>();
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          objectInitializers.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    const exportedObjects = sourceFile.statements.flatMap((statement) => {
      let exportedExpression: ts.Expression | undefined;
      if (ts.isExportAssignment(statement)) {
        exportedExpression = statement.expression;
      } else if (
        ts.isExpressionStatement(statement) &&
        ts.isBinaryExpression(statement.expression) &&
        statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(statement.expression.left) &&
        ts.isIdentifier(statement.expression.left.expression) &&
        statement.expression.left.expression.text === "module" &&
        statement.expression.left.name.text === "exports"
      ) {
        exportedExpression = statement.expression.right;
      }
      if (!exportedExpression) return [];
      if (ts.isObjectLiteralExpression(exportedExpression)) return [exportedExpression];
      if (ts.isIdentifier(exportedExpression)) {
        const objectInitializer = objectInitializers.get(exportedExpression.text);
        return objectInitializer ? [objectInitializer] : [];
      }
      return [];
    });
    for (const exportedObject of exportedObjects) {
      const entryProperty = exportedObject.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === "entry") ||
            (ts.isStringLiteral(property.name) && property.name.text === "entry")),
      );
      const pathSegments: string[] = [];
      if (entryProperty && ts.isCallExpression(entryProperty.initializer)) {
        for (const argument of entryProperty.initializer.arguments) {
          if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
            pathSegments.push(argument.text);
          }
        }
      }
      const entryCallExpression =
        entryProperty && ts.isCallExpression(entryProperty.initializer)
          ? entryProperty.initializer
          : undefined;
      const entryPathObjectName =
        entryCallExpression &&
        ts.isPropertyAccessExpression(entryCallExpression.expression) &&
        ts.isIdentifier(entryCallExpression.expression.expression)
          ? entryCallExpression.expression.expression.text
          : undefined;
      const entryPathMethodName =
        entryCallExpression && ts.isPropertyAccessExpression(entryCallExpression.expression)
          ? entryCallExpression.expression.name.text
          : undefined;
      if (
        !entryProperty ||
        !entryCallExpression ||
        !entryPathObjectName ||
        !entryPathMethodName ||
        !/path/i.test(entryPathObjectName) ||
        pathSegments.length !== entryCallExpression.arguments.length
      ) {
        continue;
      }
      const candidatePaths =
        entryPathObjectName === "path" &&
        (entryPathMethodName === "join" || entryPathMethodName === "resolve")
          ? [resolve(dirname(modulePath), ...pathSegments)]
          : [
              resolve(projectDirectory, entryPathMethodName, ...pathSegments),
              resolve(projectDirectory, "src", entryPathMethodName, ...pathSegments),
            ];
      for (const candidatePath of candidatePaths) {
        const resolvedEntry = resolveEntryWithExtensions(candidatePath);
        if (resolvedEntry) entries.push(resolvedEntry);
      }
    }
  }
  return entries;
};

const extractWebpackEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const webpackConfigPaths = fg.sync(
    [
      "webpack.config.{js,ts,mjs,cjs}",
      "**/webpack*.config.{js,ts,mjs,cjs}",
      "**/webpack.config*.{js,ts,mjs,cjs}",
      "**/webpack*.config*.babel.{js,ts}",
      "**/webpack*.conf.{js,ts,mjs,cjs}",
    ],
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      deep: 3,
    },
  );

  for (const configPath of webpackConfigPaths) {
    try {
      entries.push(...extractComputedWebpackEntries(configPath, directory));
      const content = readFileSync(configPath, "utf-8");
      entries.push(...extractLiteralWebpackEntries(content, configPath, directory));
    } catch {}
  }

  return entries;
};

const HTML_SCRIPT_SOURCE_EXTENSION_PATTERN = /\.(?:ts|tsx|js|jsx|mts|mjs)$/i;

const extractHtmlScriptSources = (content: string): string[] =>
  collectHtmlElementAttributes(content, "script").flatMap((attributes) => {
    const source = attributes.get("src")?.split(/[?#]/, 1)[0];
    return source && HTML_SCRIPT_SOURCE_EXTENSION_PATTERN.test(source) ? [source] : [];
  });

const extractHtmlScriptEntries = (directory: string): string[] => {
  const entries: string[] = [];
  const htmlFiles = fg.sync(["index.html", "*.html"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 1,
  });

  for (const htmlPath of htmlFiles) {
    try {
      const content = readFileSync(htmlPath, "utf-8");
      for (const source of extractHtmlScriptSources(content)) {
        const scriptSrc = source.replace(/^\//, "");
        const htmlDirectory = htmlPath.replace(/\/[^/]+$/, "");
        const absoluteScriptPath = resolve(htmlDirectory, scriptSrc);
        if (existsSync(absoluteScriptPath)) {
          entries.push(absoluteScriptPath);
        }
      }
    } catch {}
  }

  return entries;
};

const extractScriptTagsFromHtmlFile = (htmlFilePath: string): string[] => {
  const entries: string[] = [];
  try {
    const content = readFileSync(htmlFilePath, "utf-8");
    for (const source of extractHtmlScriptSources(content)) {
      const scriptSrc = source.replace(/^\//, "");
      const htmlDirectory = dirname(htmlFilePath);
      const absoluteScriptPath = resolve(htmlDirectory, scriptSrc);
      if (existsSync(absoluteScriptPath)) {
        entries.push(absoluteScriptPath);
      }
    }
  } catch {}
  return entries;
};

const TSCONFIG_FILENAME_GLOBS = ["tsconfig.json", "tsconfig.*.json"];
const TSCONFIG_PROJECT_PATTERN = /(?:^|[\\/])tsconfig(?:\.[^.]+)?\.json$/;

const stripJsoncCommentsLocal = (sourceText: string): string => {
  let result = "";
  let insideString = false;
  let index = 0;
  while (index < sourceText.length) {
    const ch = sourceText[index];
    if (insideString) {
      if (ch === "\\" && index + 1 < sourceText.length) {
        result += sourceText[index] + sourceText[index + 1];
        index += 2;
        continue;
      }
      if (ch === '"') insideString = false;
      result += ch;
      index++;
      continue;
    }
    if (ch === '"') {
      insideString = true;
      result += ch;
      index++;
      continue;
    }
    if (ch === "/" && index + 1 < sourceText.length) {
      if (sourceText[index + 1] === "/") {
        while (index < sourceText.length && sourceText[index] !== "\n") index++;
        continue;
      }
      if (sourceText[index + 1] === "*") {
        index += 2;
        while (
          index + 1 < sourceText.length &&
          !(sourceText[index] === "*" && sourceText[index + 1] === "/")
        )
          index++;
        index += 2;
        continue;
      }
    }
    result += ch;
    index++;
  }
  return result.replace(/,(\s*[}\]])/g, "$1");
};

const extractTsConfigIncludeFilesEntries = (directory: string): string[] => {
  const entries: string[] = [];
  const tsconfigPaths = fg.sync(TSCONFIG_FILENAME_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 1,
  });

  for (const tsconfigPath of tsconfigPaths) {
    try {
      const rawText = readFileSync(tsconfigPath, "utf-8");
      const cleaned = stripJsoncCommentsLocal(rawText);
      const tsconfigJson = JSON.parse(cleaned);
      const tsconfigDir = dirname(tsconfigPath);
      const collectPaths = (rawList: unknown): void => {
        if (!Array.isArray(rawList)) return;
        for (const item of rawList) {
          if (typeof item !== "string") continue;
          if (item.includes("*") || item.includes("?")) continue;
          const candidatePath = resolve(tsconfigDir, item);
          if (existsSync(candidatePath)) {
            entries.push(candidatePath);
          }
        }
      };
      collectPaths(tsconfigJson.include);
      collectPaths(tsconfigJson.files);
    } catch {}
  }

  return entries;
};

const expandTsConfigProjectEntries = (tsconfigAbsolutePath: string): string[] => {
  const entries: string[] = [];
  try {
    const rawText = readFileSync(tsconfigAbsolutePath, "utf-8");
    const cleaned = stripJsoncCommentsLocal(rawText);
    const tsconfigJson = JSON.parse(cleaned);
    const tsconfigDir = dirname(tsconfigAbsolutePath);

    if (Array.isArray(tsconfigJson.files)) {
      for (const fileItem of tsconfigJson.files) {
        if (typeof fileItem !== "string") continue;
        const candidatePath = resolve(tsconfigDir, fileItem);
        if (existsSync(candidatePath)) entries.push(candidatePath);
      }
    }

    if (Array.isArray(tsconfigJson.include)) {
      for (const includePattern of tsconfigJson.include) {
        if (typeof includePattern !== "string") continue;
        const expandedFiles = fg.sync(includePattern, {
          cwd: tsconfigDir,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
        });
        entries.push(...expandedFiles);
      }
    }
  } catch {}
  return entries;
};

const extractWranglerEntries = (directory: string): string[] => {
  const entries: string[] = [];
  const wranglerPaths = fg.sync(["wrangler.toml", "wrangler.json", "wrangler.jsonc"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    deep: 1,
  });

  for (const wranglerPath of wranglerPaths) {
    try {
      const content = readFileSync(wranglerPath, "utf-8");
      const wranglerDir = dirname(wranglerPath);
      const workerConfig = wranglerPath.endsWith(".toml")
        ? parseTOML<unknown>(content)
        : parseJSONC<unknown>(content, { allowTrailingComma: true });
      if (!workerConfig || typeof workerConfig !== "object" || Array.isArray(workerConfig)) {
        continue;
      }
      if ("main" in workerConfig && typeof workerConfig.main === "string") {
        const candidatePath = resolve(wranglerDir, workerConfig.main);
        if (existsSync(candidatePath)) entries.push(candidatePath);
        else {
          const sourceCandidate = resolveSourcePath(candidatePath, wranglerDir);
          if (sourceCandidate) entries.push(sourceCandidate);
        }
      }
      const serviceEntryPoints = collectStringProperties(workerConfig, "entry_point");
      for (const serviceEntryPoint of serviceEntryPoints) {
        const candidatePath = resolve(wranglerDir, serviceEntryPoint);
        if (existsSync(candidatePath)) entries.push(candidatePath);
      }
    } catch {}
  }

  return entries;
};

const WORKER_FILE_GLOBS = [
  "**/*.worker.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
  "**/*.sw.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
  "**/sw.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
  "**/service-worker.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
];

const extractWebWorkerEntries = (directory: string): string[] => {
  const workerFiles = fg.sync(WORKER_FILE_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/out/**"],
    deep: 8,
  });
  return workerFiles;
};

const collectBrowserExtensionManifestPaths = (manifest: unknown): string[] => {
  const candidatePaths: string[] = [];
  if (typeof manifest !== "object" || manifest === null) return candidatePaths;
  const manifestRecord = manifest as Record<string, unknown>;

  const background = manifestRecord.background;
  if (typeof background === "object" && background !== null) {
    const backgroundRecord = background as Record<string, unknown>;
    if (typeof backgroundRecord.service_worker === "string") {
      candidatePaths.push(backgroundRecord.service_worker);
    }
    if (typeof backgroundRecord.page === "string") {
      candidatePaths.push(backgroundRecord.page);
    }
    if (typeof backgroundRecord.scripts === "string") {
      candidatePaths.push(backgroundRecord.scripts);
    }
    if (Array.isArray(backgroundRecord.scripts)) {
      for (const scriptPath of backgroundRecord.scripts) {
        if (typeof scriptPath === "string") candidatePaths.push(scriptPath);
      }
    }
  }

  const contentScripts = manifestRecord.content_scripts;
  if (Array.isArray(contentScripts)) {
    for (const contentScript of contentScripts) {
      if (typeof contentScript !== "object" || contentScript === null) continue;
      const contentScriptRecord = contentScript as Record<string, unknown>;
      if (Array.isArray(contentScriptRecord.js)) {
        for (const scriptPath of contentScriptRecord.js) {
          if (typeof scriptPath === "string") candidatePaths.push(scriptPath);
        }
      }
      if (Array.isArray(contentScriptRecord.css)) {
        for (const stylePath of contentScriptRecord.css) {
          if (typeof stylePath === "string") candidatePaths.push(stylePath);
        }
      }
    }
  }

  const action =
    manifestRecord.action ?? manifestRecord.browser_action ?? manifestRecord.page_action;
  if (typeof action === "object" && action !== null) {
    const actionRecord = action as Record<string, unknown>;
    if (typeof actionRecord.default_popup === "string") {
      candidatePaths.push(actionRecord.default_popup);
    }
  }

  if (typeof manifestRecord.devtools_page === "string") {
    candidatePaths.push(manifestRecord.devtools_page);
  }
  if (typeof manifestRecord.options_page === "string") {
    candidatePaths.push(manifestRecord.options_page);
  }
  if (typeof manifestRecord.options_ui === "object" && manifestRecord.options_ui !== null) {
    const optionsRecord = manifestRecord.options_ui as Record<string, unknown>;
    if (typeof optionsRecord.page === "string") {
      candidatePaths.push(optionsRecord.page);
    }
  }
  if (typeof manifestRecord.sandbox === "object" && manifestRecord.sandbox !== null) {
    const sandboxRecord = manifestRecord.sandbox as Record<string, unknown>;
    if (Array.isArray(sandboxRecord.pages)) {
      for (const pagePath of sandboxRecord.pages) {
        if (typeof pagePath === "string") candidatePaths.push(pagePath);
      }
    }
  }

  return candidatePaths;
};

const isLikelyBrowserExtensionManifest = (manifest: unknown): boolean => {
  if (typeof manifest !== "object" || manifest === null) return false;
  const manifestRecord = manifest as Record<string, unknown>;
  return typeof manifestRecord.manifest_version === "number";
};

const extractBrowserExtensionEntries = (directory: string): string[] => {
  const entries: string[] = [];
  const manifestPaths = fg.sync(
    [
      "manifest.json",
      "manifest.*.json",
      "src/manifest.json",
      "src/manifest.*.json",
      "public/manifest.json",
      "public/manifest.*.json",
      "static/manifest.json",
    ],
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      deep: 3,
    },
  );

  for (const manifestPath of manifestPaths) {
    try {
      const content = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(content);
      if (!isLikelyBrowserExtensionManifest(manifest)) continue;

      const manifestDir = dirname(manifestPath);
      const candidatePaths = collectBrowserExtensionManifestPaths(manifest);
      const resolutionRoots = [manifestDir, resolve(manifestDir, ".."), directory];

      for (const candidatePath of candidatePaths) {
        for (const resolutionRoot of resolutionRoots) {
          const candidateAbsolutePath = resolve(resolutionRoot, candidatePath);
          if (existsSync(candidateAbsolutePath)) {
            entries.push(candidateAbsolutePath);
            break;
          }
          const sourceFile = resolveSourcePath(candidateAbsolutePath, resolutionRoot);
          if (sourceFile) {
            entries.push(sourceFile);
            break;
          }
        }
      }
    } catch {}
  }

  return entries;
};

const ANGULAR_ENTRY_KEYS = ["main", "polyfills", "styles"] as const;

const extractAngularEntryPoints = (directory: string): string[] => {
  const entries: string[] = [];
  const angularJsonPaths = fg.sync(
    ["angular.json", ".angular-cli.json", "**/angular.json", "**/.angular-cli.json"],
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    },
  );

  for (const angularJsonPath of angularJsonPaths) {
    try {
      const content = readFileSync(angularJsonPath, "utf-8");
      const angularConfig = JSON.parse(content);
      const projects = angularConfig.projects ?? {};
      const angularDir = angularJsonPath.replace(/\/[^/]+$/, "");

      for (const projectConfig of Object.values(projects)) {
        const projectRecord = projectConfig as Record<string, unknown>;
        const architect = projectRecord.architect as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (architect) {
          for (const targetConfig of Object.values(architect)) {
            const options = targetConfig.options as Record<string, unknown> | undefined;
            if (!options) continue;

            for (const entryKey of ANGULAR_ENTRY_KEYS) {
              const entryValue = options[entryKey];
              if (typeof entryValue === "string") {
                const absolutePath = resolve(angularDir, entryValue);
                if (existsSync(absolutePath)) {
                  entries.push(absolutePath);
                }
              }
              if (Array.isArray(entryValue)) {
                for (const entryItem of entryValue) {
                  if (typeof entryItem === "string") {
                    const absolutePath = resolve(angularDir, entryItem);
                    if (existsSync(absolutePath)) {
                      entries.push(absolutePath);
                    }
                  }
                }
              }
            }
          }
        }

        const projectRoot = typeof projectRecord.root === "string" ? projectRecord.root : "";
        const projectDir = resolve(angularDir, projectRoot);
        const ngPackagePaths = fg.sync(["ng-package.json", "**/ng-package.json"], {
          cwd: projectDir,
          absolute: true,
          onlyFiles: true,
          deep: 2,
          ignore: ["**/node_modules/**"],
        });
        for (const ngPackagePath of ngPackagePaths) {
          try {
            const ngContent = readFileSync(ngPackagePath, "utf-8");
            const ngPackage = JSON.parse(ngContent);
            const ngDir = ngPackagePath.replace(/\/[^/]+$/, "");
            const libEntry = ngPackage?.lib?.entryFile;
            if (typeof libEntry === "string") {
              const absoluteEntry = resolve(ngDir, libEntry);
              if (existsSync(absoluteEntry)) {
                entries.push(absoluteEntry);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return entries;
};

const NEXT_CONFIG_PLUGIN_EXPORTS_BY_MODULE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["next-intl/plugin", new Set(["createNextIntlPlugin"])],
  ["@next/mdx", new Set(["createMDX"])],
  ["next-contentlayer/hooks", new Set(["withContentlayer"])],
  ["next-contentlayer2/hooks", new Set(["withContentlayer"])],
  ["@plaiceholder/next", new Set(["withPlaiceholder"])],
]);
const NEXT_INTL_DEFAULT_PATHS = [
  "src/i18n/request.ts",
  "src/i18n/request.tsx",
  "src/i18n/request.js",
  "i18n/request.ts",
  "i18n/request.tsx",
  "i18n/request.js",
  "i18n.ts",
  "i18n.tsx",
];

const collectNextConfigPluginFileArguments = (
  sourceText: string,
  configPath: string,
): readonly [ReadonlyArray<string>, boolean] => {
  const program = parseOxcProgram(configPath, sourceText);
  if (!program || !Array.isArray(program.body)) return [[], false];
  const pluginNameByLocalBinding = new Map<string, string>();
  const initializerByLocalBinding = new Map<string, OxcAstNode>();
  const exportedConfigRoots: OxcAstNode[] = [];
  for (const statementValue of program.body) {
    if (!isOxcAstNode(statementValue)) continue;
    if (statementValue.type === "ImportDeclaration") {
      const supportedExports = NEXT_CONFIG_PLUGIN_EXPORTS_BY_MODULE.get(
        getOxcStaticString(statementValue.source) ?? "",
      );
      if (!supportedExports) continue;
      const specifiers = Array.isArray(statementValue.specifiers) ? statementValue.specifiers : [];
      for (const specifier of specifiers) {
        if (!isOxcAstNode(specifier)) continue;
        const localName = getIdentifierName(specifier.local);
        if (!localName) continue;
        if (specifier.type === "ImportDefaultSpecifier" && supportedExports.size === 1) {
          pluginNameByLocalBinding.set(localName, [...supportedExports][0] ?? "");
        }
        if (specifier.type === "ImportSpecifier") {
          const importedName = getIdentifierName(specifier.imported);
          if (importedName && supportedExports.has(importedName)) {
            pluginNameByLocalBinding.set(localName, importedName);
          }
        }
      }
      continue;
    }
    if (statementValue.type === "VariableDeclaration") {
      const declarations = Array.isArray(statementValue.declarations)
        ? statementValue.declarations
        : [];
      for (const declaration of declarations) {
        if (!isOxcAstNode(declaration) || !isOxcAstNode(declaration.init)) continue;
        const localName = getIdentifierName(declaration.id);
        if (localName) initializerByLocalBinding.set(localName, declaration.init);
        if (
          declaration.init.type !== "CallExpression" ||
          getIdentifierName(declaration.init.callee) !== "require" ||
          !Array.isArray(declaration.init.arguments) ||
          declaration.init.arguments.length !== 1
        ) {
          continue;
        }
        const moduleName = getOxcStaticString(declaration.init.arguments[0]);
        const supportedExports = moduleName
          ? NEXT_CONFIG_PLUGIN_EXPORTS_BY_MODULE.get(moduleName)
          : undefined;
        if (localName && supportedExports?.size === 1) {
          pluginNameByLocalBinding.set(localName, [...supportedExports][0] ?? "");
        }
      }
      continue;
    }
    if (
      (statementValue.type === "FunctionDeclaration" ||
        statementValue.type === "ClassDeclaration") &&
      getIdentifierName(statementValue.id)
    ) {
      initializerByLocalBinding.set(getIdentifierName(statementValue.id) ?? "", statementValue);
      continue;
    }
    if (
      statementValue.type === "ExportDefaultDeclaration" &&
      isOxcAstNode(statementValue.declaration)
    ) {
      exportedConfigRoots.push(statementValue.declaration);
      continue;
    }
    if (
      statementValue.type === "ExpressionStatement" &&
      isOxcAstNode(statementValue.expression) &&
      statementValue.expression.type === "AssignmentExpression" &&
      isOxcAstNode(statementValue.expression.left) &&
      statementValue.expression.left.type === "MemberExpression" &&
      getIdentifierName(statementValue.expression.left.object) === "module" &&
      getIdentifierName(statementValue.expression.left.property) === "exports" &&
      isOxcAstNode(statementValue.expression.right)
    ) {
      exportedConfigRoots.push(statementValue.expression.right);
    }
  }
  const filePaths: string[] = [];
  let didCallNextIntlPlugin = false;
  let didCallNextIntlPluginWithPath = false;
  const visitedInitializers = new Set<OxcAstNode>();
  const visitReachableConfig = (root: OxcAstNode): void => {
    visitOxcAstWithBindings(
      root,
      (node, bindingNames, parentNode) => {
        const identifierName = getIdentifierName(node);
        const isNonReferenceIdentifier =
          parentNode?.type === "MemberExpression" &&
          parentNode.property === node &&
          !parentNode.computed;
        if (identifierName && !bindingNames.has(identifierName) && !isNonReferenceIdentifier) {
          const initializer = initializerByLocalBinding.get(identifierName);
          if (initializer && !visitedInitializers.has(initializer)) {
            visitedInitializers.add(initializer);
            visitReachableConfig(initializer);
          }
        }
        if (
          node.type === "CallExpression" &&
          Array.isArray(node.arguments) &&
          isOxcAstNode(node.callee)
        ) {
          const calleeName = getIdentifierName(node.callee);
          const pluginName = calleeName ? pluginNameByLocalBinding.get(calleeName) : undefined;
          const filePath = getOxcStaticString(node.arguments[0]);
          if (calleeName && pluginName && !bindingNames.has(calleeName)) {
            if (filePath !== undefined) filePaths.push(filePath);
            if (pluginName === "createNextIntlPlugin") {
              didCallNextIntlPlugin = true;
              if (filePath !== undefined) didCallNextIntlPluginWithPath = true;
            }
          }
        }
      },
      new Set(),
      false,
    );
  };
  for (const exportedConfigRoot of exportedConfigRoots) {
    visitReachableConfig(exportedConfigRoot);
  }
  return [filePaths, didCallNextIntlPlugin && !didCallNextIntlPluginWithPath];
};

const extractNextConfigPluginFiles = (directory: string): string[] => {
  const entries: string[] = [];
  const nextConfigPaths = fg.sync(["next.config.{ts,js,mjs,mts}"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  for (const configPath of nextConfigPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const configDirectory = dirname(configPath);
      const [pluginFileArguments, shouldUseNextIntlDefaultPath] =
        collectNextConfigPluginFileArguments(content, configPath);
      for (const filePath of pluginFileArguments) {
        const resolvedPluginPath = resolveEntryWithExtensions(resolve(configDirectory, filePath));
        if (resolvedPluginPath) entries.push(resolvedPluginPath);
      }

      if (shouldUseNextIntlDefaultPath) {
        for (const defaultPath of NEXT_INTL_DEFAULT_PATHS) {
          const absolutePath = resolve(configDirectory, defaultPath);
          if (existsSync(absolutePath)) {
            entries.push(absolutePath);
            break;
          }
        }
      }
    } catch {}
  }

  return entries;
};

const extractJestTestMatchPatterns = (directory: string): string[] => {
  const configPaths = fg.sync(["jest.config.{ts,js,mjs,cjs}"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

  if (configPaths.length === 0) {
    try {
      const packageJsonPath = join(directory, "package.json");
      const packageContent = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageContent);
      if (packageJson.jest?.testMatch) {
        return convertJestTestMatchToGlobs(packageJson.jest.testMatch);
      }
    } catch {}
    return [];
  }

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = evaluateStaticConfig(content, configPath);
      const patterns = collectStaticConfigObjects(config).flatMap((configObject) =>
        collectStaticStringValues(getStaticConfigValue(configObject, ["testMatch"])),
      );
      if (patterns.length > 0) {
        return convertJestTestMatchToGlobs(patterns);
      }
    } catch {}
  }
  return [];
};

const convertJestTestMatchToGlobs = (patterns: string[]): string[] => {
  return patterns.map((pattern) => {
    let converted = pattern.replace(/<rootDir>\/?/g, "");
    converted = converted.replace(/\?\(\*\.\)/g, "*.");
    converted = converted.replace(/\?\(([^)]+)\)/g, (_, group: string) => {
      const options = group.includes("|") ? group.split("|") : [group];
      return `{${[...options, ""].join(",")}}`;
    });
    converted = converted.replace(/\+\(([^)]+)\)/g, (_, group: string) => {
      return group.includes("|") ? `{${group.replace(/\|/g, ",")}}` : group;
    });
    converted = converted.replace(/\(([^)]+)\)/g, (_, group: string) => {
      return group.includes("|") ? `{${group.replace(/\|/g, ",")}}` : group;
    });
    return converted;
  });
};

const extractVitestIncludePatterns = (directory: string): string[] => {
  const configPaths = fg.sync(
    [
      "vitest.config.{ts,js,mts,mjs}",
      "vitest.web.config.{ts,js,mts,mjs}",
      "vite.config.{ts,js,mts,mjs}",
      "vite.*.config.{ts,js,mts,mjs}",
    ],
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    },
  );

  const patterns: string[] = [];
  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = evaluateStaticConfig(content, configPath);
      patterns.push(
        ...collectStaticConfigObjects(config).flatMap((configObject) =>
          collectStaticStringValues(getStaticConfigValue(configObject, ["test", "include"])),
        ),
      );
    } catch {}
  }
  return patterns;
};

const TEST_SETUP_PROPERTY_NAMES = [
  "setupFiles",
  "setupFilesAfterEnv",
  "globalSetup",
  "globalTeardown",
];

const extractTestSetupFiles = (directory: string): string[] => {
  const entries: string[] = [];
  const configPaths = fg.sync(
    [
      "vitest.config.{ts,js,mts,mjs}",
      "vitest.web.config.{ts,js,mts,mjs}",
      "vite.config.{ts,js,mts,mjs}",
      "jest.config.{ts,js,mjs,cjs}",
      "**/vitest.config.{ts,js,mts,mjs}",
    ],
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      deep: 3,
    },
  );

  for (const configPath of configPaths) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const config = evaluateStaticConfig(content, configPath);
      const isJestConfig = basename(configPath).startsWith("jest.config.");
      for (const configObject of collectStaticConfigObjects(config)) {
        for (const propertyName of TEST_SETUP_PROPERTY_NAMES) {
          const propertyPath = isJestConfig ? [propertyName] : ["test", propertyName];
          for (const setupPath of collectStaticStringValues(
            getStaticConfigValue(configObject, propertyPath),
          )) {
            const absolutePath = isAbsolute(setupPath)
              ? setupPath
              : resolve(dirname(configPath), setupPath);
            const resolvedPath = resolveEntryWithExtensions(absolutePath);
            if (resolvedPath) entries.push(resolvedPath);
          }
        }
      }
    } catch {}
  }

  return entries;
};

interface TestRunnerDefinition {
  enablers: string[];
  configFileActivators: string[];
  entryPatterns: string[];
  fixturePatterns: string[];
  alwaysUsed: string[];
}

const TEST_FRAMEWORK_PATTERNS: TestRunnerDefinition[] = [
  {
    enablers: ["vitest", "@vitest/runner", "vite-plus"],
    configFileActivators: [
      "vitest.config.ts",
      "vitest.config.js",
      "vitest.config.mts",
      "vitest.config.mjs",
    ],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
      "**/*.bench.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: [
      "vitest.config.{ts,js,mts,mjs}",
      "vitest.setup.{ts,js}",
      "vitest.workspace.{ts,js}",
      "**/src/setupTests.{ts,tsx,js,jsx}",
      "**/src/test-setup.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["jest", "@jest/core", "ts-jest", "react-scripts", "react-app-rewired"],
    configFileActivators: [
      "jest.config.ts",
      "jest.config.js",
      "jest.config.mjs",
      "jest.config.cjs",
    ],
    entryPatterns: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
      "**/__mocks__/**/*.{ts,tsx,js,jsx,mjs,cjs}",
    ],
    fixturePatterns: [
      "**/__fixtures__/**/*.{ts,tsx,js,jsx,json}",
      "**/fixtures/**/*.{ts,tsx,js,jsx,json}",
    ],
    alwaysUsed: ["jest.config.{ts,js,mjs,cjs}", "jest.setup.{ts,js,tsx,jsx}"],
  },
  {
    enablers: ["@playwright/test", "playwright"],
    configFileActivators: ["playwright.config.ts", "playwright.config.js"],
    entryPatterns: [
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "tests/**/*.{ts,tsx,js,jsx}",
      "e2e/**/*.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: ["**/fixtures/**/*.{ts,tsx,js,jsx,json}"],
    alwaysUsed: ["playwright.config.{ts,js}"],
  },
  {
    enablers: ["mocha"],
    configFileActivators: [".mocharc.js", ".mocharc.yaml", ".mocharc.yml", ".mocharc.json"],
    entryPatterns: [
      "test/**/*.{ts,tsx,js,jsx}",
      "tests/**/*.{ts,tsx,js,jsx}",
      "spec/**/*.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [],
    alwaysUsed: [".mocharc.*"],
  },
  {
    enablers: ["jasmine", "jasmine-core", "jasmine-tagged"],
    configFileActivators: ["jasmine.json", "spec/support/jasmine.json"],
    entryPatterns: [
      "spec/**/*.{ts,tsx,js,jsx}",
      "**/*-spec.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: ["**/fixtures/**/*.{ts,tsx,js,jsx,json}"],
    alwaysUsed: ["jasmine.json", "spec/support/jasmine.json"],
  },
  {
    enablers: ["ava", "@ava/typescript"],
    configFileActivators: ["ava.config.js", "ava.config.cjs", "ava.config.mjs"],
    entryPatterns: [
      "test/**/*.{ts,tsx,js,jsx}",
      "tests/**/*.{ts,tsx,js,jsx}",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
    ],
    fixturePatterns: [],
    alwaysUsed: ["ava.config.{js,cjs,mjs}"],
  },
  {
    enablers: ["cypress"],
    configFileActivators: ["cypress.config.ts", "cypress.config.js"],
    entryPatterns: [
      "**/*.cy.{ts,tsx,js,jsx}",
      "cypress/**/*.{ts,tsx,js,jsx}",
      "cypress/support/**/*.{ts,js}",
    ],
    fixturePatterns: ["**/fixtures/**/*.{ts,tsx,js,jsx,json}"],
    alwaysUsed: ["cypress.config.{ts,js}", "cypress.config.*.{ts,js}"],
  },
];

interface ToolingPluginDefinition {
  enablers: string[];
  enablerPrefixes: string[];
  entryPatterns: string[];
  alwaysUsed: string[];
  contentIgnorePatterns?: string[];
}

const JS_TS_COMPONENT_EXTENSIONS = "{ts,tsx,js,jsx}";
const INERTIA_COMPONENT_EXTENSIONS = "{ts,tsx,js,jsx,vue,svelte}";
const VIKE_ROUTE_EXTENSIONS = "{ts,tsx,js,jsx,md,mdx}";

const FRAMEWORK_PATTERNS: ToolingPluginDefinition[] = [
  {
    enablers: ["storybook"],
    enablerPrefixes: ["@storybook/"],
    entryPatterns: ["**/*.stories.{ts,tsx,js,jsx,mdx}", ".storybook/**/*.{ts,tsx,js,jsx}"],
    alwaysUsed: [
      ".storybook/main.{ts,js,mjs,cjs}",
      ".storybook/preview.{ts,tsx,js,jsx}",
      ".storybook/manager.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["msw"],
    enablerPrefixes: [],
    entryPatterns: [
      "mocks/**/*.{ts,tsx,js,jsx}",
      "src/mocks/**/*.{ts,tsx,js,jsx}",
      "**/mocks/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["typeorm"],
    enablerPrefixes: [],
    entryPatterns: [
      "migrations/**/*.{ts,js}",
      "src/migrations/**/*.{ts,js}",
      "src/migration/**/*.{ts,js}",
      "migration/**/*.{ts,js}",
      "src/entity/**/*.{ts,js}",
    ],
    alwaysUsed: ["ormconfig.{ts,js,json}"],
  },
  {
    enablers: ["knex"],
    enablerPrefixes: [],
    entryPatterns: ["migrations/**/*.{ts,js}", "seeds/**/*.{ts,js}"],
    alwaysUsed: ["knexfile.{ts,js}"],
  },
  {
    enablers: ["drizzle-orm"],
    enablerPrefixes: [],
    entryPatterns: ["drizzle/**/*.{ts,js}"],
    alwaysUsed: ["drizzle.config.{ts,js,mjs}"],
  },
  {
    enablers: ["kysely"],
    enablerPrefixes: [],
    entryPatterns: ["migrations/**/*.{ts,js}", "src/migrations/**/*.{ts,js}"],
    alwaysUsed: [],
  },
  {
    enablers: ["prisma", "@prisma/client"],
    enablerPrefixes: [],
    entryPatterns: ["prisma/**/*.{ts,js}", "prisma/seed.{ts,js}"],
    alwaysUsed: [
      "prisma/schema.prisma",
      "schema.prisma",
      "prisma/schema/*.prisma",
      "prisma.config.{ts,mts,cts,js,mjs,cjs}",
      ".config/prisma.{ts,mts,cts,js,mjs,cjs}",
    ],
  },
  {
    enablers: ["@nestjs/core"],
    enablerPrefixes: ["@nestjs/"],
    entryPatterns: [
      "src/main.ts",
      "src/**/*.module.ts",
      "src/**/*.controller.ts",
      "src/**/*.service.ts",
      "src/**/*.guard.ts",
      "src/**/*.interceptor.ts",
      "src/**/*.pipe.ts",
      "src/**/*.filter.ts",
      "src/**/*.middleware.ts",
      "src/**/*.decorator.ts",
      "src/**/*.gateway.ts",
      "src/**/*.resolver.ts",
    ],
    alwaysUsed: ["nest-cli.json"],
  },
  {
    enablers: ["wrangler"],
    enablerPrefixes: ["@cloudflare/"],
    entryPatterns: ["src/index.{ts,js}", "src/worker.{ts,js}", "functions/**/*.{ts,js}"],
    alwaysUsed: [],
  },
  {
    enablers: ["gatsby"],
    enablerPrefixes: ["gatsby-"],
    entryPatterns: [
      "src/pages/**/*.{ts,tsx,js,jsx}",
      "src/templates/**/*.{ts,tsx,js,jsx}",
      "src/api/**/*.{ts,js}",
    ],
    alwaysUsed: [
      "gatsby-config.{ts,js,mjs}",
      "gatsby-node.{ts,js,mjs}",
      "gatsby-browser.{ts,tsx,js,jsx}",
      "gatsby-ssr.{ts,tsx,js,jsx}",
    ],
  },
  {
    enablers: ["@angular/core"],
    enablerPrefixes: ["@angular/"],
    entryPatterns: [
      "src/main.ts",
      "src/app/**/*.ts",
      "src/environments/**/*.ts",
      "src/polyfills.ts",
      "src/test.ts",
    ],
    alwaysUsed: ["angular.json", "**/karma.conf.js"],
  },
  {
    enablers: [
      "@inertiajs/react",
      "@inertiajs/inertia-react",
      "@inertiajs/vue3",
      "@inertiajs/inertia-vue3",
      "@inertiajs/svelte",
      "@inertiajs/inertia-svelte",
      "@inertiajs/inertia",
    ],
    enablerPrefixes: [],
    entryPatterns: [
      `resources/js/app.${INERTIA_COMPONENT_EXTENSIONS}`,
      `resources/js/App.${INERTIA_COMPONENT_EXTENSIONS}`,
      `resources/js/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `resources/js/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `app/frontend/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `app/frontend/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `app/frontend/entrypoints/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `app/javascript/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `app/javascript/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `frontend/src/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `frontend/src/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `inertia/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `inertia/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `src/app.${INERTIA_COMPONENT_EXTENSIONS}`,
      `src/App.${INERTIA_COMPONENT_EXTENSIONS}`,
      `src/Pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
      `src/pages/**/*.${INERTIA_COMPONENT_EXTENSIONS}`,
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["@redwoodjs/router", "@redwoodjs/web"],
    enablerPrefixes: [],
    entryPatterns: [
      `web/src/App.${JS_TS_COMPONENT_EXTENSIONS}`,
      `web/src/Routes.${JS_TS_COMPONENT_EXTENSIONS}`,
      `web/src/index.${JS_TS_COMPONENT_EXTENSIONS}`,
      `web/src/layouts/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
      `web/src/pages/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["react-scripts", "react-app-rewired"],
    enablerPrefixes: [],
    entryPatterns: ["src/index.{ts,tsx,js,jsx}"],
    alwaysUsed: [
      "src/setupProxy.{ts,tsx,js,jsx}",
      "src/setupTests.{ts,tsx,js,jsx}",
      "src/reportWebVitals.{ts,tsx,js,jsx}",
      "src/react-app-env.d.ts",
    ],
  },
  {
    enablers: ["umi", "@umijs/max"],
    enablerPrefixes: [],
    entryPatterns: [
      ".umirc.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "config/config.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "config/config.*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "config/routes*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "config/router.config.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "src/app.{ts,tsx,js,jsx}",
      "src/global.{ts,tsx,js,jsx}",
      "src/loading.{ts,tsx,js,jsx}",
      "src/locales/**/*.{ts,tsx,js,jsx}",
      "mock/**/*.{ts,tsx,js,jsx}",
      "src/pages/**/*.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["@tarojs/cli", "@tarojs/react", "@tarojs/runtime"],
    enablerPrefixes: [],
    entryPatterns: [
      "config/index.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      "src/app.{ts,tsx,js,jsx}",
      "src/app.config.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: [
      "@remix-run/node",
      "@remix-run/react",
      "@remix-run/cloudflare",
      "@react-router/node",
      "@react-router/serve",
      "@react-router/dev",
    ],
    enablerPrefixes: ["@remix-run/", "@react-router/"],
    entryPatterns: [
      "app/routes/**/*.{ts,tsx,js,jsx}",
      "app/root.{ts,tsx,js,jsx}",
      "app/entry.client.{ts,tsx,js,jsx}",
      "app/entry.server.{ts,tsx,js,jsx}",
      "app/routes.{ts,js,mts,mjs}",
      "src/routes.{ts,js,mts,mjs}",
    ],
    alwaysUsed: ["react-router.config.{ts,js,mjs}", "remix.config.{ts,js,mjs}"],
  },
  {
    enablers: ["@docusaurus/core"],
    enablerPrefixes: ["@docusaurus/"],
    entryPatterns: [
      "**/*.mdx",
      "docs/**/*.{md,mdx}",
      "blog/**/*.{md,mdx}",
      "versioned_docs/**/*.{md,mdx}",
      "src/pages/**/*.{ts,tsx,js,jsx}",
      "src/theme/**/*.{ts,tsx,js,jsx}",
      "src/theme/**/index.{ts,tsx,js,jsx}",
      "plugins/**/*.{ts,js,mjs}",
    ],
    alwaysUsed: [
      "docusaurus.config.{ts,js,mjs}",
      "sidebars.{ts,js,mjs,cjs}",
      "sidebar*.{ts,js,mjs,cjs}",
      "*-sidebar.{ts,js,mjs,cjs}",
      "*-sidebars.{ts,js,mjs,cjs}",
      "*Sidebar*.{ts,js,mjs,cjs}",
      "*sidebar*.{ts,js,mjs,cjs}",
    ],
    contentIgnorePatterns: ["versioned_sidebars/**"],
  },
  {
    enablers: ["fumadocs-core", "fumadocs-ui", "fumadocs-mdx"],
    enablerPrefixes: ["fumadocs-"],
    entryPatterns: ["content/**/*.{md,mdx}", "content/**/*.{ts,tsx,js,jsx}"],
    alwaysUsed: ["source.config.{ts,js,mjs}"],
  },
  {
    enablers: ["nextra", "nextra-theme-docs", "nextra-theme-blog"],
    enablerPrefixes: ["nextra-"],
    entryPatterns: ["pages/**/*.{md,mdx}", "src/pages/**/*.{md,mdx}", "content/**/*.{md,mdx}"],
    alwaysUsed: [],
  },
  {
    enablers: ["contentlayer", "contentlayer2", "contentlayer-source-files"],
    enablerPrefixes: ["contentlayer"],
    entryPatterns: ["content/**/*.{md,mdx}", "posts/**/*.{md,mdx}"],
    alwaysUsed: ["contentlayer.config.{ts,js,mjs}"],
  },
  {
    enablers: ["@graphql-codegen/cli", "@graphql-codegen/core"],
    enablerPrefixes: ["@graphql-codegen/"],
    entryPatterns: ["**/*.graphql", "**/*.gql"],
    alwaysUsed: [
      "codegen.{ts,js,yml,yaml}",
      "codegen.config.{ts,js}",
      ".graphqlrc.{ts,js,json,yml,yaml}",
      "graphql.config.{ts,js,json,yml,yaml}",
    ],
  },
  {
    enablers: ["eslint", "@eslint/js"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["eslint.config.{js,mjs,cjs,ts,mts,cts}", ".eslintrc.{js,cjs,mjs,json,yaml,yml}"],
  },
  {
    enablers: ["prettier"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".prettierrc.{js,cjs,mjs,json,yaml,yml}", "prettier.config.{js,mjs,cjs,ts}"],
  },
  {
    enablers: ["tailwindcss", "@tailwindcss/postcss"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tailwind.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["postcss"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["postcss.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["typescript"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tsconfig.json", "tsconfig.*.json"],
  },
  {
    enablers: ["lint-staged"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".lintstagedrc.{js,cjs,mjs,json}", "lint-staged.config.{js,mjs,cjs}"],
  },
  {
    enablers: ["husky"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".husky/**/*"],
  },
  {
    enablers: ["@biomejs/biome"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["biome.json", "biome.jsonc"],
  },
  {
    enablers: ["@commitlint/cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["commitlint.config.{js,cjs,mjs,ts}", ".commitlintrc.{js,cjs,mjs,json,yaml,yml}"],
  },
  {
    enablers: ["semantic-release"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".releaserc.{js,cjs,mjs,json,yaml,yml}", "release.config.{js,cjs,mjs,ts}"],
  },
  {
    enablers: ["@changesets/cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".changeset/**/*"],
  },
  {
    enablers: ["@mui/internal-bundle-size-checker"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["bundle-size-checker.config.{ts,mts,cts,js,mjs,cjs}"],
  },
  {
    enablers: ["next"],
    enablerPrefixes: [],
    entryPatterns: [
      "app/**/page.{ts,tsx,js,jsx}",
      "app/**/layout.{ts,tsx,js,jsx}",
      "app/**/loading.{ts,tsx,js,jsx}",
      "app/**/error.{ts,tsx,js,jsx}",
      "app/**/not-found.{ts,tsx,js,jsx}",
      "app/**/template.{ts,tsx,js,jsx}",
      "app/**/default.{ts,tsx,js,jsx}",
      "app/**/route.{ts,tsx,js,jsx}",
      "app/**/global-error.{ts,tsx,js,jsx}",
      "app/**/forbidden.{ts,tsx,js,jsx}",
      "app/**/unauthorized.{ts,tsx,js,jsx}",
      "app/global-not-found.{ts,tsx,js,jsx}",
      "app/**/opengraph-image.{ts,tsx,js,jsx}",
      "app/**/twitter-image.{ts,tsx,js,jsx}",
      "app/**/icon.{ts,tsx,js,jsx}",
      "app/**/apple-icon.{ts,tsx,js,jsx}",
      "app/**/manifest.{ts,tsx,js,jsx}",
      "app/**/sitemap.{ts,tsx,js,jsx}",
      "app/**/robots.{ts,tsx,js,jsx}",
      "pages/**/*.{ts,tsx,js,jsx}",
      "src/app/**/page.{ts,tsx,js,jsx}",
      "src/app/**/layout.{ts,tsx,js,jsx}",
      "src/app/**/loading.{ts,tsx,js,jsx}",
      "src/app/**/error.{ts,tsx,js,jsx}",
      "src/app/**/not-found.{ts,tsx,js,jsx}",
      "src/app/**/template.{ts,tsx,js,jsx}",
      "src/app/**/default.{ts,tsx,js,jsx}",
      "src/app/**/route.{ts,tsx,js,jsx}",
      "src/app/**/global-error.{ts,tsx,js,jsx}",
      "src/app/**/forbidden.{ts,tsx,js,jsx}",
      "src/app/**/unauthorized.{ts,tsx,js,jsx}",
      "src/app/global-not-found.{ts,tsx,js,jsx}",
      "src/app/**/opengraph-image.{ts,tsx,js,jsx}",
      "src/app/**/twitter-image.{ts,tsx,js,jsx}",
      "src/app/**/icon.{ts,tsx,js,jsx}",
      "src/app/**/apple-icon.{ts,tsx,js,jsx}",
      "src/app/**/manifest.{ts,tsx,js,jsx}",
      "src/app/**/sitemap.{ts,tsx,js,jsx}",
      "src/app/**/robots.{ts,tsx,js,jsx}",
      "src/pages/**/*.{ts,tsx,js,jsx}",
      "middleware.{ts,js}",
      "src/middleware.{ts,js}",
      "proxy.{ts,js}",
      "src/proxy.{ts,js}",
      "instrumentation.{ts,js}",
      "instrumentation-client.{ts,js}",
      "src/instrumentation.{ts,js}",
      "src/instrumentation-client.{ts,js}",
    ],
    alwaysUsed: [
      "next.config.{ts,js,mjs,mts}",
      "next-env.d.ts",
      "mdx-components.{ts,tsx,js,jsx}",
      "src/mdx-components.{ts,tsx,js,jsx}",
      "src/i18n/request.{ts,js}",
      "src/i18n/routing.{ts,js}",
      "i18n/request.{ts,js}",
      "i18n/routing.{ts,js}",
    ],
  },
  {
    enablers: [
      "@tanstack/react-router",
      "@tanstack/react-start",
      "@tanstack/start",
      "@tanstack/solid-router",
      "@tanstack/solid-start",
    ],
    enablerPrefixes: ["@tanstack/router"],
    entryPatterns: [
      "src/routes/**/*.{ts,tsx,js,jsx}",
      "app/routes/**/*.{ts,tsx,js,jsx}",
      "src/server.{ts,tsx,js,jsx}",
      "src/client.{ts,tsx,js,jsx}",
      "src/router.{ts,tsx,js,jsx}",
      "src/routeTree.gen.{ts,js}",
    ],
    alwaysUsed: ["tsr.config.json", "app.config.{ts,js}"],
  },
  {
    enablers: ["waku"],
    enablerPrefixes: [],
    entryPatterns: [
      `src/pages/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
      `src/waku.client.${JS_TS_COMPONENT_EXTENSIONS}`,
      `src/waku.server.${JS_TS_COMPONENT_EXTENSIONS}`,
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["vike", "vite-plugin-ssr"],
    enablerPrefixes: [],
    entryPatterns: [
      `pages/**/*.${VIKE_ROUTE_EXTENSIONS}`,
      `renderer/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
      `src/pages/**/*.${VIKE_ROUTE_EXTENSIONS}`,
      `src/renderer/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
    ],
    alwaysUsed: [],
  },
  {
    enablers: ["rakkasjs"],
    enablerPrefixes: [],
    entryPatterns: [
      `src/client.${JS_TS_COMPONENT_EXTENSIONS}`,
      `src/server.${JS_TS_COMPONENT_EXTENSIONS}`,
      `src/routes/**/*.${JS_TS_COMPONENT_EXTENSIONS}`,
    ],
    alwaysUsed: [],
  },
  {
    enablers: [
      "@module-federation/enhanced",
      "@module-federation/node",
      "@module-federation/vite",
      "@originjs/vite-plugin-federation",
    ],
    enablerPrefixes: [],
    entryPatterns: [
      "federation.config.{ts,js,mjs,cjs,mts,cts}",
      "module-federation.config.{ts,js,mjs,cjs,mts,cts}",
    ],
    alwaysUsed: [],
  },
  {
    enablers: [
      "vite",
      "rolldown-vite",
      "vite-plus",
      "@voidzero-dev/vite-plus-core",
      "@voidzero-dev/vite-plus-test",
    ],
    enablerPrefixes: ["@vitejs/", "@voidzero-dev/vite-plus"],
    entryPatterns: ["src/main.{ts,tsx,js,jsx}", "src/index.{ts,tsx,js,jsx}", "index.html"],
    alwaysUsed: ["vite.config.{ts,js,mts,mjs}"],
  },
  {
    enablers: ["vue", "@vue/cli-service"],
    enablerPrefixes: ["@vue/"],
    entryPatterns: ["src/main.{ts,js}", "src/App.vue"],
    alwaysUsed: ["vue.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["nuxt", "nuxt3"],
    enablerPrefixes: ["@nuxt/"],
    entryPatterns: [
      "pages/**/*.vue",
      "layouts/**/*.vue",
      "components/**/*.vue",
      "composables/**/*.{ts,js}",
      "plugins/**/*.{ts,js}",
      "middleware/**/*.{ts,js}",
      "server/**/*.{ts,js}",
      "app.vue",
    ],
    alwaysUsed: ["nuxt.config.{ts,js,mjs}"],
  },
  {
    enablers: ["svelte", "@sveltejs/kit"],
    enablerPrefixes: ["@sveltejs/"],
    entryPatterns: [
      "src/routes/**/*.svelte",
      "src/lib/**/*.svelte",
      "src/routes/**/+page.{ts,js,svelte}",
      "src/routes/**/+layout.{ts,js,svelte}",
      "src/routes/**/+server.{ts,js}",
    ],
    alwaysUsed: ["svelte.config.{ts,js,mjs}"],
  },
  {
    enablers: ["webpack", "webpack-cli"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["webpack.config.{ts,js,mjs,cjs}", "webpack.*.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["rollup"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["rollup.config.{ts,js,mjs,cjs}", "rollup.*.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["@rspack/core", "@rspack/cli"],
    enablerPrefixes: ["@rspack/"],
    entryPatterns: ["src/index.{ts,tsx,js,jsx}"],
    alwaysUsed: ["rspack.config.{ts,js,mjs,cjs}", "rspack.*.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["@rsbuild/core"],
    enablerPrefixes: ["@rsbuild/"],
    entryPatterns: ["src/index.{ts,tsx,js,jsx}"],
    alwaysUsed: ["rsbuild.config.{ts,js,mjs,cjs}"],
  },
  {
    enablers: ["tsup"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tsup.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["tsdown"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["tsdown.config.{ts,js,cjs,mjs}"],
  },
  {
    enablers: ["@trigger.dev/sdk"],
    enablerPrefixes: ["@trigger.dev/"],
    entryPatterns: [],
    alwaysUsed: ["trigger.config.{ts,js,mjs,mts}"],
  },
  {
    enablers: ["@swc/core"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".swcrc"],
  },
  {
    enablers: ["@babel/core"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["babel.config.{js,cjs,mjs,json}", ".babelrc.{js,cjs,mjs,json}"],
  },
  {
    enablers: ["sanity", "@sanity/cli"],
    enablerPrefixes: ["@sanity/"],
    entryPatterns: [],
    alwaysUsed: ["sanity.config.{ts,js}", "sanity.cli.{ts,js}"],
  },
  {
    enablers: ["astro"],
    enablerPrefixes: ["@astrojs/"],
    entryPatterns: [
      "src/pages/**/*.{astro,ts,tsx,js,jsx,mts,mjs,cts,cjs,md,mdx}",
      "src/content/**/*.{ts,js,mts,mjs,cts,cjs,md,mdx}",
      "src/layouts/**/*.astro",
      "src/middleware.{js,ts,mjs,mts,cjs,cts}",
      "src/middleware/index.{js,ts,mjs,mts,cjs,cts}",
      "src/actions/index.{js,ts,mjs,mts,cjs,cts}",
    ],
    alwaysUsed: [
      "astro.config.{ts,js,mjs,cjs}",
      "src/content/config.{js,ts,mjs,mts,cjs,cts}",
      "src/content.config.{js,ts,mjs,mts,cjs,cts}",
      "src/live.config.{js,ts,mjs,mts,cjs,cts}",
    ],
  },
  {
    enablers: ["i18next", "react-i18next", "vue-i18n", "next-i18next"],
    enablerPrefixes: [],
    entryPatterns: [
      "src/i18n.{ts,js,mjs}",
      "src/i18n/index.{ts,js}",
      "i18n.{ts,js,mjs}",
      "i18n/index.{ts,js}",
    ],
    alwaysUsed: [
      "src/i18n.{ts,js,mjs}",
      "src/i18n/index.{ts,js}",
      "i18n.{ts,js,mjs}",
      "i18n/index.{ts,js}",
      "i18next.config.{js,ts,mjs}",
      "next-i18next.config.{js,mjs}",
      "locales/**/*.json",
      "public/locales/**/*.json",
      "src/locales/**/*.json",
    ],
  },
  {
    enablers: ["turbo"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["turbo.json", "turbo/generators/config.{ts,js}"],
  },
  {
    enablers: ["@sentry/nextjs", "@sentry/react", "@sentry/node", "@sentry/browser"],
    enablerPrefixes: ["@sentry/"],
    entryPatterns: [],
    alwaysUsed: [
      "sentry.client.config.{ts,js,mjs}",
      "sentry.server.config.{ts,js,mjs}",
      "sentry.edge.config.{ts,js,mjs}",
    ],
  },
  {
    enablers: ["nodemon"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["nodemon.json", ".nodemonrc", ".nodemonrc.{json,yml,yaml}"],
  },
  {
    enablers: ["nx"],
    enablerPrefixes: ["@nx/"],
    entryPatterns: [],
    alwaysUsed: ["nx.json", "**/project.json"],
  },
  {
    enablers: ["react-native"],
    enablerPrefixes: ["@react-native/", "@react-native-community/"],
    entryPatterns: ["index.{ts,tsx,js,jsx}", "App.{ts,tsx,js,jsx}", "src/App.{ts,tsx,js,jsx}"],
    alwaysUsed: ["metro.config.{ts,js}", "react-native.config.{ts,js}", "app.json"],
  },
  {
    enablers: ["expo"],
    enablerPrefixes: ["@expo/"],
    entryPatterns: [
      "App.{ts,tsx,js,jsx}",
      "app/_layout.{ts,tsx,js,jsx}",
      "app/index.{ts,tsx,js,jsx}",
    ],
    alwaysUsed: ["app.json", "app.config.{ts,mts,cts,js,mjs,cjs}"],
  },
  {
    enablers: ["wrangler"],
    enablerPrefixes: ["@cloudflare/"],
    entryPatterns: ["src/index.{ts,js}", "src/worker.{ts,js}", "functions/**/*.{ts,js}"],
    alwaysUsed: ["wrangler.toml", "wrangler.json", "wrangler.jsonc"],
  },
  {
    enablers: [
      "electron",
      "electron-builder",
      "@electron-forge/cli",
      "electron-vite",
      "electron-webpack",
      "electron-next",
    ],
    enablerPrefixes: ["@electron-forge/", "@electron/"],
    entryPatterns: [
      "src/main/**/*.{ts,tsx,js,jsx}",
      "src/preload/**/*.{ts,tsx,js,jsx}",
      "electron/main.{ts,js}",
      "main/index.{ts,tsx,js,jsx}",
      "renderer/pages/**/*.{ts,tsx,js,jsx}",
      "static/index.html",
    ],
    alwaysUsed: [
      "electron-builder.{yml,yaml,json,json5,toml}",
      "forge.config.{ts,js,cjs}",
      "electron.vite.config.{ts,js,mjs}",
    ],
  },

  {
    enablers: ["lefthook"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: ["lefthook.yml", "lefthook.yaml", ".lefthook.yml"],
  },
  {
    enablers: ["syncpack"],
    enablerPrefixes: [],
    entryPatterns: [],
    alwaysUsed: [".syncpackrc", ".syncpackrc.{json,yaml,yml}", "syncpack.config.{js,mjs,cjs}"],
  },

  {
    enablers: ["@capacitor/core", "@capacitor/cli"],
    enablerPrefixes: ["@capacitor/"],
    entryPatterns: [],
    alwaysUsed: ["capacitor.config.{ts,js,json}"],
  },
];

const detectNodeTestRunner = (directory: string): boolean => {
  try {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) return false;
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts ?? {};
    return Object.values(scripts).some(
      (scriptValue) => typeof scriptValue === "string" && /\bnode\b.*\s--test\b/.test(scriptValue),
    );
  } catch {
    return false;
  }
};

const detectBunTestRunner = (directory: string): boolean => {
  try {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) return false;
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts ?? {};
    return Object.values(scripts).some(
      (scriptValue) => typeof scriptValue === "string" && /\bbun\s+test\b/.test(scriptValue),
    );
  } catch {
    return false;
  }
};

interface TestRunnerDiscoveryResult {
  entryFiles: string[];
  alwaysUsedFiles: string[];
}

const readPackageJsonDependencies = (packageJsonPath: string): Record<string, string> => {
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

const discoverTestRunnerEntryPoints = (
  rootDir: string,
  workspacePackages: WorkspacePackage[],
): TestRunnerDiscoveryResult => {
  const allEntries: string[] = [];
  const allAlwaysUsed: string[] = [];
  const directoriesToCheck = [
    rootDir,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ];

  const monorepoRoot = findMonorepoRoot(rootDir);
  const monorepoRootDeps =
    monorepoRoot && monorepoRoot !== rootDir
      ? readPackageJsonDependencies(join(monorepoRoot, "package.json"))
      : {};

  for (const directory of directoriesToCheck) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    let allDependencies: Record<string, string> = {};
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
      };
    } catch {
      continue;
    }

    const activatedPatterns: string[] = [];
    const activatedFixturePatterns: string[] = [];
    const activatedAlwaysUsed: string[] = [];

    const isRunnerEnabled = (
      runner: TestRunnerDefinition,
      dependencies: Record<string, string>,
      checkDirectory: string,
    ): boolean => {
      const hasDependency = runner.enablers.some((enabler) => {
        return enabler in dependencies;
      });
      if (hasDependency) return true;
      return runner.configFileActivators.some((configFile) =>
        existsSync(join(checkDirectory, configFile)),
      );
    };

    for (const runner of TEST_FRAMEWORK_PATTERNS) {
      const enabledLocally = isRunnerEnabled(runner, allDependencies, directory);
      const enabledViaMonorepo =
        !enabledLocally &&
        monorepoRoot &&
        (isRunnerEnabled(runner, monorepoRootDeps, monorepoRoot) ||
          runner.configFileActivators.some((configFile) =>
            existsSync(join(monorepoRoot, configFile)),
          ));
      if (enabledLocally || enabledViaMonorepo) {
        const isVitestRunner = runner.enablers.includes("vitest");
        const isJestRunner = runner.enablers.includes("jest");
        let customPatterns: string[] = [];
        if (isVitestRunner) {
          customPatterns = extractVitestIncludePatterns(directory);
          if (customPatterns.length === 0 && monorepoRoot) {
            customPatterns = extractVitestIncludePatterns(monorepoRoot);
          }
        } else if (isJestRunner) {
          customPatterns = extractJestTestMatchPatterns(directory);
          if (customPatterns.length === 0 && monorepoRoot) {
            customPatterns = extractJestTestMatchPatterns(monorepoRoot);
          }
        }
        if (customPatterns.length > 0) {
          activatedPatterns.push(...customPatterns);
          // A custom `testMatch` narrows which SPEC files run, but Jest's
          // `__mocks__` automock convention is independent of it — those
          // files stay runner-consumed entries no matter what testMatch says.
          if (isJestRunner) {
            activatedPatterns.push("**/__mocks__/**/*.{ts,tsx,js,jsx,mjs,cjs}");
          }
        } else {
          activatedPatterns.push(...runner.entryPatterns);
        }
        activatedFixturePatterns.push(...runner.fixturePatterns);
        activatedAlwaysUsed.push(...runner.alwaysUsed);
      }
    }

    if (activatedPatterns.length === 0 && directory !== rootDir) {
      const rootPackageJsonPath = join(rootDir, "package.json");
      if (existsSync(rootPackageJsonPath)) {
        try {
          const rootContent = readFileSync(rootPackageJsonPath, "utf-8");
          const rootPackageJson = JSON.parse(rootContent);
          const rootDeps = {
            ...rootPackageJson.dependencies,
            ...rootPackageJson.devDependencies,
            ...rootPackageJson.optionalDependencies,
          };
          for (const runner of TEST_FRAMEWORK_PATTERNS) {
            if (isRunnerEnabled(runner, rootDeps, rootDir)) {
              activatedPatterns.push(...runner.entryPatterns);
              activatedFixturePatterns.push(...runner.fixturePatterns);
              activatedAlwaysUsed.push(...runner.alwaysUsed);
            }
          }
        } catch {}
      }
    }

    const hasNodeTestScript = detectNodeTestRunner(directory) || detectNodeTestRunner(rootDir);
    if (hasNodeTestScript) {
      activatedPatterns.push(
        "**/*.test.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
        "**/*.spec.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}",
      );
    }

    const hasBunTestScript = detectBunTestRunner(directory) || detectBunTestRunner(rootDir);
    if (hasBunTestScript) {
      activatedPatterns.push(
        "**/*.test.{ts,tsx,js,jsx,mts,mjs}",
        "**/*.spec.{ts,tsx,js,jsx,mts,mjs}",
        "**/*_test.{ts,tsx,js,jsx,mts,mjs}",
        "**/*_spec.{ts,tsx,js,jsx,mts,mjs}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,mjs}",
      );
    }

    if (activatedPatterns.length === 0) continue;

    const uniquePatterns = [...new Set(activatedPatterns)];
    const testFiles = fg.sync(uniquePatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/*.gen.{ts,tsx,js,jsx}"],
    });
    allEntries.push(...testFiles);

    const uniqueFixturePatterns = [...new Set(activatedFixturePatterns)];
    if (uniqueFixturePatterns.length > 0) {
      const fixtureFiles = fg.sync(uniqueFixturePatterns, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      allEntries.push(...fixtureFiles);
    }

    const uniqueAlwaysUsed = [...new Set(activatedAlwaysUsed)];
    if (uniqueAlwaysUsed.length > 0) {
      const alwaysUsedFiles = fg.sync(uniqueAlwaysUsed, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
        dot: true,
      });
      allAlwaysUsed.push(...alwaysUsedFiles);
    }
  }

  return { entryFiles: allEntries, alwaysUsedFiles: allAlwaysUsed };
};

const isToolingPluginEnabled = (
  plugin: ToolingPluginDefinition,
  dependencies: Record<string, string>,
): boolean => {
  if (plugin.enablers.some((enabler) => enabler in dependencies)) return true;
  if (plugin.enablerPrefixes.length > 0) {
    const depNames = Object.keys(dependencies);
    return plugin.enablerPrefixes.some((prefix) =>
      depNames.some((depName) => depName.startsWith(prefix)),
    );
  }
  return false;
};

interface ToolingDiscoveryResult {
  entryFiles: string[];
  alwaysUsedFiles: string[];
}

const FRAMEWORK_SCRIPT_BINARIES: Record<string, string[]> = {
  next: ["next"],
  nuxt: ["nuxt"],
  astro: ["astro"],
  gatsby: ["gatsby"],
  "@remix-run/dev": ["remix"],
  "@react-router/dev": ["react-router"],
  "@sveltejs/kit": ["svelte-kit", "vite-svelte-kit"],
  "@docusaurus/core": ["docusaurus"],
  "@angular/core": ["ng"],
  "@nestjs/core": ["nest"],
  storybook: ["storybook", "start-storybook", "build-storybook"],
  gulp: ["gulp"],
};

const detectFrameworkFromScripts = (scripts: Record<string, unknown> | undefined): Set<string> => {
  const enabledEnablers = new Set<string>();
  if (!scripts || typeof scripts !== "object") return enabledEnablers;
  for (const scriptValue of Object.values(scripts)) {
    if (typeof scriptValue !== "string") continue;
    const tokenized = scriptValue.split(/[\s|&;]+/);
    for (const token of tokenized) {
      const cleaned = token.replace(/^.*\//, "");
      for (const [enabler, binaries] of Object.entries(FRAMEWORK_SCRIPT_BINARIES)) {
        if (binaries.includes(cleaned)) enabledEnablers.add(enabler);
      }
    }
  }
  return enabledEnablers;
};

const readPackageScripts = (directory: string): Record<string, unknown> | undefined => {
  const packageJsonPath = join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    return packageJson.scripts;
  } catch {
    return undefined;
  }
};

const discoverToolingEntryPoints = (
  rootDir: string,
  workspacePackages: WorkspacePackage[],
): ToolingDiscoveryResult => {
  const allEntries: string[] = [];
  const allAlwaysUsed: string[] = [];
  const directoriesToCheck = [
    rootDir,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ];

  let rootDependencies: Record<string, string> = {};
  const rootPackageJsonPath = join(rootDir, "package.json");
  if (existsSync(rootPackageJsonPath)) {
    try {
      const rootContent = readFileSync(rootPackageJsonPath, "utf-8");
      const rootPackageJson = JSON.parse(rootContent);
      rootDependencies = {
        ...rootPackageJson.dependencies,
        ...rootPackageJson.devDependencies,
        ...rootPackageJson.optionalDependencies,
      };
    } catch {}
  }

  const monorepoRoot = findMonorepoRoot(rootDir);
  const monorepoRootDeps =
    monorepoRoot && monorepoRoot !== rootDir
      ? readPackageJsonDependencies(join(monorepoRoot, "package.json"))
      : {};

  for (const directory of directoriesToCheck) {
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;

    let workspaceDependencies: Record<string, string> = {};
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      workspaceDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
      };
    } catch {
      continue;
    }

    const workspaceScripts = readPackageScripts(directory);
    const scriptDetectedEnablers = detectFrameworkFromScripts(workspaceScripts);

    const mergedDependencies: Record<string, string> = {
      ...workspaceDependencies,
    };
    if (directory === rootDir) {
      Object.assign(mergedDependencies, rootDependencies);
    }

    if (scriptDetectedEnablers.has("gulp") && "gulp" in mergedDependencies) {
      allAlwaysUsed.push(
        ...fg.sync("gulpfile.{js,ts,mjs,cjs}", {
          cwd: directory,
          absolute: true,
          onlyFiles: true,
        }),
      );
    }

    for (const enabler of scriptDetectedEnablers) {
      if (
        enabler in workspaceDependencies ||
        enabler in rootDependencies ||
        enabler in monorepoRootDeps
      ) {
        mergedDependencies[enabler] = "*";
      }
    }

    const activatedPatterns: string[] = [];
    const activatedAlwaysUsed: string[] = [];

    for (const plugin of FRAMEWORK_PATTERNS) {
      if (isToolingPluginEnabled(plugin, mergedDependencies)) {
        activatedPatterns.push(...plugin.entryPatterns);
        activatedAlwaysUsed.push(...plugin.alwaysUsed);
      }
    }

    if (activatedPatterns.length === 0 && activatedAlwaysUsed.length === 0) continue;

    const uniquePatterns = [...new Set(activatedPatterns)];
    const toolingFiles = fg.sync(uniquePatterns, {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    });
    allEntries.push(...toolingFiles);

    const uniqueAlwaysUsed = [...new Set(activatedAlwaysUsed)];
    if (uniqueAlwaysUsed.length > 0) {
      const alwaysUsedFiles = fg.sync(uniqueAlwaysUsed, {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
        dot: true,
      });
      allAlwaysUsed.push(...alwaysUsedFiles);
    }
  }

  const rootActivatedGlobalPatterns: string[] = [];
  for (const plugin of FRAMEWORK_PATTERNS) {
    if (isToolingPluginEnabled(plugin, rootDependencies)) {
      for (const pattern of plugin.alwaysUsed) {
        if (!pattern.startsWith("**/")) {
          rootActivatedGlobalPatterns.push(`**/${pattern}`);
        }
      }
    }
  }

  if (rootActivatedGlobalPatterns.length > 0) {
    const globalAlwaysUsedFiles = fg.sync([...new Set(rootActivatedGlobalPatterns)], {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
      dot: true,
    });
    allAlwaysUsed.push(...globalAlwaysUsedFiles);
  }

  return { entryFiles: allEntries, alwaysUsedFiles: allAlwaysUsed };
};
