import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import fg from "fast-glob";
import { satisfies, validRange } from "semver";
import type {
  DependencyGraph,
  ProjectAnalysisConfig,
  PackageLockPackageMetadata,
  PeerSatisfiedPackageCollection,
  SkippedDependency,
  SkippedDependencyReason,
  UnusedDependency,
} from "../types.js";
import { IMPLICIT_DEPENDENCIES, TOOLING_SOURCE_MAX_DEPTH } from "../constants.js";
import { extractPackageName } from "../utils/package-name.js";
import {
  collectOverrideMappingsFromRecord,
  type OverrideMapping,
} from "../utils/collect-override-mappings-from-record.js";
import { collectPnpmWorkspaceOverrideMappings } from "../utils/parse-pnpm-workspace-overrides.js";
import { collectPackageLockPackageMetadata } from "../utils/collect-package-lock-package-metadata.js";
import { collectPackageImportNames } from "../utils/matches-package-import-reference.js";
import { collectPackageConfigReferences } from "../utils/matches-package-config-reference.js";
import { extractScriptBinaryNames } from "../utils/extract-script-binary-names.js";
import { extractLocalScriptFileReference } from "../utils/extract-local-script-file-reference.js";
import { hasHtmlSassStylesheetReference } from "../utils/has-html-sass-stylesheet-reference.js";
import { matchesPackageCliOptionReference } from "../utils/matches-package-cli-option-reference.js";
import { matchesNodeModulesPackageReference } from "../utils/matches-node-modules-package-reference.js";
import { matchesExecutableNodeModulesPackageReference } from "../utils/matches-executable-node-modules-package-reference.js";
import { matchesIconifyCollectionReference } from "../utils/matches-iconify-collection-reference.js";
import { collectStylesheetImportSpecifiers } from "../utils/collect-stylesheet-import-specifiers.js";
import { collectBindingGypPackageReferences } from "../utils/collect-binding-gyp-package-references.js";
import { collectMarkdownModulePackageNames } from "../utils/collect-markdown-module-package-names.js";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { extractExpoConfigPluginEntries } from "../collect/expo-config-plugin-entries.js";
import { resolveWorkspaces } from "../collect/workspaces.js";
import { extractKarmaConfigPackageReferences } from "../utils/extract-karma-config-package-references.js";
import { hasExpoReactServerFunctions } from "../utils/has-expo-react-server-functions.js";
import { hasAntfuEslintReactConfig } from "../utils/has-antfu-eslint-react-config.js";
import { collectExecutableMarkdownFilePaths } from "../utils/collect-executable-markdown-file-paths.js";
import { collectStencilCompanionPackageNames } from "../utils/collect-stencil-companion-package-names.js";
import { hasSanityV2CoreContract } from "../utils/has-sanity-v2-core-contract.js";
import { collectSanityV2PackageNames } from "../utils/collect-sanity-v2-package-names.js";
import { collectReactNativeConfigPackageNames } from "../utils/collect-react-native-config-package-names.js";
import { collectInstalledAgentSkillPackageNames } from "../utils/collect-installed-agent-skill-package-names.js";
import { collectHtmlScriptPackageNames } from "../utils/collect-html-script-package-names.js";
import { hasEnabledNextOptimizeCss } from "../utils/has-enabled-next-optimize-css.js";
import { parseTypeScriptConfig } from "../utils/parse-typescript-config.js";
import {
  expandBuildScriptPaths,
  extractInvokedBuildScriptPaths,
} from "../collect/build-script-consumed-files.js";

interface PackageFileGlobOptions {
  readonly ignore: ReadonlyArray<string>;
  readonly deep: number;
  readonly dot?: boolean;
}

const globPackageFiles = (
  cwd: string,
  patterns: ReadonlyArray<string>,
  options: PackageFileGlobOptions,
): string[] =>
  fg.sync([...patterns], {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: [...options.ignore],
    deep: options.deep,
    ...(options.dot === undefined ? {} : { dot: options.dot }),
  });

const matchPackageNamesInFile = (
  filePath: string,
  names: ReadonlySet<string>,
  matcher: (content: string, packageName: string) => boolean,
): string[] => {
  const content = readFileSync(filePath, "utf-8");
  const matchedNames: string[] = [];
  for (const packageName of names) {
    if (matcher(content, packageName)) matchedNames.push(packageName);
  }
  return matchedNames;
};

const collectDeclaredPackageNamesInFile = (
  filePath: string,
  names: ReadonlySet<string>,
  collector: (content: string) => ReadonlySet<string>,
): string[] => {
  const referencedPackageNames = collector(readFileSync(filePath, "utf-8"));
  return [...referencedPackageNames].filter((packageName) => names.has(packageName));
};

interface PackageJsonDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, unknown>;
}

