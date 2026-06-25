import { resolve, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import fg from "fast-glob";
import type { DependencyGraph, UnusedDependency, DeslopConfig } from "../types.js";
import { IMPLICIT_DEPENDENCIES } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";
import { collectOverrideMappingsFromRecord } from "../utils/collect-override-mappings-from-record.js";
import { collectPnpmWorkspaceOverrideMappings } from "../utils/parse-pnpm-workspace-overrides.js";
import { matchesPackageImportReference } from "../utils/matches-package-import-reference.js";
import { matchesPackageTokenReference } from "../utils/matches-package-token-reference.js";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";

interface OverrideMapping {
  fromPackage: string;
  toPackage: string;
}

interface PackageJsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const discoverAllPackageJsonPaths = (rootDir: string): string[] => {
  const paths = [join(rootDir, "package.json")];
  const workspacePackageJsons = fg.sync("**/package.json", {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    deep: 5,
  });
  for (const workspacePath of workspacePackageJsons) {
    if (workspacePath !== paths[0] && !paths.includes(workspacePath)) {
      paths.push(workspacePath);
    }
  }
  return paths;
};

export const detectStalePackages = (
  graph: DependencyGraph,
  config: DeslopConfig,
): UnusedDependency[] => {
  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: PackageJsonDependencies;

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};

  const declaredDependencies = new Map<string, boolean>();
  for (const dependencyName of Object.keys(dependencies)) {
    declaredDependencies.set(dependencyName, false);
  }
  for (const dependencyName of Object.keys(devDependencies)) {
    declaredDependencies.set(dependencyName, true);
  }

  const declaredNames = new Set(declaredDependencies.keys());
  const usedPackageNames = collectUsedPackages(graph);

  const monorepoRoot = findMonorepoRoot(config.rootDir);
  const nodeModulesSearchRoots =
    monorepoRoot && monorepoRoot !== config.rootDir
      ? [config.rootDir, monorepoRoot]
      : [config.rootDir];

  const allPackageJsonPaths = discoverAllPackageJsonPaths(config.rootDir);
  if (monorepoRoot) {
    const monorepoPackageJson = join(monorepoRoot, "package.json");
    if (!allPackageJsonPaths.includes(monorepoPackageJson) && existsSync(monorepoPackageJson)) {
      allPackageJsonPaths.push(monorepoPackageJson);
    }
  }

  const { binToPackage, packagesProvidingBinary } = buildBinaryPackageIndex(
    nodeModulesSearchRoots,
    declaredNames,
  );

  // Shipping a CLI binary is itself evidence of use — binaries run from
  // Makefiles, CI, git hooks, and `npx`, none of which the static scan sees.
  for (const packageName of packagesProvidingBinary) usedPackageNames.add(packageName);

  for (const workspacePackageJsonPath of allPackageJsonPaths) {
    const scriptReferenced = collectScriptReferencedPackages(
      workspacePackageJsonPath,
      declaredNames,
      binToPackage,
    );
    for (const packageName of scriptReferenced) usedPackageNames.add(packageName);

    const packageJsonConfigReferenced = collectPackageJsonConfigReferences(
      workspacePackageJsonPath,
      declaredNames,
    );
    for (const packageName of packageJsonConfigReferenced) usedPackageNames.add(packageName);
  }

  const nxProjectReferenced = collectNxProjectJsonReferences(
    config.rootDir,
    declaredNames,
    binToPackage,
  );
  for (const packageName of nxProjectReferenced) usedPackageNames.add(packageName);

  const configSearchRoots =
    monorepoRoot && monorepoRoot !== config.rootDir
      ? [config.rootDir, monorepoRoot]
      : [config.rootDir];
  for (const configSearchRoot of configSearchRoots) {
    const configReferenced = collectConfigReferencedPackages(
      configSearchRoot,
      graph,
      declaredNames,
    );
    for (const packageName of configReferenced) usedPackageNames.add(packageName);

    const tsconfigReferenced = collectTsconfigReferencedPackages(configSearchRoot);
    for (const packageName of tsconfigReferenced) usedPackageNames.add(packageName);
  }

  if (hasJsxFiles(graph)) {
    if (declaredNames.has("react")) usedPackageNames.add("react");
    if (declaredNames.has("react-dom")) usedPackageNames.add("react-dom");
    if (declaredNames.has("react-native")) usedPackageNames.add("react-native");
    if (declaredNames.has("react-native-web")) usedPackageNames.add("react-native-web");
  }

  if (declaredNames.has("react-dom")) {
    const webFrameworks = [
      "next",
      "gatsby",
      "@remix-run/react",
      "react-router-dom",
      "vite",
      "@docusaurus/core",
      "react-scripts",
      "astro",
      "@tanstack/react-router",
      "@tanstack/react-start",
      "react-app-rewired",
    ];
    const hasWebFramework = webFrameworks.some(
      (framework) => declaredNames.has(framework) || usedPackageNames.has(framework),
    );
    if (hasWebFramework) usedPackageNames.add("react-dom");
  }

  if (declaredNames.has("react") && declaredNames.has("react-dom")) {
    const packageJsonPath = resolve(config.rootDir, "package.json");
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const peerDeps = packageJson.peerDependencies ?? {};
      if ("react" in peerDeps && declaredDependencies.get("react") === true) {
        usedPackageNames.add("react");
      }
      if ("react-dom" in peerDeps && declaredDependencies.get("react-dom") === true) {
        usedPackageNames.add("react-dom");
      }
    } catch {
      // fall through
    }
  }

  const peerSatisfied = collectPeerSatisfiedPackages(
    nodeModulesSearchRoots,
    declaredNames,
    usedPackageNames,
  );
  for (const packageName of peerSatisfied) usedPackageNames.add(packageName);

  const overrideMappings = collectOverrideMappings(
    configSearchRoots,
    allPackageJsonPaths,
    monorepoRoot,
  );
  for (const { fromPackage, toPackage } of overrideMappings) {
    if (declaredNames.has(toPackage)) usedPackageNames.add(toPackage);
    if (usedPackageNames.has(fromPackage) && declaredNames.has(toPackage)) {
      usedPackageNames.add(toPackage);
    }
  }

  const candidateUnused = new Set<string>();
  for (const [dependencyName] of declaredDependencies) {
    if (isAlwaysConsideredUsed(dependencyName)) continue;
    if (usedPackageNames.has(dependencyName)) continue;
    candidateUnused.add(dependencyName);
  }

  if (candidateUnused.size > 0) {
    const sourceFileRescued = scanSourceFilesForPackageImports(config.rootDir, candidateUnused);
    for (const packageName of sourceFileRescued) {
      usedPackageNames.add(packageName);
      candidateUnused.delete(packageName);
    }
  }

  const unusedDependencies: UnusedDependency[] = [];

  for (const dependencyName of candidateUnused) {
    const isDevDependency = declaredDependencies.get(dependencyName) ?? false;
    const dependencySection = isDevDependency ? "devDependencies" : "dependencies";
    unusedDependencies.push({
      name: dependencyName,
      isDevDependency,
      reason: `"${dependencyName}" is declared in ${dependencySection} but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused`,
    });
  }

  return unusedDependencies;
};

