import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  FAST_REFRESH_CONFIG_FILENAMES,
  MINIMUM_FAST_REFRESH_VERSIONS,
} from "../constants/fast-refresh.js";
import { declaresDependency } from "./classify-package-platform.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getImportedName } from "./get-imported-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface FastRefreshFileStatus {
  isActive: boolean;
  runtime: "expo" | "generic" | "next" | "react-router" | "remix" | "tanstack";
}

interface ParsedVersion {
  major: number;
  minor: number;
}

interface MinimumVersion {
  major: number;
  minor: number;
}

interface IntegrationImport {
  importedNames: ReadonlySet<string> | null;
  requiresViteDevelopmentServer?: boolean;
  runtime: FastRefreshFileStatus["runtime"];
}

interface WorkspacePackage {
  directory: string;
  manifest: PackageManifest;
  status: FastRefreshFileStatus;
}

interface WorkspaceFastRefreshIndex {
  aliasOwners: ReadonlyArray<{
    rootDirectory: string;
    status: FastRefreshFileStatus;
  }>;
  sourceEntryOwners: ReadonlyMap<string, FastRefreshFileStatus>;
}

const INTEGRATION_IMPORTS: ReadonlyMap<string, IntegrationImport> = new Map([
  [
    "@vitejs/plugin-react",
    { importedNames: null, requiresViteDevelopmentServer: true, runtime: "generic" },
  ],
  [
    "@vitejs/plugin-react-swc",
    { importedNames: null, requiresViteDevelopmentServer: true, runtime: "generic" },
  ],
  ["@pmmmwh/react-refresh-webpack-plugin", { importedNames: null, runtime: "generic" }],
  [
    "@react-router/dev/vite",
    {
      importedNames: new Set(["reactRouter"]),
      requiresViteDevelopmentServer: true,
      runtime: "react-router",
    },
  ],
  [
    "@remix-run/dev",
    {
      importedNames: new Set(["vitePlugin"]),
      requiresViteDevelopmentServer: true,
      runtime: "remix",
    },
  ],
  ["@rsbuild/plugin-react", { importedNames: new Set(["pluginReact"]), runtime: "generic" }],
  ["@rspack/plugin-react-refresh", { importedNames: null, runtime: "generic" }],
  [
    "@rozenite/vite-plugin",
    {
      importedNames: new Set(["rozenitePlugin"]),
      requiresViteDevelopmentServer: true,
      runtime: "generic",
    },
  ],
  [
    "@tanstack/react-start/plugin/vite",
    {
      importedNames: new Set(["tanstackStart"]),
      requiresViteDevelopmentServer: true,
      runtime: "tanstack",
    },
  ],
]);

const REGISTERED_INTEGRATION_RUNTIME_PRECEDENCE: ReadonlyArray<IntegrationImport["runtime"]> = [
  "tanstack",
  "remix",
  "react-router",
  "generic",
];

const cachedLocalStatusByManifest = new WeakMap<PackageManifest, FastRefreshFileStatus>();
const cachedWorkspaceIndexByManifest = new WeakMap<PackageManifest, WorkspaceFastRefreshIndex>();