const discoverAllPackageJsonPaths = (rootDir: string): string[] => {
  const paths = [join(rootDir, "package.json")];
  const workspacePackageJsons = globPackageFiles(rootDir, ["**/package.json"], {
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

interface StalePackageReport {
  unusedDependencies: UnusedDependency[];
  skippedDependencies: SkippedDependency[];
}

interface PackageReferenceCollection {
  referencedPackageNames: Set<string>;
  ambiguousPackageNames: Set<string>;
}

export const detectStalePackages = (
  graph: DependencyGraph,
  config: ProjectAnalysisConfig,
): StalePackageReport => {
  const packageJsonPath = resolve(config.rootDir, "package.json");
  let packageJson: PackageJsonDependencies;

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return { unusedDependencies: [], skippedDependencies: [] };
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
  const directlyImportedPackageNames = collectUsedPackages(graph, declaredNames);
  const observedPackageNames = new Set(directlyImportedPackageNames);
  const usedPackageNames = new Set(observedPackageNames);
  const ambiguousBinaryPackageNames = new Set<string>();
  const markPackageUsed = (packageName: string): void => {
    observedPackageNames.add(packageName);
    usedPackageNames.add(packageName);
  };

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
  const lockedMetadataByPackageName = collectPackageLockPackageMetadata(
    nodeModulesSearchRoots,
    config.rootDir,
    { ...dependencies, ...devDependencies },
  );
  const workspaceMetadataByPackageName = new Map<string, PackageLockPackageMetadata>();
  const workspaceRoot = monorepoRoot ?? config.rootDir;
  for (const workspacePackage of resolveWorkspaces(workspaceRoot).packages) {
    if (!workspacePackage.isDeclaredWorkspace) continue;
    try {
      const workspacePackageMetadata = JSON.parse(
        readFileSync(join(workspacePackage.directory, "package.json"), "utf-8"),
      );
      if (workspacePackageMetadata.name === workspacePackage.name) {
        workspaceMetadataByPackageName.set(workspacePackageMetadata.name, workspacePackageMetadata);
      }
    } catch {
      continue;
    }
  }
  for (const [dependencyName, dependencySpecifier] of Object.entries({
    ...dependencies,
    ...devDependencies,
  })) {
    const localPathMatch = /^(?:file|link):(.+)$/.exec(dependencySpecifier);
    if (!localPathMatch) continue;
    try {
      const localPackageMetadata = JSON.parse(
        readFileSync(resolve(config.rootDir, localPathMatch[1], "package.json"), "utf-8"),
      );
      if (localPackageMetadata.name === dependencyName) {
        workspaceMetadataByPackageName.set(dependencyName, localPackageMetadata);
      }
    } catch {
      continue;
    }
  }

  const { binToPackage } = buildBinaryPackageIndex(
    nodeModulesSearchRoots,
    declaredNames,
    workspaceMetadataByPackageName,
    lockedMetadataByPackageName,
    { ...dependencies, ...devDependencies },
  );

  for (const workspacePackageJsonPath of allPackageJsonPaths) {
    const scriptReferences = collectScriptReferencedPackages(
      workspacePackageJsonPath,
      declaredNames,
      binToPackage,
    );
    for (const packageName of scriptReferences.referencedPackageNames) markPackageUsed(packageName);
    for (const packageName of scriptReferences.ambiguousPackageNames) {
      ambiguousBinaryPackageNames.add(packageName);
    }

    const packageJsonReferenced = collectPackageJsonReferences(
      workspacePackageJsonPath,
      declaredNames,
    );
    for (const packageName of packageJsonReferenced) markPackageUsed(packageName);
  }

  for (const buildScriptPath of extractInvokedBuildScriptPaths(config.rootDir)) {
    try {
      for (const packageName of collectDeclaredPackageNamesInFile(
        buildScriptPath,
        declaredNames,
        collectPackageImportNames,
      )) {
        markPackageUsed(packageName);
      }
    } catch {
      continue;
    }
  }

  const nxProjectReferences = collectNxProjectJsonReferences(
    config.rootDir,
    declaredNames,
    binToPackage,
  );
  for (const packageName of nxProjectReferences.referencedPackageNames)
    markPackageUsed(packageName);
  for (const packageName of nxProjectReferences.ambiguousPackageNames) {
    ambiguousBinaryPackageNames.add(packageName);
  }

  const configSearchRoots =
    monorepoRoot && monorepoRoot !== config.rootDir
      ? [config.rootDir, monorepoRoot]
      : [config.rootDir];
  for (const configSearchRoot of configSearchRoots) {
    const configReferenced = collectConfigReferencedPackages(
      configSearchRoot,
      graph,
      declaredNames,
      binToPackage,
    );
    for (const packageName of configReferenced) markPackageUsed(packageName);

    const tsconfigReferenced = collectTsconfigReferencedPackages(
      configSearchRoot,
      config.rootDir,
      declaredNames,
      {
        ...dependencies,
        ...devDependencies,
      },
    );
    for (const packageName of tsconfigReferenced) markPackageUsed(packageName);

    const { packageNames: expoPluginPackageNames } = extractExpoConfigPluginEntries(
      configSearchRoot,
      { ...dependencies, ...devDependencies },
    );
    for (const packageName of expoPluginPackageNames) {
      if (declaredNames.has(packageName)) {
        markPackageUsed(packageName);
      }
    }
  }

  if (
    declaredNames.has("@sanity/core") &&
    hasSanityV2CoreContract(config.rootDir, packageJson.scripts ?? {})
  ) {
    markPackageUsed("@sanity/core");
  }

  if (hasJsxFiles(graph)) {
    if (declaredNames.has("react")) markPackageUsed("react");
    if (declaredNames.has("react-dom")) markPackageUsed("react-dom");
    if (declaredNames.has("react-native")) markPackageUsed("react-native");
    if (declaredNames.has("react-native-web")) markPackageUsed("react-native-web");
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
    if (hasWebFramework) markPackageUsed("react-dom");
  }

  if (declaredNames.has("astro") && declaredNames.has("sharp")) {
    markPackageUsed("sharp");
  }

  if (declaredNames.has("next") && declaredNames.has("sharp")) {
    markPackageUsed("sharp");
  }

  if (declaredNames.has("ajv") && usedPackageNames.has("@rjsf/validator-ajv8")) {
    markPackageUsed("ajv");
  }

  if (declaredNames.has("@next/mdx")) {
    if (declaredNames.has("@mdx-js/loader")) markPackageUsed("@mdx-js/loader");
    if (declaredNames.has("@mdx-js/react")) markPackageUsed("@mdx-js/react");
  }

  if (
    (declaredNames.has("@docusaurus/core") || declaredNames.has("@docusaurus/preset-classic")) &&
    declaredNames.has("@mdx-js/react")
  ) {
    markPackageUsed("@mdx-js/react");
  }

  if (declaredNames.has("remix") && declaredNames.has("@remix-run/react")) {
    markPackageUsed("@remix-run/react");
  }

  const projectConventionReferenced = collectProjectConventionReferencedPackages(
    config.rootDir,
    graph,
    declaredNames,
    usedPackageNames,
    directlyImportedPackageNames,
  );
  for (const packageName of projectConventionReferenced) markPackageUsed(packageName);

  for (const packageName of collectInstalledAgentSkillPackageNames(
    nodeModulesSearchRoots,
    declaredNames,
  )) {
    markPackageUsed(packageName);
  }

  if (declaredNames.has("react") && declaredNames.has("react-dom")) {
    const packageJsonPath = resolve(config.rootDir, "package.json");
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const peerDeps = packageJson.peerDependencies ?? {};
      if ("react" in peerDeps && declaredDependencies.get("react") === true) {
        markPackageUsed("react");
      }
      if ("react-dom" in peerDeps && declaredDependencies.get("react-dom") === true) {
        markPackageUsed("react-dom");
      }
    } catch {
      // fall through
    }
  }

  for (const dependencyName of declaredNames) {
    if (isAlwaysConsideredUsed(dependencyName)) usedPackageNames.add(dependencyName);
  }

  const initialPeerCollection = collectPeerSatisfiedPackages(
    nodeModulesSearchRoots,
    declaredNames,
    usedPackageNames,
    lockedMetadataByPackageName,
    workspaceMetadataByPackageName,
    { ...dependencies, ...devDependencies },
  );
  const { peerSatisfiedPackageNames } = initialPeerCollection;
  let isPeerMetadataComplete = initialPeerCollection.isPeerMetadataComplete;
  for (const packageName of peerSatisfiedPackageNames) usedPackageNames.add(packageName);

  const overrideMappings = collectOverrideMappings(
    configSearchRoots,
    allPackageJsonPaths,
    monorepoRoot,
  );

  const candidateUnused = new Set<string>();
  const skippedDependenciesByName = new Map<string, Set<SkippedDependencyReason>>();
  const recordSkippedDependency = (
    dependencyName: string,
    reason: SkippedDependencyReason,
  ): void => {
    const reasons = skippedDependenciesByName.get(dependencyName) ?? new Set();
    reasons.add(reason);
    skippedDependenciesByName.set(dependencyName, reasons);
  };

  for (const [dependencyName] of declaredDependencies) {
    if (observedPackageNames.has(dependencyName) || peerSatisfiedPackageNames.has(dependencyName)) {
      continue;
    }
    if (isAlwaysConsideredUsed(dependencyName)) {
      recordSkippedDependency(dependencyName, "allowlisted-name");
    }
    if (ambiguousBinaryPackageNames.has(dependencyName)) {
      recordSkippedDependency(dependencyName, "ambiguous-binary");
    }
  }

  for (const [dependencyName] of declaredDependencies) {
    if (isAlwaysConsideredUsed(dependencyName)) continue;
    if (usedPackageNames.has(dependencyName)) continue;
    if (ambiguousBinaryPackageNames.has(dependencyName)) continue;
    candidateUnused.add(dependencyName);
  }

  if (candidateUnused.size > 0) {
    const sourceFileRescued = scanSourceFilesForPackageImports(config.rootDir, candidateUnused);
    for (const packageName of sourceFileRescued) {
      markPackageUsed(packageName);
      candidateUnused.delete(packageName);
    }
  }

  for (const { fromPackage, toPackage } of overrideMappings) {
    if (usedPackageNames.has(fromPackage) && declaredNames.has(toPackage)) {
      markPackageUsed(toPackage);
      candidateUnused.delete(toPackage);
    }
  }

  const finalPeerCollection = collectPeerSatisfiedPackages(
    nodeModulesSearchRoots,
    declaredNames,
    observedPackageNames,
    lockedMetadataByPackageName,
    workspaceMetadataByPackageName,
    { ...dependencies, ...devDependencies },
  );
  isPeerMetadataComplete &&= finalPeerCollection.isPeerMetadataComplete;
  for (const packageName of finalPeerCollection.peerSatisfiedPackageNames) {
    usedPackageNames.add(packageName);
    candidateUnused.delete(packageName);
  }

  if (!isPeerMetadataComplete) {
    for (const dependencyName of candidateUnused) {
      recordSkippedDependency(dependencyName, "incomplete-peer-metadata");
    }
    candidateUnused.clear();
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

  const skippedDependencies = [...skippedDependenciesByName.entries()]
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, reasons]) => ({
      name,
      isDevDependency: declaredDependencies.get(name) ?? false,
      reasons: [...reasons].sort(),
    }));

  return { unusedDependencies, skippedDependencies };
};