const collectUsedPackages = (graph: DependencyGraph): Set<string> => {
  const usedPackages = new Set<string>();

  for (const module of graph.modules) {
    for (const importInfo of module.imports) {
      const packageName = extractPackageName(importInfo.specifier);
      if (packageName) {
        usedPackages.add(packageName);
      }
    }
  }

  return usedPackages;
};

const hasJsxFiles = (graph: DependencyGraph): boolean =>
  graph.modules.some((module) => {
    const filePath = module.fileId.path;
    return filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  });

const collectPeerSatisfiedPackages = (
  nodeModulesSearchRoots: string[],
  declaredNames: Set<string>,
  confirmedUsedNames: Set<string>,
): Set<string> => {
  const peerSatisfied = new Set<string>();

  for (const installedName of declaredNames) {
    if (!confirmedUsedNames.has(installedName)) continue;

    const installedPackageJsonPath = findInstalledPackageJsonPath(
      installedName,
      nodeModulesSearchRoots,
    );
    if (!installedPackageJsonPath) continue;

    try {
      const content = readFileSync(installedPackageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const peerDeps = packageJson.peerDependencies;
      if (peerDeps && typeof peerDeps === "object") {
        for (const peerName of Object.keys(peerDeps)) {
          if (declaredNames.has(peerName)) {
            peerSatisfied.add(peerName);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return peerSatisfied;
};

const findInstalledPackageJsonPath = (
  packageName: string,
  nodeModulesSearchRoots: string[],
): string | undefined => {
  for (const searchRoot of nodeModulesSearchRoots) {
    const candidatePath = packageName.startsWith("@")
      ? join(searchRoot, "node_modules", ...packageName.split("/"), "package.json")
      : join(searchRoot, "node_modules", packageName, "package.json");
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const SHELL_SPLIT_PATTERN = /\s*(?:&&|\|\||[;&|])\s*/;

const INLINE_ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*=/;

interface BinaryPackageIndex {
  binToPackage: Map<string, string>;
  packagesProvidingBinary: Set<string>;
}

const buildBinaryPackageIndex = (
  nodeModulesSearchRoots: string[],
  declaredNames: Set<string>,
): BinaryPackageIndex => {
  const binToPackage = new Map<string, string>();
  const packagesProvidingBinary = new Set<string>();
  for (const packageName of declaredNames) {
    const packageBinJsonPath = findInstalledPackageJsonPath(packageName, nodeModulesSearchRoots);
    if (!packageBinJsonPath) continue;
    try {
      const binContent = readFileSync(packageBinJsonPath, "utf-8");
      const binPackageJson = JSON.parse(binContent);
      const binField = binPackageJson.bin;
      if (typeof binField === "string" && binField.length > 0) {
        binToPackage.set(packageName.split("/").pop()!, packageName);
        packagesProvidingBinary.add(packageName);
      } else if (typeof binField === "object" && binField !== null) {
        const binaryNames = Object.keys(binField);
        if (binaryNames.length === 0) continue;
        for (const binaryName of binaryNames) {
          binToPackage.set(binaryName, packageName);
        }
        packagesProvidingBinary.add(packageName);
      }
    } catch {
      continue;
    }
  }
  return { binToPackage, packagesProvidingBinary };
};

const collectScriptReferencedPackages = (
  packageJsonPath: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, string>,
): Set<string> => {
  const referenced = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts;
    if (!scripts || typeof scripts !== "object") return referenced;

    for (const scriptCommand of Object.values(scripts)) {
      if (typeof scriptCommand !== "string") continue;
      const commandReferenced = collectCommandReferencedPackages(
        scriptCommand,
        declaredNames,
        binToPackage,
      );
      for (const packageName of commandReferenced) referenced.add(packageName);

      // A dep can appear in a script as a flag argument rather than the
      // leading binary (`jest --testResultsProcessor jest-sonar-reporter`),
      // which the binary matcher above skips. Treat any declared package named
      // as a standalone token anywhere in the command as referenced.
      for (const declaredName of declaredNames) {
        if (referenced.has(declaredName)) continue;
        if (matchesPackageTokenReference(scriptCommand, declaredName)) {
          referenced.add(declaredName);
        }
      }
    }
  } catch {
    return referenced;
  }

  return referenced;
};

const collectCommandReferencedPackages = (
  command: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, string>,
): Set<string> => {
  const referenced = new Set<string>();

  const segments = command.split(SHELL_SPLIT_PATTERN);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/);
    if (tokens.length === 0) continue;

    let binaryIndex = 0;
    while (binaryIndex < tokens.length && INLINE_ENV_VAR_PATTERN.test(tokens[binaryIndex])) {
      binaryIndex++;
    }
    if (binaryIndex >= tokens.length) continue;

    const binaryToken = tokens[binaryIndex].replace(/^.*\//, "");
    const effectiveBinary =
      binaryToken === "npx" || binaryToken === "pnpx" || binaryToken === "bunx"
        ? (tokens[binaryIndex + 1]?.replace(/^.*\//, "") ?? "")
        : binaryToken;

    for (const candidateBinary of [binaryToken, effectiveBinary]) {
      if (!candidateBinary) continue;
      const mappedPackage = binToPackage.get(candidateBinary);
      if (mappedPackage && declaredNames.has(mappedPackage)) {
        referenced.add(mappedPackage);
      }
      if (declaredNames.has(candidateBinary)) {
        referenced.add(candidateBinary);
      }
    }
  }

  return referenced;
};

const CONFIG_FILE_GLOBS = [
  "postcss.config.{js,cjs,mjs,ts}",
  ".babelrc",
  ".babelrc.{js,cjs,mjs,json}",
  "babel.config.{js,cjs,mjs,json,ts}",
  ".eslintrc",
  ".eslintrc.{js,cjs,mjs,json,yaml,yml}",
  ".prettierrc",
  ".prettierrc.{js,cjs,mjs,json,json5,yaml,yml,toml}",
  "prettier.config.{js,cjs,mjs,ts,mts,cts}",
  "eslint.config.{js,cjs,mjs,ts,mts,cts}",
  "webpack.config.{js,ts,mjs,cjs}",
  "**/webpack*.config.{js,ts,mjs,cjs}",
  "**/webpack*.config*.{js,ts,mjs,cjs}",
  "**/webpack*.babel.{js,ts}",
  "vite.config.{js,ts,mjs,mts}",
  "rollup.config.{js,ts,mjs,cjs}",
  ".storybook/main.{js,ts,mjs,cjs}",
  ".storybook/preview.{js,ts,mjs,cjs,tsx,jsx}",
  "docusaurus.config.{js,ts,mjs}",
  "next.config.{js,ts,mjs,mts}",
  "tailwind.config.{js,ts,cjs,mjs}",
  "jest.config.{js,ts,mjs,cjs}",
  "vitest.config.{js,ts,mjs,mts}",
  "app.json",
  "forge.config.{js,ts,cjs}",
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
  "metro.config.{js,ts}",
  "electron.vite.config.{js,ts,mjs}",
  "api-extractor.json",
  "codegen.{ts,js,yml,yaml}",
  ".graphqlrc.{ts,js,json,yml,yaml}",
  "graphql.config.{ts,js,json,yml,yaml}",
  ".lintstagedrc.{js,cjs,mjs,json}",
  "commitlint.config.{js,cjs,mjs,ts}",
  ".commitlintrc.{js,cjs,mjs,json,yaml,yml}",
  "tslint.json",
  ".remarkrc",
  ".remarkrc.{js,cjs,mjs,json}",
  ".dumirc.ts",
  ".dumirc.js",
  "dumi.config.{ts,js}",
];

const collectConfigReferencedPackages = (
  rootDir: string,
  graph: DependencyGraph,
  declaredNames: Set<string>,
): Set<string> => {
  const referenced = new Set<string>();

  for (const module of graph.modules) {
    if (!module.isConfigFile) continue;
    try {
      const content = readFileSync(module.fileId.path, "utf-8");
      for (const packageName of declaredNames) {
        if (content.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  const configFiles = fg.sync(CONFIG_FILE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: true,
    deep: 3,
  });

  for (const configPath of configFiles) {
    try {
      const content = readFileSync(configPath, "utf-8");
      for (const packageName of declaredNames) {
        if (content.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  const documentationFiles = fg.sync(["**/*.{mdx,md}"], {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/CHANGELOG.md"],
    deep: 6,
  });

  for (const documentationPath of documentationFiles) {
    try {
      const content = readFileSync(documentationPath, "utf-8");
      for (const packageName of declaredNames) {
        if (matchesPackageImportReference(content, packageName)) {
          referenced.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  return referenced;
};

const PACKAGE_JSON_CONFIG_SECTIONS = [
  "jest",
  "babel",
  "eslintConfig",
  "prettier",
  "stylelint",
  "lint-staged",
  "commitlint",
  "browserslist",
  "postcss",
  "ava",
  "config",
  "pnpm",
  "resolutions",
  "overrides",
] as const;

const collectOverrideMappingsFromPackageJson = (packageJsonPath: string): OverrideMapping[] => {
  const mappings: OverrideMapping[] = [];

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    const overrideSections = [
      packageJson.overrides,
      packageJson.resolutions,
      packageJson.pnpm?.overrides,
    ];

    for (const overrideSection of overrideSections) {
      if (!overrideSection || typeof overrideSection !== "object") continue;
      mappings.push(...collectOverrideMappingsFromRecord(overrideSection));
    }
  } catch {
    return mappings;
  }

  return mappings;
};

const collectOverrideMappings = (
  configSearchRoots: string[],
  packageJsonPaths: string[],
  monorepoRoot: string | undefined,
): OverrideMapping[] => {
  const mappings: OverrideMapping[] = [];
  const seenMappings = new Set<string>();

  const addMappings = (nextMappings: OverrideMapping[]): void => {
    for (const mapping of nextMappings) {
      const mappingKey = `${mapping.fromPackage}->${mapping.toPackage}`;
      if (seenMappings.has(mappingKey)) continue;
      seenMappings.add(mappingKey);
      mappings.push(mapping);
    }
  };

  for (const packageJsonPath of packageJsonPaths) {
    addMappings(collectOverrideMappingsFromPackageJson(packageJsonPath));
  }

  const workspaceRoots = new Set(configSearchRoots);
  if (monorepoRoot) workspaceRoots.add(monorepoRoot);

  for (const workspaceRoot of workspaceRoots) {
    addMappings(collectPnpmWorkspaceOverrideMappings(workspaceRoot));
  }

  return mappings;
};

const collectPackageJsonConfigReferences = (
  packageJsonPath: string,
  declaredNames: Set<string>,
): Set<string> => {
  const referenced = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    for (const sectionName of PACKAGE_JSON_CONFIG_SECTIONS) {
      const sectionValue = packageJson[sectionName];
      if (!sectionValue || typeof sectionValue !== "object") continue;

      const sectionText = JSON.stringify(sectionValue);
      for (const packageName of declaredNames) {
        if (sectionText.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    }
  } catch {
    return referenced;
  }

  return referenced;
};

const collectNxProjectJsonReferences = (
  rootDir: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, string>,
): Set<string> => {
  const referenced = new Set<string>();

  const projectJsonPaths = fg.sync(["project.json", "**/project.json"], {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 5,
  });

  for (const projectJsonPath of projectJsonPaths) {
    try {
      const content = readFileSync(projectJsonPath, "utf-8");
      const projectJson = JSON.parse(content);
      const projectText = JSON.stringify(projectJson);
      for (const packageName of declaredNames) {
        if (projectText.includes(packageName)) {
          referenced.add(packageName);
        }
      }

      for (const stringValue of collectStringValues(projectJson)) {
        const commandReferenced = collectCommandReferencedPackages(
          stringValue,
          declaredNames,
          binToPackage,
        );
        for (const packageName of commandReferenced) referenced.add(packageName);
      }
    } catch {
      continue;
    }
  }

  return referenced;
};

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value).flatMap(collectStringValues);
};

const TSCONFIG_GLOBS = [
  "tsconfig.json",
  "tsconfig.*.json",
  "jsconfig.json",
  "**/tsconfig.json",
  "**/tsconfig.*.json",
];

const collectTsconfigReferencedPackages = (rootDir: string): Set<string> => {
  const referenced = new Set<string>();

  const tsconfigFiles = fg.sync(TSCONFIG_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
    dot: false,
    deep: 4,
  });

  for (const tsconfigPath of tsconfigFiles) {
    try {
      const content = readFileSync(tsconfigPath, "utf-8");
      const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const parsed = JSON.parse(cleaned);

      if (typeof parsed.extends === "string") {
        const extendsPackage = extractExtendsPackageName(parsed.extends);
        if (extendsPackage) referenced.add(extendsPackage);
      }
      if (Array.isArray(parsed.extends)) {
        for (const extendsEntry of parsed.extends) {
          if (typeof extendsEntry === "string") {
            const extendsPackage = extractExtendsPackageName(extendsEntry);
            if (extendsPackage) referenced.add(extendsPackage);
          }
        }
      }

      const compilerOptions = parsed.compilerOptions;
      if (compilerOptions?.jsxImportSource && typeof compilerOptions.jsxImportSource === "string") {
        referenced.add(compilerOptions.jsxImportSource);
      }
      if (Array.isArray(compilerOptions?.types)) {
        for (const typesEntry of compilerOptions.types) {
          if (typeof typesEntry === "string") {
            const typesPackage = extractPackageName(typesEntry);
            if (typesPackage) referenced.add(typesPackage);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return referenced;
};

const extractExtendsPackageName = (extendsValue: string): string | undefined => {
  if (extendsValue.startsWith(".") || extendsValue.startsWith("/")) return undefined;
  if (extendsValue.startsWith("@")) {
    const parts = extendsValue.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return extendsValue.split("/")[0];
};

const SOURCE_FILE_GLOBS = ["**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}"];

const SOURCE_FILE_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.d.ts",
];

const scanSourceFilesForPackageImports = (
  rootDir: string,
  candidatePackages: Set<string>,
): Set<string> => {
  const found = new Set<string>();
  if (candidatePackages.size === 0) return found;

  const sourceFiles = fg.sync(SOURCE_FILE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: SOURCE_FILE_IGNORES,
    deep: 15,
  });

  for (const filePath of sourceFiles) {
    if (candidatePackages.size === 0) break;
    try {
      const content = readFileSync(filePath, "utf-8");
      for (const packageName of candidatePackages) {
        if (matchesPackageImportReference(content, packageName)) {
          found.add(packageName);
          candidatePackages.delete(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  return found;
};

const ALWAYS_USED_PREFIXES = [
  "@types/",
  "eslint-config-",
  "eslint-plugin-",
  "@eslint/",
  "prettier-plugin-",
  "@commitlint/",
  "babel-plugin-",
  "babel-preset-",
  "@babel/plugin-",
  "@babel/preset-",
  "@fontsource/",
  "@next/",
  "@svgr/",
  "@docusaurus/",
  "stylelint-config-",
  "stylelint-plugin-",
  "@testing-library/",
  "@vitest/",
  "@playwright/",
  "@storybook/",
  "jest-environment-",
  "@graphql-codegen/",
  "@size-limit/",
  "@nestjs/",
  "@swc/",
  "@electron-forge/",
  "@parcel/",
  "@wyw-in-js/",
  "@typescript-eslint/",
  "@react-native/",
  "@react-native-community/",
  "postcss-",
  "@tailwindcss/",
  "rollup-plugin-",
  "@rollup/",
  "vite-plugin-",
  "@vitejs/",
  "webpack-",
  "esbuild-",
  "@esbuild-plugins/",
  "@lingui/",
  "@emotion/",
  "tslint-config-",
  "eslint-import-resolver-",
  "@changesets/",
  "@react-navigation/",
  "@vercel/",
  "@expo/",
  "expo-",
  "react-native-",
];

const ALWAYS_USED_SUFFIXES = ["-loader"];

const isAlwaysConsideredUsed = (dependencyName: string): boolean => {
  if (IMPLICIT_DEPENDENCIES.has(dependencyName)) return true;
  if (ALWAYS_USED_PREFIXES.some((prefix) => dependencyName.startsWith(prefix))) return true;
  if (ALWAYS_USED_SUFFIXES.some((suffix) => dependencyName.endsWith(suffix))) return true;
  return false;
};