const INACTIVE_STATUS: FastRefreshFileStatus = { isActive: false, runtime: "generic" };
const WORKSPACE_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const parseVersion = (version: unknown): ParsedVersion | null => {
  if (typeof version !== "string") return null;
  const match = version.match(/(?:^|[^\d])(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
};

const isVersionAtLeast = (version: unknown, minimum: MinimumVersion): boolean => {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  return (
    parsed.major > minimum.major ||
    (parsed.major === minimum.major && parsed.minor >= minimum.minor)
  );
};

const getDependencyVersion = (manifest: PackageManifest, dependencyName: string): unknown =>
  manifest.dependencies?.[dependencyName] ??
  manifest.devDependencies?.[dependencyName] ??
  manifest.peerDependencies?.[dependencyName] ??
  manifest.optionalDependencies?.[dependencyName];

const getRuntimeDependencyVersion = (manifest: PackageManifest, dependencyName: string): unknown =>
  manifest.dependencies?.[dependencyName] ?? manifest.optionalDependencies?.[dependencyName];

const getOwnedDependencyVersion = (
  manifest: PackageManifest,
  dependencyName: string,
  developmentCommandPattern: RegExp,
): unknown => {
  const runtimeVersion = getRuntimeDependencyVersion(manifest, dependencyName);
  if (runtimeVersion !== undefined) return runtimeVersion;
  const hasDevelopmentCommand = Object.values(manifest.scripts ?? {}).some(
    (script) => typeof script === "string" && developmentCommandPattern.test(script),
  );
  return hasDevelopmentCommand ? manifest.devDependencies?.[dependencyName] : undefined;
};

const hasParcelBrowserEntry = (manifest: PackageManifest): boolean => {
  if (typeof manifest.source === "string" && manifest.source.endsWith(".html")) return true;
  return Object.values(manifest.scripts ?? {}).some(
    (script) =>
      typeof script === "string" &&
      /(?:^|\s)parcel(?:\s+serve)?\s+[^\n]*\.html(?:\s|$)/.test(script),
  );
};

const hasParcelDevelopmentCommand = (manifest: PackageManifest): boolean =>
  Object.values(manifest.scripts ?? {}).some(
    (script) =>
      typeof script === "string" &&
      /(?:^|[\s;&|'\\"])parcel(?=\s|$)(?!\s+(?:build|help|watch|--help|--version|-h|-V)(?:\s|$))/.test(
        script,
      ) &&
      !/(?:^|\s)--no-hmr(?:\s|$)/.test(script),
  );

const hasOwnedDevelopmentCommand = (manifest: PackageManifest, commandPattern: RegExp): boolean =>
  Object.values(manifest.scripts ?? {}).some(
    (script) => typeof script === "string" && commandPattern.test(script),
  );

const hasViteDevelopmentCommand = (manifest: PackageManifest): boolean =>
  Object.values(manifest.scripts ?? {}).some((script) => {
    if (typeof script !== "string") return false;
    const commandMatches = script.matchAll(/(?:^|[\s;&|'\\"])vite(?:\s+(build|preview|test)\b)?/g);
    return [...commandMatches].some((match) => match[1] === undefined);
  });

const hasViteBrowserEntry = (manifest: PackageManifest, packageDirectory: string): boolean => {
  if (typeof manifest.source === "string" && manifest.source.endsWith(".html")) return true;
  const browserEntryPath = path.join(packageDirectory, "index.html");
  recordExistenceProbe(browserEntryPath);
  return fs.existsSync(browserEntryPath);
};

const getBuiltInStatus = (manifest: PackageManifest): FastRefreshFileStatus | null => {
  if (
    isVersionAtLeast(
      getOwnedDependencyVersion(manifest, "next", /(?:^|\s)next\s+dev(?:\s|$)/),
      MINIMUM_FAST_REFRESH_VERSIONS.next,
    )
  ) {
    return { isActive: true, runtime: "next" };
  }
  const gatsbyDependency = getOwnedDependencyVersion(
    manifest,
    "gatsby",
    /(?:^|\s)gatsby\s+develop(?:\s|$)/,
  );
  const gatsbyVersion = parseVersion(gatsbyDependency);
  const hasGatsbyFastRefresh =
    gatsbyVersion !== null &&
    (gatsbyVersion.major >= 3 ||
      (isVersionAtLeast(gatsbyDependency, MINIMUM_FAST_REFRESH_VERSIONS.gatsby) &&
        isVersionAtLeast(
          getDependencyVersion(manifest, "react"),
          MINIMUM_FAST_REFRESH_VERSIONS.reactForGatsbyTwo,
        )));
  if (
    isVersionAtLeast(
      getOwnedDependencyVersion(manifest, "react-scripts", /(?:^|\s)react-scripts\s+start(?:\s|$)/),
      MINIMUM_FAST_REFRESH_VERSIONS.reactScripts,
    ) ||
    hasGatsbyFastRefresh ||
    (isVersionAtLeast(
      getDependencyVersion(manifest, "parcel"),
      MINIMUM_FAST_REFRESH_VERSIONS.parcel,
    ) &&
      declaresDependency(manifest, "react") &&
      hasParcelDevelopmentCommand(manifest) &&
      hasParcelBrowserEntry(manifest))
  ) {
    return { isActive: true, runtime: "generic" };
  }
  if (
    isVersionAtLeast(
      getOwnedDependencyVersion(manifest, "expo", /(?:^|\s)expo\s+start(?:\s|$)/),
      MINIMUM_FAST_REFRESH_VERSIONS.expo,
    ) ||
    isVersionAtLeast(
      getOwnedDependencyVersion(manifest, "react-native", /(?:^|\s)react-native\s+start(?:\s|$)/),
      MINIMUM_FAST_REFRESH_VERSIONS.reactNative,
    )
  ) {
    return { isActive: true, runtime: "expo" };
  }
  if (
    isVersionAtLeast(
      getOwnedDependencyVersion(manifest, "dumi", /(?:^|\s)dumi\s+dev(?:\s|$)/),
      MINIMUM_FAST_REFRESH_VERSIONS.dumi,
    )
  ) {
    return { isActive: true, runtime: "generic" };
  }
  return null;
};

const getIntegrationLocalNames = (
  program: Parameters<typeof walkAst>[0],
  scopes: ScopeAnalysis,
): ReadonlyMap<SymbolDescriptor, IntegrationImport> => {
  const localBindings = new Map<SymbolDescriptor, IntegrationImport>();
  const registerLocalName = (
    source: string,
    importedName: string | null,
    localIdentifier: Parameters<typeof walkAst>[0],
  ): void => {
    const integration = INTEGRATION_IMPORTS.get(source);
    if (!integration) return;
    if (
      integration.importedNames === null
        ? importedName === null || importedName === "default"
        : importedName !== null && integration.importedNames.has(importedName)
    ) {
      const symbol = scopes.symbolFor(localIdentifier);
      if (symbol) localBindings.set(symbol, integration);
    }
  };
  walkAst(program, (node) => {
    if (isNodeOfType(node, "ImportDeclaration")) {
      const source = node.source.value;
      if (typeof source !== "string") return;
      for (const specifier of node.specifiers) {
        if (
          isNodeOfType(specifier, "ImportDefaultSpecifier") ||
          isNodeOfType(specifier, "ImportNamespaceSpecifier")
        ) {
          registerLocalName(source, null, specifier.local);
          continue;
        }
        registerLocalName(source, getImportedName(specifier) ?? null, specifier.local);
      }
      return;
    }
    if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return;
    const initializer = node.init;
    if (
      !isNodeOfType(initializer, "CallExpression") ||
      !isNodeOfType(initializer.callee, "Identifier") ||
      initializer.callee.name !== "require"
    ) {
      return;
    }
    const sourceArgument = initializer.arguments[0];
    if (!sourceArgument || !isNodeOfType(sourceArgument, "Literal")) return;
    const source = sourceArgument.value;
    if (typeof source !== "string") return;
    if (isNodeOfType(node.id, "Identifier")) {
      registerLocalName(source, null, node.id);
      return;
    }
    if (!isNodeOfType(node.id, "ObjectPattern")) return;
    for (const property of node.id.properties) {
      if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier")) {
        continue;
      }
      const importedName = isNodeOfType(property.key, "Identifier")
        ? property.key.name
        : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
          ? property.key.value
          : null;
      registerLocalName(source, importedName, property.value);
    }
  });
  return localBindings;
};

const isModuleExportsAssignment = (node: Parameters<typeof walkAst>[0]): boolean =>
  isNodeOfType(node, "AssignmentExpression") &&
  isNodeOfType(node.left, "MemberExpression") &&
  isNodeOfType(node.left.object, "Identifier") &&
  node.left.object.name === "module" &&
  isNodeOfType(node.left.property, "Identifier") &&
  node.left.property.name === "exports";

const getExportedBindings = (
  program: Parameters<typeof walkAst>[0],
  scopes: ScopeAnalysis,
): ReadonlySet<SymbolDescriptor> => {
  const exportedBindings = new Set<SymbolDescriptor>();
  walkAst(program, (node) => {
    let exportRoot: Parameters<typeof walkAst>[0] | null = null;
    if (isNodeOfType(node, "ExportDefaultDeclaration")) {
      exportRoot = node.declaration;
    } else if (isNodeOfType(node, "AssignmentExpression") && isModuleExportsAssignment(node)) {
      exportRoot = node.right;
    }
    if (!exportRoot) return;
    if (isFunctionLike(exportRoot) || isNodeOfType(exportRoot, "ObjectExpression")) return;
    walkAst(exportRoot, (exportNode) => {
      if (isFunctionLike(exportNode) || isNodeOfType(exportNode, "ObjectExpression")) return false;
      if (!isNodeOfType(exportNode, "Identifier")) return;
      const symbol = scopes.symbolFor(exportNode);
      if (symbol) exportedBindings.add(symbol);
    });
  });
  return exportedBindings;
};

const isExportedConfigProperty = (
  property: Parameters<typeof walkAst>[0],
  exportedBindings: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  let ancestor = property.parent;
  let didFindContainingObject = false;
  let didCrossNestedProperty = false;
  let didCrossFunctionBoundary = false;
  let containingFunction: Parameters<typeof walkAst>[0] | null = null;
  let containingReturn: Parameters<typeof walkAst>[0] | null = null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "ObjectExpression") && !didFindContainingObject) {
      didFindContainingObject = true;
    } else if (didFindContainingObject && isNodeOfType(ancestor, "Property")) {
      didCrossNestedProperty = true;
    }
    if (!containingReturn && isNodeOfType(ancestor, "ReturnStatement")) {
      containingReturn = ancestor;
    }
    if (isFunctionLike(ancestor)) {
      if (containingFunction) didCrossFunctionBoundary = true;
      else containingFunction = ancestor;
    }
    if (isNodeOfType(ancestor, "ExportDefaultDeclaration") || isModuleExportsAssignment(ancestor)) {
      return (
        !didCrossNestedProperty &&
        !didCrossFunctionBoundary &&
        (!containingFunction ||
          Boolean(containingReturn) ||
          !isNodeOfType(containingFunction.body, "BlockStatement"))
      );
    }
    if (isNodeOfType(ancestor, "VariableDeclarator") && isNodeOfType(ancestor.id, "Identifier")) {
      const binding = scopes.symbolFor(ancestor.id);
      if (binding && exportedBindings.has(binding)) {
        return !didCrossNestedProperty && !containingFunction;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getExplicitConfigPaths = (
  packageDirectory: string,
  manifest: PackageManifest,
): ReadonlyArray<string> => {
  const configPaths = new Set(
    FAST_REFRESH_CONFIG_FILENAMES.map((configFilename) =>
      path.join(packageDirectory, configFilename),
    ),
  );
  for (const script of Object.values(manifest.scripts ?? {})) {
    if (typeof script !== "string") continue;
    for (const match of script.matchAll(
      /(?:^|\s)--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
    )) {
      const relativeConfigPath = match[1] ?? match[2] ?? match[3];
      if (!relativeConfigPath) continue;
      const configPath = path.resolve(packageDirectory, relativeConfigPath);
      const relativePath = path.relative(packageDirectory, configPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
      configPaths.add(configPath);
    }
  }
  return [...configPaths];
};

const getRegisteredIntegration = (
  packageDirectory: string,
  manifest: PackageManifest,
): FastRefreshFileStatus | null => {
  for (const configPath of getExplicitConfigPaths(packageDirectory, manifest)) {
    const program = parseSourceFile(configPath);
    if (!program) continue;
    const scopes = analyzeScopes(program);
    const integrationLocalBindings = getIntegrationLocalNames(program, scopes);
    if (integrationLocalBindings.size === 0) continue;
    const exportedBindings = getExportedBindings(program, scopes);
    const registeredIntegrations: IntegrationImport[] = [];
    walkAst(program, (node) => {
      if (!isNodeOfType(node, "Property")) return;
      const isPluginsProperty =
        (isNodeOfType(node.key, "Identifier") && node.key.name === "plugins") ||
        (isNodeOfType(node.key, "Literal") && node.key.value === "plugins");
      if (!isPluginsProperty) return;
      if (!isExportedConfigProperty(node, exportedBindings, scopes)) return;
      const inspectedBindings = new Set<number>();
      const inspectValue = (value: Parameters<typeof walkAst>[0]): void => {
        walkAst(value, (valueNode) => {
          if (isNodeOfType(valueNode, "Identifier")) {
            const symbol = scopes.symbolFor(valueNode);
            const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
            if (symbol && initializer && !inspectedBindings.has(symbol.id)) {
              inspectedBindings.add(symbol.id);
              inspectValue(initializer);
            }
          }
          if (
            !isNodeOfType(valueNode, "CallExpression") &&
            !isNodeOfType(valueNode, "NewExpression")
          ) {
            return;
          }
          if (!isNodeOfType(valueNode.callee, "Identifier")) return;
          const symbol = scopes.symbolFor(valueNode.callee);
          const integration = symbol ? integrationLocalBindings.get(symbol) : null;
          if (integration) registeredIntegrations.push(integration);
        });
      };
      inspectValue(node.value);
      return false;
    });
    const hasViteDevelopmentRuntime =
      hasViteDevelopmentCommand(manifest) || hasViteBrowserEntry(manifest, packageDirectory);
    const registeredIntegration = REGISTERED_INTEGRATION_RUNTIME_PRECEDENCE.flatMap((runtime) =>
      registeredIntegrations.filter(
        (integration) =>
          integration.runtime === runtime &&
          (!integration.requiresViteDevelopmentServer || hasViteDevelopmentRuntime),
      ),
    )[0];
    if (registeredIntegration) {
      return { isActive: true, runtime: registeredIntegration.runtime };
    }
  }
  return null;
};

const hasStorybookReactViteConfig = (packageDirectory: string): boolean => {
  for (const configFilename of ["main.ts", "main.js", "main.mjs", "main.cjs"]) {
    const program = parseSourceFile(path.join(packageDirectory, ".storybook", configFilename));
    if (!program) continue;
    const scopes = analyzeScopes(program);
    const exportedBindings = getExportedBindings(program, scopes);
    let hasReactViteFramework = false;
    walkAst(program, (node) => {
      if (!isNodeOfType(node, "Property")) return;
      const isFrameworkProperty =
        (isNodeOfType(node.key, "Identifier") && node.key.name === "framework") ||
        (isNodeOfType(node.key, "Literal") && node.key.value === "framework");
      if (!isFrameworkProperty) return;
      if (!isExportedConfigProperty(node, exportedBindings, scopes)) return;
      walkAst(node.value, (valueNode) => {
        if (isNodeOfType(valueNode, "Literal") && valueNode.value === "@storybook/react-vite") {
          hasReactViteFramework = true;
          return false;
        }
      });
      if (hasReactViteFramework) return false;
    });
    if (hasReactViteFramework) return true;
  }
  return false;
};

const resolveDirectUnreassignedValue = (
  value: Parameters<typeof walkAst>[0],
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): Parameters<typeof walkAst>[0] => {
  const unwrappedValue = stripParenExpression(value);
  if (!isNodeOfType(unwrappedValue, "Identifier")) return unwrappedValue;
  const symbol = scopes.symbolFor(unwrappedValue);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return unwrappedValue;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return unwrappedValue;
  visitedSymbolIds.add(symbol.id);
  return resolveDirectUnreassignedValue(initializer, scopes, visitedSymbolIds);
};

const isStaticPropertyNamed = (
  node: Parameters<typeof walkAst>[0],
  propertyName: string,
): boolean =>
  isNodeOfType(node, "Property") &&
  ((!node.computed && isNodeOfType(node.key, "Identifier") && node.key.name === propertyName) ||
    (isNodeOfType(node.key, "Literal") && node.key.value === propertyName));

const readLastStaticBooleanProperty = (
  value: Parameters<typeof walkAst>[0],
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean | null => {
  const resolvedValue = resolveDirectUnreassignedValue(value, scopes);
  if (!isNodeOfType(resolvedValue, "ObjectExpression")) return null;
  let propertyValue: boolean | null = null;
  for (const property of resolvedValue.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      propertyValue = null;
      continue;
    }
    if (!isStaticPropertyNamed(property, propertyName) || !isNodeOfType(property, "Property")) {
      continue;
    }
    const resolvedPropertyValue = resolveDirectUnreassignedValue(property.value, scopes);
    propertyValue = readStaticBoolean(resolvedPropertyValue);
  }
  return propertyValue;
};

const isLastStaticPropertyInObject = (
  property: Parameters<typeof walkAst>[0],
  propertyName: string,
): boolean => {
  if (!isNodeOfType(property.parent, "ObjectExpression")) return false;
  const propertyIndex = property.parent.properties.findIndex(
    (objectProperty) => objectProperty === property,
  );
  return property.parent.properties.slice(propertyIndex + 1).every((laterProperty) => {
    if (isNodeOfType(laterProperty, "SpreadElement")) return false;
    return !isStaticPropertyNamed(laterProperty, propertyName);
  });
};

const hasStorybookReactWebpackFastRefreshConfig = (packageDirectory: string): boolean => {
  for (const configFilename of ["main.ts", "main.js", "main.mjs", "main.cjs"]) {
    const program = parseSourceFile(path.join(packageDirectory, ".storybook", configFilename));
    if (!program) continue;
    const scopes = analyzeScopes(program);
    const exportedBindings = getExportedBindings(program, scopes);
    let hasFastRefresh = false;
    walkAst(program, (node) => {
      if (!isStaticPropertyNamed(node, "reactOptions") || !isNodeOfType(node, "Property")) return;
      if (!isExportedConfigProperty(node, exportedBindings, scopes)) return;
      if (!isLastStaticPropertyInObject(node, "reactOptions")) return;
      if (readLastStaticBooleanProperty(node.value, "fastRefresh", scopes) === true) {
        hasFastRefresh = true;
        return false;
      }
    });
    if (hasFastRefresh) return true;
  }
  return false;
};

const hasStorybookReactViteIntegration = (
  packageDirectory: string,
  manifest: PackageManifest,
): boolean =>
  hasOwnedDevelopmentCommand(manifest, /(?:^|\s)(?:storybook\s+dev|start-storybook)(?:\s|$)/) &&
  hasStorybookReactViteConfig(packageDirectory);

const hasStorybookReactWebpackFastRefreshIntegration = (
  packageDirectory: string,
  manifest: PackageManifest,
): boolean => {
  const developmentCommandPattern = /(?:^|\s)(?:storybook\s+dev|start-storybook)(?:\s|$)/;
  if (!hasOwnedDevelopmentCommand(manifest, developmentCommandPattern)) return false;
  const storybookReactVersion =
    getOwnedDependencyVersion(manifest, "@storybook/react", developmentCommandPattern) ??
    getOwnedDependencyVersion(manifest, "@storybook/react-webpack5", developmentCommandPattern);
  return (
    isVersionAtLeast(storybookReactVersion, MINIMUM_FAST_REFRESH_VERSIONS.storybookReact) &&
    hasStorybookReactWebpackFastRefreshConfig(packageDirectory)
  );
};

const hasNxStorybookReactViteIntegration = (packageDirectory: string): boolean => {
  if (!hasStorybookReactViteConfig(packageDirectory)) return false;
  try {
    const project: unknown = JSON.parse(
      fs.readFileSync(path.join(packageDirectory, "project.json"), "utf8"),
    );
    if (typeof project !== "object" || project === null) return false;
    const targets = Reflect.get(project, "targets");
    if (typeof targets !== "object" || targets === null) return false;
    return Object.keys(targets).some((targetName) => targetName === "storybook:serve:dev");
  } catch {
    return false;
  }
};

const getLocalFastRefreshStatus = (
  packageDirectory: string,
  manifest: PackageManifest,
): FastRefreshFileStatus => {
  const cachedStatus = cachedLocalStatusByManifest.get(manifest);
  if (cachedStatus) return cachedStatus;
  const status =
    getBuiltInStatus(manifest) ??
    (hasStorybookReactViteIntegration(packageDirectory, manifest) ||
    hasNxStorybookReactViteIntegration(packageDirectory) ||
    hasStorybookReactWebpackFastRefreshIntegration(packageDirectory, manifest)
      ? { isActive: true, runtime: "generic" }
      : null) ??
    getRegisteredIntegration(packageDirectory, manifest) ??
    INACTIVE_STATUS;
  cachedLocalStatusByManifest.set(manifest, status);
  return status;
};

const isWorkspaceRoot = (directory: string, manifest: PackageManifest | null): boolean => {
  if (manifest?.workspaces !== undefined) return true;
  return ["pnpm-workspace.yaml", "pnpm-workspace.yml", "nx.json"].some((filename) =>
    fs.existsSync(path.join(directory, filename)),
  );
};

const findWorkspaceRoot = (packageDirectory: string): string | null => {
  let currentDirectory = packageDirectory;
  let workspaceRoot: string | null = null;
  while (true) {
    const manifest = readPackageManifest(currentDirectory);
    if (isWorkspaceRoot(currentDirectory, manifest)) workspaceRoot = currentDirectory;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return workspaceRoot;
    currentDirectory = parentDirectory;
  }
};

const collectWorkspacePackages = (workspaceRoot: string): WorkspacePackage[] => {
  const packages: WorkspacePackage[] = [];
  const pendingDirectories = [workspaceRoot];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (!directory) continue;
    const manifest = readPackageManifest(directory);
    if (manifest) {
      packages.push({
        directory,
        manifest,
        status: getLocalFastRefreshStatus(directory, manifest),
      });
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || WORKSPACE_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      pendingDirectories.push(path.join(directory, entry.name));
    }
  }
  return packages;
};

const isPropertyNamed = (node: Parameters<typeof walkAst>[0], name: string): boolean =>
  isNodeOfType(node, "Property") &&
  ((isNodeOfType(node.key, "Identifier") && node.key.name === name) ||
    (isNodeOfType(node.key, "Literal") && node.key.value === name));

const normalizeAliasRoot = (configDirectory: string, aliasPath: string): string | null => {
  if (!aliasPath.startsWith(".") && !path.isAbsolute(aliasPath)) return null;
  const withoutPlaceholder = aliasPath.replace(/(?:\/)?(?:\*|\$\d+).*$/, "");
  return path.resolve(configDirectory, withoutPlaceholder);
};

const collectAliasRootsFromValue = (
  value: Parameters<typeof walkAst>[0],
  configDirectory: string,
  aliasRoots: Set<string>,
): void => {
  walkAst(value, (node) => {
    if (!isPropertyNamed(node, "alias")) return;
    if (!isNodeOfType(node, "Property")) return;
    walkAst(node.value, (aliasNode) => {
      if (!isNodeOfType(aliasNode, "Literal") || typeof aliasNode.value !== "string") return;
      const aliasRoot = normalizeAliasRoot(configDirectory, aliasNode.value);
      if (aliasRoot) aliasRoots.add(aliasRoot);
    });
    return false;
  });
};

const getActivePackageAliasRoots = (
  packageDirectory: string,
  manifest: PackageManifest,
): ReadonlySet<string> => {
  const aliasRoots = new Set<string>();
  const configPaths = [
    ...getExplicitConfigPaths(packageDirectory, manifest),
    ...["main.ts", "main.js", "main.mjs", "main.cjs"].map((filename) =>
      path.join(packageDirectory, ".storybook", filename),
    ),
  ];
  for (const configPath of configPaths) {
    const program = parseSourceFile(configPath);
    if (!program) continue;
    const scopes = analyzeScopes(program);
    const exportedBindings = getExportedBindings(program, scopes);
    walkAst(program, (node) => {
      if (!isPropertyNamed(node, "resolve") && !isPropertyNamed(node, "viteFinal")) return;
      if (!isNodeOfType(node, "Property")) return;
      if (!isExportedConfigProperty(node, exportedBindings, scopes)) return;
      collectAliasRootsFromValue(node.value, path.dirname(configPath), aliasRoots);
      return false;
    });
  }
  return aliasRoots;
};

const collectStringValues = (value: unknown, values: string[]): void => {
  if (typeof value === "string") {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, values);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const entry of Object.values(value)) collectStringValues(entry, values);
};

const hasSourceRuntimeEntry = (manifest: PackageManifest): boolean => {
  const entryValues: string[] = [];
  collectStringValues(manifest.exports, entryValues);
  collectStringValues(manifest.main, entryValues);
  collectStringValues(manifest.module, entryValues);
  return entryValues.some((entry) => /^\.\/?src(?:\/|\.|$)/.test(entry));
};

const getWorkspaceDependencyVersion = (
  manifest: PackageManifest,
  dependencyName: string,
): unknown =>
  manifest.dependencies?.[dependencyName] ?? manifest.optionalDependencies?.[dependencyName];

const buildWorkspaceFastRefreshIndex = (
  workspaceRoot: string,
  rootManifest: PackageManifest,
): WorkspaceFastRefreshIndex => {
  const cached = cachedWorkspaceIndexByManifest.get(rootManifest);
  if (cached) return cached;
  const workspacePackages = collectWorkspacePackages(workspaceRoot);
  const activePackages = workspacePackages.filter(
    (workspacePackage) => workspacePackage.status.isActive,
  );
  const aliasOwners: Array<{ rootDirectory: string; status: FastRefreshFileStatus }> = [];
  for (const activePackage of activePackages) {
    for (const rootDirectory of getActivePackageAliasRoots(
      activePackage.directory,
      activePackage.manifest,
    )) {
      aliasOwners.push({ rootDirectory, status: activePackage.status });
    }
  }
  const sourceEntryOwners = new Map<string, FastRefreshFileStatus>();
  for (const producerPackage of workspacePackages) {
    const packageName = producerPackage.manifest.name;
    if (typeof packageName !== "string" || !hasSourceRuntimeEntry(producerPackage.manifest)) {
      continue;
    }
    const owner = activePackages.find((activePackage) => {
      const dependencyVersion = getWorkspaceDependencyVersion(activePackage.manifest, packageName);
      return typeof dependencyVersion === "string" && dependencyVersion.startsWith("workspace:");
    });
    if (owner) sourceEntryOwners.set(producerPackage.directory, owner.status);
  }
  const index = { aliasOwners, sourceEntryOwners };
  cachedWorkspaceIndexByManifest.set(rootManifest, index);
  return index;
};

const isPathInside = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
};

const getWorkspaceOwnedStatus = (
  filename: string,
  packageDirectory: string,
): FastRefreshFileStatus | null => {
  const workspaceRoot = findWorkspaceRoot(packageDirectory);
  if (!workspaceRoot) return null;
  const rootManifest = readPackageManifest(workspaceRoot);
  if (!rootManifest) return null;
  const index = buildWorkspaceFastRefreshIndex(workspaceRoot, rootManifest);
  const aliasOwner = index.aliasOwners.find((owner) => isPathInside(filename, owner.rootDirectory));
  if (aliasOwner) return aliasOwner.status;
  for (const [producerDirectory, status] of index.sourceEntryOwners) {
    if (isPathInside(filename, producerDirectory)) return status;
  }
  return null;
};

const resolveFastRefreshFileStatus = (filename: string): FastRefreshFileStatus => {
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return INACTIVE_STATUS;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return INACTIVE_STATUS;
  const localStatus = getLocalFastRefreshStatus(packageDirectory, manifest);
  if (localStatus.isActive) return localStatus;
  return getWorkspaceOwnedStatus(filename, packageDirectory) ?? INACTIVE_STATUS;
};

export const probeFastRefreshFileStatus = (filename: string): FastRefreshFileStatus =>
  resolveFastRefreshFileStatus(path.resolve(filename));

const getConfiguredFallbackStatus = (context: RuleContext): FastRefreshFileStatus => {
  const framework = getReactDoctorStringSetting(context.settings, "framework");
  const runtime =
    framework === "nextjs"
      ? "next"
      : framework === "expo" || framework === "react-native"
        ? "expo"
        : framework === "remix"
          ? "remix"
          : framework === "tanstack-start"
            ? "tanstack"
            : "generic";
  return { isActive: true, runtime };
};

export const getFastRefreshFileStatus = (context: RuleContext): FastRefreshFileStatus => {
  let filename = context.filename;
  if (!filename) return getConfiguredFallbackStatus(context);
  if (!path.isAbsolute(filename)) {
    const absoluteFilename = path.resolve(filename);
    if (!fs.existsSync(absoluteFilename)) return getConfiguredFallbackStatus(context);
    filename = absoluteFilename;
  }
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return INACTIVE_STATUS;
  return resolveFastRefreshFileStatus(filename);
};