const collectUsedPackages = (
  graph: DependencyGraph,
  declaredPackageNames: ReadonlySet<string>,
): Set<string> => {
  const usedPackages = new Set<string>();

  for (const module of graph.modules) {
    for (const importInfo of module.imports) {
      const packageName = extractPackageName(importInfo.specifier);
      if (packageName) {
        usedPackages.add(packageName);
        continue;
      }
      for (const declaredPackageName of declaredPackageNames) {
        if (matchesNodeModulesPackageReference(importInfo.specifier, declaredPackageName)) {
          usedPackages.add(declaredPackageName);
        }
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
  lockedMetadataByPackageName: Map<string, PackageLockPackageMetadata>,
  workspaceMetadataByPackageName: Map<string, PackageLockPackageMetadata>,
  declaredDependencySpecifiers: Readonly<Record<string, string>>,
): PeerSatisfiedPackageCollection => {
  const peerSatisfiedPackageNames = new Set<string>();
  let isPeerMetadataComplete = true;

  for (const installedName of declaredNames) {
    if (!confirmedUsedNames.has(installedName)) continue;

    const installedPackageJsonPath = findInstalledPackageJsonPath(
      installedName,
      nodeModulesSearchRoots,
    );
    let installedPackageMetadata: PackageLockPackageMetadata | undefined;
    if (installedPackageJsonPath) {
      try {
        installedPackageMetadata = JSON.parse(readFileSync(installedPackageJsonPath, "utf-8"));
      } catch {
        installedPackageMetadata = undefined;
      }
    }
    const packageMetadata =
      workspaceMetadataByPackageName.get(installedName) ??
      lockedMetadataByPackageName.get(installedName) ??
      (installedPackageMetadata &&
      typeof installedPackageMetadata.version === "string" &&
      validRange(declaredDependencySpecifiers[installedName]) &&
      satisfies(installedPackageMetadata.version, declaredDependencySpecifiers[installedName], {
        includePrerelease: true,
      })
        ? installedPackageMetadata
        : undefined);
    if (!packageMetadata) {
      isPeerMetadataComplete = false;
      continue;
    }
    for (const peerName of Object.keys(packageMetadata.peerDependencies ?? {})) {
      if (packageMetadata.peerDependenciesMeta?.[peerName]?.optional === true) continue;
      if (declaredNames.has(peerName)) {
        peerSatisfiedPackageNames.add(peerName);
      }
    }
  }

  return { peerSatisfiedPackageNames, isPeerMetadataComplete };
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

interface BinaryPackageIndex {
  binToPackage: Map<string, Set<string>>;
}

// Static aliases support uninstalled checkouts and only feed bin lookup; they
// never prove that a package is used.
const KNOWN_PACKAGE_BIN_NAMES = new Map<string, ReadonlyArray<string>>([
  ["@babel/cli", ["babel"]],
  ["@babel/node", ["babel-node"]],
  ["babel-cli", ["babel", "babel-node"]],
  ["flow-bin", ["flow"]],
  ["parcel-bundler", ["parcel"]],
  ["react-email", ["email"]],
  ["cli-glob", ["glob"]],
  ["firebase-tools", ["firebase"]],
  ["@rc-component/np", ["rc-np"]],
  ["@electron/rebuild", ["electron-rebuild"]],
  ["@microsoft/api-extractor", ["api-extractor"]],
  ["@tarojs/cli", ["taro"]],
  ["@chakra-ui/cli", ["chakra", "chakra-cli"]],
  ["@react-router/serve", ["react-router-serve"]],
  ["@remix-run/serve", ["remix-serve"]],
  ["@tauri-apps/cli", ["tauri"]],
  ["@typescript/native-preview", ["tsgo"]],
  // The browser-flavor packages exist to be driven by the `playwright` CLI
  // (they download their browser at install time); a `playwright test`
  // script is their use.
  ["playwright-chromium", ["playwright"]],
  ["playwright-firefox", ["playwright"]],
  ["playwright-webkit", ["playwright"]],
]);

const staticBinNamesForPackage = (packageName: string): string[] => {
  const binNames = [...(KNOWN_PACKAGE_BIN_NAMES.get(packageName) ?? [])];
  const unscopedName = packageName.split("/").at(-1) ?? packageName;
  if (unscopedName.endsWith("-cli") && unscopedName.length > "-cli".length) {
    binNames.push(unscopedName.slice(0, -"-cli".length));
  }
  return binNames;
};

const buildBinaryPackageIndex = (
  nodeModulesSearchRoots: string[],
  declaredNames: Set<string>,
  workspaceMetadataByPackageName: Map<string, PackageLockPackageMetadata>,
  lockedMetadataByPackageName: Map<string, PackageLockPackageMetadata>,
  declaredDependencySpecifiers: Readonly<Record<string, string>>,
): BinaryPackageIndex => {
  const binToPackage = new Map<string, Set<string>>();
  const addBinMapping = (binaryName: string, packageName: string): void => {
    const mappedPackages = binToPackage.get(binaryName) ?? new Set<string>();
    mappedPackages.add(packageName);
    binToPackage.set(binaryName, mappedPackages);
  };
  for (const packageName of declaredNames) {
    for (const staticBinName of staticBinNamesForPackage(packageName)) {
      addBinMapping(staticBinName, packageName);
    }
    const authoritativePackageMetadata =
      workspaceMetadataByPackageName.get(packageName) ??
      lockedMetadataByPackageName.get(packageName);
    if (authoritativePackageMetadata) {
      const binField = authoritativePackageMetadata.bin;
      if (typeof binField === "string") {
        addBinMapping(packageName.split("/").at(-1) ?? packageName, packageName);
      } else if (binField) {
        for (const binaryName of Object.keys(binField)) addBinMapping(binaryName, packageName);
      }
      continue;
    }
    const packageBinJsonPath = findInstalledPackageJsonPath(packageName, nodeModulesSearchRoots);
    if (!packageBinJsonPath) continue;
    try {
      const binContent = readFileSync(packageBinJsonPath, "utf-8");
      const binPackageJson = JSON.parse(binContent);
      if (
        typeof binPackageJson.version !== "string" ||
        !validRange(declaredDependencySpecifiers[packageName]) ||
        !satisfies(binPackageJson.version, declaredDependencySpecifiers[packageName], {
          includePrerelease: true,
        })
      ) {
        continue;
      }
      const binField = binPackageJson.bin;
      if (typeof binField === "string" && binField.length > 0) {
        addBinMapping(packageName.split("/").at(-1) ?? packageName, packageName);
      } else if (typeof binField === "object" && binField !== null) {
        const binaryNames = Object.keys(binField);
        if (binaryNames.length === 0) continue;
        for (const binaryName of binaryNames) {
          addBinMapping(binaryName, packageName);
        }
      }
    } catch {
      continue;
    }
  }
  return { binToPackage };
};

const collectScriptReferencedPackages = (
  packageJsonPath: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, Set<string>>,
): PackageReferenceCollection => {
  const referencedPackageNames = new Set<string>();
  const ambiguousPackageNames = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const scripts = packageJson.scripts;
    if (!scripts || typeof scripts !== "object") {
      return { referencedPackageNames, ambiguousPackageNames };
    }

    for (const scriptCommand of Object.values(scripts)) {
      if (typeof scriptCommand !== "string") continue;
      const commandContents = [scriptCommand];
      const localScriptFileReference = extractLocalScriptFileReference(scriptCommand);
      if (localScriptFileReference) {
        const packageDirectory = dirname(packageJsonPath);
        const localScriptPath = resolve(packageDirectory, localScriptFileReference);
        const localScriptRelativePath = relative(packageDirectory, localScriptPath);
        if (
          !localScriptRelativePath.startsWith("..") &&
          !isAbsolute(localScriptRelativePath) &&
          existsSync(localScriptPath) &&
          statSync(localScriptPath).isFile()
        ) {
          commandContents.push(readFileSync(localScriptPath, "utf-8"));
        }
      }
      const commandReferences = collectCommandReferencedPackages(
        commandContents.join("\n"),
        declaredNames,
        binToPackage,
      );
      for (const packageName of commandReferences.referencedPackageNames) {
        referencedPackageNames.add(packageName);
      }
      for (const packageName of commandReferences.ambiguousPackageNames) {
        ambiguousPackageNames.add(packageName);
      }

      for (const declaredName of declaredNames) {
        if (referencedPackageNames.has(declaredName)) continue;
        if (
          matchesNodeModulesPackageReference(scriptCommand, declaredName) ||
          matchesPackageCliOptionReference(scriptCommand, declaredName)
        ) {
          referencedPackageNames.add(declaredName);
        }
      }
    }
  } catch {
    return { referencedPackageNames, ambiguousPackageNames };
  }

  return { referencedPackageNames, ambiguousPackageNames };
};

const collectCommandReferencedPackages = (
  command: string,
  declaredNames: Set<string>,
  binToPackage: Map<string, Set<string>>,
): PackageReferenceCollection => {
  const referencedPackageNames = new Set<string>();
  const ambiguousPackageNames = new Set<string>();

  for (const candidateBinary of extractScriptBinaryNames(command)) {
    if (!candidateBinary) continue;
    const candidatePackages = new Set(
      [...(binToPackage.get(candidateBinary) ?? [])].filter((packageName) =>
        declaredNames.has(packageName),
      ),
    );
    if (declaredNames.has(candidateBinary)) candidatePackages.add(candidateBinary);
    if (candidatePackages.size === 1) {
      for (const packageName of candidatePackages) referencedPackageNames.add(packageName);
    } else if (candidatePackages.size > 1) {
      for (const packageName of candidatePackages) ambiguousPackageNames.add(packageName);
    }
  }

  return { referencedPackageNames, ambiguousPackageNames };
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
  ".stylelintrc",
  ".stylelintrc.{js,cjs,mjs,json,yaml,yml}",
  "**/.stylelintrc",
  "**/.stylelintrc.{js,cjs,mjs,json,yaml,yml}",
  "stylelint.config.{js,cjs,mjs,ts,mts,cts}",
  "**/stylelint.config.{js,cjs,mjs,ts,mts,cts}",
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
  "gatsby-config.{js,ts,mjs,cjs}",
  "next.config.{js,ts,mjs,mts}",
  "tailwind.config.{js,ts,cjs,mjs}",
  "jest.config.{js,ts,mjs,cjs}",
  "karma.{conf,config}.{js,ts,mjs,cjs}",
  "**/karma.{conf,config}.{js,ts,mjs,cjs}",
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
  ".releaserc",
  ".releaserc.{js,cjs,mjs,json,yaml,yml}",
  "**/.releaserc",
  "**/.releaserc.{js,cjs,mjs,json,yaml,yml}",
  "release.config.{js,cjs,mjs,ts,mts,cts}",
  "**/release.config.{js,cjs,mjs,ts,mts,cts}",
  ".release-it.{js,cjs,mjs,json,ts}",
  "release-it.{js,cjs,mjs,json,ts}",
  "release-it.config.{js,cjs,mjs,json,ts}",
  "**/.release-it.{js,cjs,mjs,json,ts}",
  "**/release-it.{js,cjs,mjs,json,ts}",
  "**/release-it.config.{js,cjs,mjs,json,ts}",
  "typedoc.json",
  "**/typedoc.json",
  "netlify.toml",
  "**/netlify.toml",
  ".lintstagedrc.{js,cjs,mjs,json}",
  "commitlint.config.{js,cjs,mjs,ts}",
  ".commitlintrc.{js,cjs,mjs,json,yaml,yml}",
  "tslint.json",
  "Gruntfile.{js,ts,mjs,cjs}",
  "**/Gruntfile.{js,ts,mjs,cjs}",
  ".remarkrc",
  ".remarkrc.{js,cjs,mjs,json}",
  ".dumirc.ts",
  ".dumirc.js",
  "dumi.config.{ts,js}",
  "sanity.json",
];

const collectConfigFilePaths = (rootDir: string): string[] =>
  globPackageFiles(rootDir, CONFIG_FILE_GLOBS, {
    ignore: ["**/node_modules/**"],
    dot: true,
    deep: 3,
  });

const collectConfigReferencedPackages = (
  rootDir: string,
  graph: DependencyGraph,
  declaredNames: Set<string>,
  binToPackage: Map<string, Set<string>>,
): Set<string> => {
  const referenced = new Set<string>();

  const addMatchesFromFile = (
    filePath: string,
    matcher: (content: string, packageName: string) => boolean,
  ): void => {
    try {
      for (const packageName of matchPackageNamesInFile(filePath, declaredNames, matcher)) {
        referenced.add(packageName);
      }
    } catch {
      return;
    }
  };

  const addCollectedMatchesFromFile = (
    filePath: string,
    collector: (content: string) => ReadonlySet<string>,
  ): void => {
    try {
      for (const packageName of collectDeclaredPackageNamesInFile(
        filePath,
        declaredNames,
        collector,
      )) {
        referenced.add(packageName);
      }
    } catch {
      return;
    }
  };

  const addConfigMatchesFromFile = (filePath: string): void => {
    addCollectedMatchesFromFile(filePath, (content) =>
      basename(filePath) === "sanity.json"
        ? collectSanityV2PackageNames(content)
        : collectPackageConfigReferences(filePath, content),
    );
  };

  const addKarmaConfigMatches = (filePath: string): void => {
    if (!/^karma\.(?:conf|config)\.[cm]?[jt]s$/.test(basename(filePath))) return;
    try {
      const content = readFileSync(filePath, "utf-8");
      for (const packageName of extractKarmaConfigPackageReferences(content, declaredNames)) {
        referenced.add(packageName);
      }
    } catch {
      return;
    }
  };

  for (const module of graph.modules) {
    if (!module.isConfigFile) continue;
    addConfigMatchesFromFile(module.fileId.path);
    addKarmaConfigMatches(module.fileId.path);
  }

  const configFiles = expandBuildScriptPaths({
    projectRoot: rootDir,
    initialPaths: collectConfigFilePaths(rootDir),
  });

  for (const configPath of configFiles) {
    addConfigMatchesFromFile(configPath);
    addKarmaConfigMatches(configPath);
    if (
      declaredNames.has("release-it") &&
      RELEASE_IT_CONFIG_FILE_PATTERN.test(basename(configPath))
    ) {
      referenced.add("release-it");
    }
    if (
      declaredNames.has("@antfu/eslint-config") &&
      declaredNames.has("@eslint-react/eslint-plugin") &&
      /^eslint\.config\.[cm]?[jt]s$/.test(basename(configPath))
    ) {
      try {
        if (hasAntfuEslintReactConfig(readFileSync(configPath, "utf-8"))) {
          referenced.add("@eslint-react/eslint-plugin");
        }
      } catch {
        continue;
      }
    }
    if (declaredNames.has("critters") && /^next\.config\.[cm]?[jt]s$/.test(basename(configPath))) {
      try {
        if (hasEnabledNextOptimizeCss(readFileSync(configPath, "utf-8"))) {
          referenced.add("critters");
        }
      } catch {
        continue;
      }
    }
  }

  const bindingGypFiles = globPackageFiles(rootDir, ["binding.gyp", "**/binding.gyp"], {
    ignore: ["**/node_modules/**"],
    dot: true,
    deep: TOOLING_SOURCE_MAX_DEPTH,
  });
  for (const bindingGypPath of bindingGypFiles) {
    addCollectedMatchesFromFile(bindingGypPath, collectBindingGypPackageReferences);
  }

  // Dot-directory tooling source trees (a dumi docs theme, storybook config
  // components) import real dependencies but live outside the module graph's
  // traversal, so their imports must be credited by content scan.
  const toolingSourceFiles = globPackageFiles(
    rootDir,
    ["**/{.dumi,.storybook,.docz,.styleguidist}/**/*.{ts,tsx,js,jsx,mts,mjs}"],
    { ignore: ["**/node_modules/**"], dot: true, deep: TOOLING_SOURCE_MAX_DEPTH },
  );

  for (const toolingSourcePath of toolingSourceFiles) {
    addCollectedMatchesFromFile(toolingSourcePath, collectPackageImportNames);
  }

  const toolingExecutionFiles = globPackageFiles(rootDir, ["**/{.husky,.github}/**/*"], {
    ignore: ["**/node_modules/**"],
    dot: true,
    deep: TOOLING_SOURCE_MAX_DEPTH,
  });

  for (const toolingExecutionPath of toolingExecutionFiles) {
    addCollectedMatchesFromFile(toolingExecutionPath, collectPackageImportNames);
    addMatchesFromFile(toolingExecutionPath, matchesNodeModulesPackageReference);
    try {
      const commandReferences = collectCommandReferencedPackages(
        readFileSync(toolingExecutionPath, "utf-8"),
        declaredNames,
        binToPackage,
      );
      for (const packageName of commandReferences.referencedPackageNames) {
        referenced.add(packageName);
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
  "release",
  "release-it",
  "pre-commit",
  "browser",
  "oclif",
  "prisma",
  "cosmos",
  "react-cosmos",
] as const;

const PACKAGE_JSON_CONFIG_OWNERS = new Map<string, string>([
  ["browserslist", "browserslist"],
  ["pre-commit", "pre-commit"],
  ["release-it", "release-it"],
]);

const RELEASE_IT_CONFIG_FILE_PATTERN =
  /^(?:\.release-it|release-it(?:\.config)?)\.(?:js|cjs|mjs|json|ts)$/;

const SCRIPT_IMPLIED_DEPENDENCIES = new Map<string, RegExp>([
  ["@astrojs/check", /\bastro\s+check\b/],
  ["oxlint-tsgolint", /\b(?:oxlint|ultracite)\b[^\n]*--type-(?:aware|check)\b/],
]);

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

const collectPackageJsonReferences = (
  packageJsonPath: string,
  declaredNames: Set<string>,
): Set<string> => {
  const referenced = new Set<string>();

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    for (const sectionName of PACKAGE_JSON_CONFIG_SECTIONS) {
      const sectionValue = packageJson[sectionName];
      if (sectionValue === undefined || sectionValue === null) continue;

      const ownerPackageName = PACKAGE_JSON_CONFIG_OWNERS.get(sectionName);
      if (ownerPackageName && declaredNames.has(ownerPackageName)) {
        referenced.add(ownerPackageName);
      }

      const referenceSectionValue =
        sectionName === "pnpm" && typeof sectionValue === "object" && !Array.isArray(sectionValue)
          ? Object.fromEntries(
              Object.entries(sectionValue).filter(([fieldName]) => fieldName !== "overrides"),
            )
          : sectionValue;
      const sectionText = JSON.stringify(referenceSectionValue);
      for (const packageName of declaredNames) {
        if (sectionText.includes(packageName)) {
          referenced.add(packageName);
        }
      }
    }

    const scripts = packageJson.scripts;
    if (scripts && typeof scripts === "object") {
      const scriptCommands = Object.values(scripts).filter(
        (scriptCommand): scriptCommand is string => typeof scriptCommand === "string",
      );
      const packageDeclaresPostinstallPostinstall = Boolean(
        packageJson.dependencies?.["postinstall-postinstall"] ??
        packageJson.devDependencies?.["postinstall-postinstall"],
      );
      if (packageDeclaresPostinstallPostinstall && typeof scripts.postinstall === "string") {
        referenced.add("postinstall-postinstall");
      }
      for (const [dependencyName, commandPattern] of SCRIPT_IMPLIED_DEPENDENCIES) {
        if (
          declaredNames.has(dependencyName) &&
          scriptCommands.some((scriptCommand) => commandPattern.test(scriptCommand))
        ) {
          referenced.add(dependencyName);
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
  binToPackage: Map<string, Set<string>>,
): PackageReferenceCollection => {
  const referencedPackageNames = new Set<string>();
  const ambiguousPackageNames = new Set<string>();

  const projectJsonPaths = globPackageFiles(rootDir, ["project.json", "**/project.json"], {
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
          referencedPackageNames.add(packageName);
        }
      }

      for (const stringValue of collectStringValues(projectJson)) {
        const commandReferences = collectCommandReferencedPackages(
          stringValue,
          declaredNames,
          binToPackage,
        );
        for (const packageName of commandReferences.referencedPackageNames) {
          referencedPackageNames.add(packageName);
        }
        for (const packageName of commandReferences.ambiguousPackageNames) {
          ambiguousPackageNames.add(packageName);
        }
      }
    } catch {
      continue;
    }
  }

  return { referencedPackageNames, ambiguousPackageNames };
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

const collectTsconfigReferencedPackages = (
  configSearchRoot: string,
  manifestRoot: string,
  declaredPackageNames: ReadonlySet<string>,
  declaredDependencySpecifiers: Readonly<Record<string, string>>,
): Set<string> => {
  const referenced = new Set<string>();

  const tsconfigFiles = globPackageFiles(configSearchRoot, TSCONFIG_GLOBS, {
    ignore: ["**/node_modules/**"],
    dot: false,
    deep: 4,
  });

  for (const tsconfigPath of tsconfigFiles) {
    try {
      const content = readFileSync(tsconfigPath, "utf-8");
      const parsed = parseTypeScriptConfig(tsconfigPath, content);
      if (!parsed) continue;

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
      if (compilerOptions?.paths && typeof compilerOptions.paths === "object") {
        const pathsBaseDirectory =
          typeof compilerOptions.baseUrl === "string"
            ? resolve(dirname(tsconfigPath), compilerOptions.baseUrl)
            : dirname(tsconfigPath);
        for (const [pathPattern, pathTargets] of Object.entries(compilerOptions.paths)) {
          const packageName = pathPattern.endsWith("/*") ? pathPattern.slice(0, -2) : pathPattern;
          const localSpecifier = declaredDependencySpecifiers[packageName];
          if (!localSpecifier?.startsWith("file:") || !Array.isArray(pathTargets)) continue;
          const localDependencyDirectory = resolve(
            manifestRoot,
            localSpecifier.slice("file:".length),
          );
          const hasTargetInsideLocalDependency = pathTargets.some((pathTarget) => {
            if (typeof pathTarget !== "string") return false;
            const targetRelativePath = relative(
              localDependencyDirectory,
              resolve(pathsBaseDirectory, pathTarget),
            );
            return (
              !isAbsolute(targetRelativePath) &&
              targetRelativePath.split(/[\\/]/).every((pathSegment) => pathSegment !== "..")
            );
          });
          if (hasTargetInsideLocalDependency) referenced.add(packageName);
        }
      }
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
      if (Array.isArray(compilerOptions?.plugins)) {
        for (const pluginEntry of compilerOptions.plugins) {
          let pluginName: string | undefined;
          if (typeof pluginEntry === "string") {
            pluginName = pluginEntry;
          } else if (
            pluginEntry &&
            typeof pluginEntry === "object" &&
            "name" in pluginEntry &&
            typeof pluginEntry.name === "string"
          ) {
            pluginName = pluginEntry.name;
          }
          if (pluginName) referenced.add(pluginName);
        }
      }
      const nodeModulesReferenceValues = [
        ...collectStringValues(parsed.files),
        ...collectStringValues(parsed.include),
        ...collectStringValues(parsed.references),
        ...collectStringValues(compilerOptions?.paths),
        ...collectStringValues(compilerOptions?.rootDirs),
        ...collectStringValues(compilerOptions?.typeRoots),
      ];
      for (const stringValue of nodeModulesReferenceValues) {
        for (const packageName of declaredPackageNames) {
          if (matchesNodeModulesPackageReference(stringValue, packageName)) {
            referenced.add(packageName);
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

const SOURCE_FILE_GLOBS = [
  "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs,css,scss,sass,less,styl,html,mdx,vue,svelte,astro,coffee,es6,sol,gradle,xml,yml,yaml,patch}",
];

const SOURCE_FILE_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.js",
];

const scanSourceFilesForPackageImports = (
  rootDir: string,
  candidatePackages: Set<string>,
): Set<string> => {
  const found = new Set<string>();
  if (candidatePackages.size === 0) return found;

  const regularSourceFiles = globPackageFiles(rootDir, SOURCE_FILE_GLOBS, {
    ignore: SOURCE_FILE_IGNORES,
    dot: true,
    deep: 15,
  });
  const executableMarkdownFiles = collectExecutableMarkdownFilePaths(rootDir);
  const executableMarkdownFileSet = new Set(executableMarkdownFiles);
  const sourceFiles = [...new Set([...regularSourceFiles, ...executableMarkdownFiles])];

  for (const filePath of sourceFiles) {
    if (candidatePackages.size === 0) break;
    try {
      const content = readFileSync(filePath, "utf-8");
      const isPatchFile = filePath.endsWith(".patch");
      const isStylesheet = /\.(?:css|scss|sass)$/.test(filePath);
      const isHtml = filePath.endsWith(".html");
      const isMarkdown = /\.mdx?$/.test(filePath);
      const isExecutableMarkdown =
        filePath.endsWith(".mdx") || executableMarkdownFileSet.has(filePath);
      const stylesheetPackages = isStylesheet
        ? new Set(
            collectStylesheetImportSpecifiers(content)
              .map(({ specifier }) => extractPackageName(specifier))
              .filter((packageName) => packageName !== undefined),
          )
        : new Set<string>();
      const importedPackageNames =
        isStylesheet || isPatchFile || (isMarkdown && !isExecutableMarkdown)
          ? new Set<string>()
          : isHtml
            ? collectHtmlScriptPackageNames(content)
            : isExecutableMarkdown
              ? collectMarkdownModulePackageNames(content)
              : collectPackageImportNames(content);
      const usesJavaScriptSyntax = /\.(?:[cm]?[jt]sx?|coffee|es6|sol)$/.test(filePath);
      for (const packageName of candidatePackages) {
        const escapedPatchPackageName = packageName
          .replaceAll("/", "+")
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const isPatchPackageFile = new RegExp(
          `(?:^|[\\/])patches[\\/]${escapedPatchPackageName}\\+[^\\/]+\\.patch$`,
        ).test(filePath);
        const hasPatchTargetReference =
          isPatchFile &&
          (isPatchPackageFile ||
            content
              .split("\n")
              .some(
                (line) =>
                  /^(?:diff --git|---|\+\+\+) /.test(line) &&
                  matchesNodeModulesPackageReference(line, packageName),
              ));
        const isReferenced = isStylesheet
          ? stylesheetPackages.has(packageName) ||
            matchesNodeModulesPackageReference(content, packageName)
          : isPatchFile
            ? hasPatchTargetReference
            : importedPackageNames.has(packageName) ||
              (!isMarkdown &&
                ((usesJavaScriptSyntax
                  ? matchesExecutableNodeModulesPackageReference(content, packageName)
                  : matchesNodeModulesPackageReference(content, packageName)) ||
                  matchesIconifyCollectionReference(content, packageName)));
        if (isReferenced) {
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

const SASS_COMPILER_HOST_PACKAGES = [
  "vite",
  "next",
  "react-scripts",
  "react-app-rewired",
  "gatsby",
  "gatsby-plugin-sass",
  "astro",
  "parcel-bundler",
];

const IMPLICIT_STYLE_COMPILER_CONTRACTS = [
  {
    compilerPackageName: "less",
    sourcePattern: /\.less(?:[?#].*)?$/,
    hostPackageNames: [...SASS_COMPILER_HOST_PACKAGES, "less-loader"],
  },
  {
    compilerPackageName: "stylus",
    sourcePattern: /\.styl(?:[?#].*)?$/,
    hostPackageNames: [
      ...SASS_COMPILER_HOST_PACKAGES,
      "stylus-loader",
      "react-native-stylus-transformer",
    ],
  },
];

const collectProjectConventionReferencedPackages = (
  rootDir: string,
  graph: DependencyGraph,
  declaredNames: Set<string>,
  usedPackageNames: Set<string>,
  directlyImportedPackageNames: Set<string>,
): Set<string> => {
  const referenced = collectStencilCompanionPackageNames(rootDir, declaredNames);

  if (declaredNames.has("supabase") && existsSync(join(rootDir, "supabase/config.toml"))) {
    referenced.add("supabase");
  }

  for (const configPath of globPackageFiles(
    rootDir,
    ["react-native.config.{js,cjs,mjs,ts,cts,mts}"],
    { ignore: [], deep: 1 },
  )) {
    for (const packageName of collectReactNativeConfigPackageNames(
      readFileSync(configPath, "utf8"),
      declaredNames,
    )) {
      referenced.add(packageName);
    }
  }

  const hasCapacitorConfig =
    fg.sync(["capacitor.config.{ts,js,json,mts,mjs,cts,cjs}"], {
      cwd: rootDir,
      onlyFiles: true,
    }).length > 0;
  const hasUsedCapacitorRuntime =
    usedPackageNames.has("@capacitor/core") || usedPackageNames.has("@capacitor/cli");
  const capacitorNativeDirectories = new Set(
    fg.sync(["android", "ios"], { cwd: rootDir, onlyDirectories: true }),
  );

  if (
    (hasCapacitorConfig || hasUsedCapacitorRuntime) &&
    capacitorNativeDirectories.has("android")
  ) {
    if (declaredNames.has("@capacitor/android")) referenced.add("@capacitor/android");
  }
  if ((hasCapacitorConfig || hasUsedCapacitorRuntime) && capacitorNativeDirectories.has("ios")) {
    if (declaredNames.has("@capacitor/ios")) referenced.add("@capacitor/ios");
  }

  const hasUsedSassLoader =
    usedPackageNames.has("sass-loader") ||
    ((usedPackageNames.has("webpack") || usedPackageNames.has("@electron-forge/plugin-webpack")) &&
      declaredNames.has("sass-loader"));
  let hasMeteorSassPlugin = false;
  try {
    hasMeteorSassPlugin = readFileSync(resolve(rootDir, ".meteor/versions"), "utf8").includes(
      "fourseven:scss@",
    );
  } catch {}
  const hasUsedSassHost =
    SASS_COMPILER_HOST_PACKAGES.some((packageName) => usedPackageNames.has(packageName)) ||
    hasUsedSassLoader ||
    hasMeteorSassPlugin;
  if (hasUsedSassHost) {
    const hasImportedSassFile = graph.modules.some(
      (module) =>
        module.isReachable &&
        module.imports.some((importReference) =>
          /\.(?:scss|sass)(?:[?#].*)?$/.test(importReference.specifier),
        ),
    );
    const hasMeteorSassFile =
      hasMeteorSassPlugin &&
      graph.modules.some((module) => /\.(?:scss|sass)$/.test(module.fileId.path));
    const hasParcelHtmlSassReference =
      usedPackageNames.has("parcel-bundler") && hasHtmlSassStylesheetReference(rootDir);
    if (hasImportedSassFile || hasMeteorSassFile || hasParcelHtmlSassReference) {
      if (directlyImportedPackageNames.has("sass-embedded")) {
        referenced.add("sass-embedded");
      } else if (directlyImportedPackageNames.has("sass")) {
        referenced.add("sass");
      } else if (declaredNames.has("sass-embedded")) {
        referenced.add("sass-embedded");
      } else if (declaredNames.has("sass")) {
        referenced.add("sass");
      }
    }
  }

  for (const styleCompilerContract of IMPLICIT_STYLE_COMPILER_CONTRACTS) {
    if (!declaredNames.has(styleCompilerContract.compilerPackageName)) continue;
    const hasUsedCompilerHost = styleCompilerContract.hostPackageNames.some((packageName) =>
      usedPackageNames.has(packageName),
    );
    if (!hasUsedCompilerHost) continue;
    const hasImportedStyleSource = graph.modules.some(
      (module) =>
        module.isReachable &&
        module.imports.some((importReference) =>
          styleCompilerContract.sourcePattern.test(importReference.specifier),
        ),
    );
    if (hasImportedStyleSource) referenced.add(styleCompilerContract.compilerPackageName);
  }

  if (
    declaredNames.has("prisma") &&
    usedPackageNames.has("@prisma/client") &&
    fg.sync(["**/prisma/schema.prisma", "**/prisma.config.{js,cjs,mjs,ts,cts,mts}"], {
      cwd: rootDir,
      onlyFiles: true,
      ignore: [...SOURCE_FILE_IGNORES, "**/{__fixtures__,__tests__,fixtures,test,tests}/**"],
    }).length > 0
  ) {
    referenced.add("prisma");
  }

  if (
    declaredNames.has("react-server-dom-webpack") &&
    usedPackageNames.has("expo-router") &&
    hasExpoReactServerFunctions(rootDir)
  ) {
    referenced.add("react-server-dom-webpack");
  }

  return referenced;
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
