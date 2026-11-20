import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
  type PackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const VITE_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
];
// These locked default plugin factories leave the React module binding intact.
const STOCK_VITE_PLUGINS = new Map([
  ["@vitejs/plugin-react", { factory: "default", version: "6.0.1" }],
  ["@tailwindcss/vite", { factory: "default", version: "4.2.4" }],
  ["@tanstack/devtools-vite", { factory: "devtools", version: "0.6.0" }],
]);
const CONFIG_IMPORTS = new Set(["vite", "path", "node:path", ...STOCK_VITE_PLUGINS.keys()]);
const SUPPORTED_CONFIG_FIELDS = new Set(["plugins", "resolve", "server", "build", "clearScreen"]);
const STABLE_BUILD_FIELDS = new Set([
  "chunkSizeWarningLimit",
  "outDir",
  "target",
  "sourcemap",
  "minify",
]);
const STABLE_SERVER_FIELDS = new Set(["port", "strictPort", "host", "hmr", "watch"]);
const PACKAGE_INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const MANIFEST_OVERRIDE_KEYS = [
  "overrides",
  "resolutions",
  "pnpm",
  "workspaces",
  "imports",
  "browser",
];
const STABLE_EXACT_RELEASE = /^\d+\.\d+\.\d+$/;
const MAX_PACKAGE_LOCK_BYTES = 2 * 1024 * 1024;
const npmLockMetadataByPath = new Map<
  string,
  {
    readonly mtimeMs: number;
    readonly ctimeMs: number;
    readonly size: number;
    readonly packages: Record<string, unknown> | null;
  }
>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readLockedPackages = (filename: string): Record<string, unknown> | null => {
  recordContentProbe(filename);
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > MAX_PACKAGE_LOCK_BYTES) return null;
    const cached = npmLockMetadataByPath.get(filename);
    if (
      cached?.mtimeMs === stat.mtimeMs &&
      cached.ctimeMs === stat.ctimeMs &&
      cached.size === stat.size
    )
      return cached.packages;
    const lock = asRecord(JSON.parse(fs.readFileSync(filename, "utf8")));
    const packages = lock?.lockfileVersion === 3 ? asRecord(lock.packages) : null;
    const selectedPackages = packages
      ? Object.fromEntries(
          ["react", "vite", ...STOCK_VITE_PLUGINS.keys()].map((name) => {
            const key = `node_modules/${name}`;
            return [key, packages[key]];
          }),
        )
      : null;
    npmLockMetadataByPath.set(filename, {
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      packages: selectedPackages,
    });
    return selectedPackages;
  } catch {
    return null;
  }
};

const isRegistryLockedPackage = (
  manifest: PackageManifest,
  packages: Record<string, unknown>,
  name: string,
  version?: string,
): boolean => {
  const entry = asRecord(packages[`node_modules/${name}`]);
  if (
    !entry ||
    typeof entry.version !== "string" ||
    !STABLE_EXACT_RELEASE.test(entry.version) ||
    (version !== undefined && entry.version !== version) ||
    entry.link === true ||
    (entry.name !== undefined && entry.name !== name)
  )
    return false;
  const declarations = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].flatMap((group) => (group?.[name] === undefined ? [] : [group[name]]));
  const [declared] = declarations;
  if (
    declarations.length !== 1 ||
    (declared !== entry.version &&
      declared !== `^${entry.version}` &&
      declared !== `~${entry.version}`)
  )
    return false;
  return (
    entry.resolved ===
      `https://registry.npmjs.org/${name}/-/${path.posix.basename(name)}-${entry.version}.tgz` &&
    typeof entry.integrity === "string" &&
    /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
  );
};

const getObjectProperties = (
  node: EsTreeNode | null | undefined,
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (!isNodeOfType(property, "Property") || property.computed || property.kind !== "init")
      return null;
    const key = getStaticPropertyKeyName(property);
    if (key === null || properties.has(key) || key === "__proto__") return null;
    properties.set(key, property.value);
  }
  return properties;
};

const getModuleBinding = (node: EsTreeNode, scopes: ScopeAnalysis): [string, string] | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  if (!symbol || symbol.references.some(({ flag }) => flag !== "read")) return null;
  const source = getValueImportSource(symbol);
  if (!source) return null;
  if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return [source, "default"];
  const name = getImportedName(symbol.declarationNode);
  return name ? [source, name] : null;
};

const isEnvironmentField = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.optional ||
    node.computed ||
    !isNodeOfType(node.property, "Identifier")
  )
    return false;
  const environment = node.object;
  return (
    isNodeOfType(environment, "MemberExpression") &&
    !environment.optional &&
    !environment.computed &&
    isNodeOfType(environment.property, "Identifier") &&
    environment.property.name === "env" &&
    isNodeOfType(environment.object, "Identifier") &&
    environment.object.name === "process" &&
    scopes.isGlobalReference(environment.object)
  );
};

const getEnvironmentNames = (
  statements: readonly EsTreeNode[],
  scopes: ScopeAnalysis,
): ReadonlySet<number> | null => {
  const names = new Set<number>();
  for (const statement of statements) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) continue;
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (
        typeof statement.source.value !== "string" ||
        !CONFIG_IMPORTS.has(statement.source.value) ||
        statement.specifiers.length === 0
      )
        return null;
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
    for (const declaration of statement.declarations) {
      if (
        !isNodeOfType(declaration.id, "Identifier") ||
        !declaration.init ||
        !isEnvironmentField(declaration.init, scopes)
      )
        return null;
      const symbol = scopes.symbolFor(declaration.id);
      if (!symbol || symbol.references.some(({ flag }) => flag !== "read")) return null;
      names.add(symbol.id);
    }
  }
  return names;
};

const isPlainConfigValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  environments: ReadonlySet<number>,
): boolean => {
  if (isNodeOfType(node, "Literal")) return !("regex" in node);
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.symbolFor(node);
    return symbol
      ? environments.has(symbol.id)
      : node.name === "undefined" && scopes.isGlobalReference(node);
  }
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every(
      (item) => item !== null && isPlainConfigValue(item, scopes, environments),
    );
  if (isNodeOfType(node, "ObjectExpression")) {
    const fields = getObjectProperties(node);
    return (
      fields !== null &&
      [...fields.values()].every((value) => isPlainConfigValue(value, scopes, environments))
    );
  }
  if (isNodeOfType(node, "LogicalExpression"))
    return (
      isPlainConfigValue(node.left, scopes, environments) &&
      isPlainConfigValue(node.right, scopes, environments)
    );
  if (isNodeOfType(node, "ConditionalExpression")) {
    return [node.test, node.consequent, node.alternate].every((value) =>
      isPlainConfigValue(value, scopes, environments),
    );
  }
  return false;
};

const isUnrelatedAlias = (value: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(value, "Literal")) return typeof value.value === "string";
  if (!isNodeOfType(value, "CallExpression") || value.optional) return false;
  const member = value.callee;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "resolve"
  )
    return false;
  const binding = getModuleBinding(member.object, scopes);
  if (!binding || (binding[0] !== "path" && binding[0] !== "node:path") || binding[1] !== "default")
    return false;
  return value.arguments.every(
    (arg) =>
      (isNodeOfType(arg, "Literal") && typeof arg.value === "string") ||
      (isNodeOfType(arg, "Identifier") &&
        arg.name === "__dirname" &&
        scopes.isGlobalReference(arg)),
  );
};

const hasOnlyOrdinaryConfiguredImports = (
  program: EsTreeNode,
  manifest: PackageManifest,
  lockedPackages: Record<string, unknown>,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const scopes = analyzeScopes(program);
  const exports = program.body.filter((node) => isNodeOfType(node, "ExportDefaultDeclaration"));
  if (exports.length !== 1) return false;
  const statement = exports[0];
  if (!isNodeOfType(statement, "ExportDefaultDeclaration")) return false;
  const wrapper = stripParenExpression(statement.declaration);
  if (
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.optional ||
    wrapper.arguments.length !== 1
  )
    return false;
  const [moduleName, exportedName] = getModuleBinding(wrapper.callee, scopes) ?? [];
  if (moduleName !== "vite" || exportedName !== "defineConfig") return false;
  const [argument] = wrapper.arguments;
  const config =
    isNodeOfType(argument, "ArrowFunctionExpression") && argument.params.length === 0
      ? stripParenExpression(argument.body)
      : argument;
  const fields = getObjectProperties(config);
  const environments = getEnvironmentNames(program.body, scopes);
  if (
    !fields ||
    !environments ||
    ![...fields.keys()].every((name) => SUPPORTED_CONFIG_FIELDS.has(name))
  )
    return false;

  const pluginList = fields.get("plugins");
  if (
    pluginList &&
    (!isNodeOfType(pluginList, "ArrayExpression") ||
      !pluginList.elements.every((item) => {
        if (!isNodeOfType(item, "CallExpression") || item.optional || item.arguments.length !== 0)
          return false;
        const [pluginSource, factory] = getModuleBinding(item.callee, scopes) ?? [];
        if (pluginSource === undefined) return false;
        const plugin = STOCK_VITE_PLUGINS.get(pluginSource);
        return (
          plugin !== undefined &&
          factory === plugin.factory &&
          isRegistryLockedPackage(manifest, lockedPackages, pluginSource, plugin.version)
        );
      }))
  )
    return false;

  const resolve = fields.get("resolve");
  if (resolve) {
    const options = getObjectProperties(resolve);
    if (!options || [...options.keys()].some((name) => name !== "alias")) return false;
    const alias = options.get("alias");
    if (alias) {
      const aliases = getObjectProperties(alias);
      if (
        !aliases ||
        ![...aliases].every(
          ([name, value]) =>
            name.length > 0 &&
            name !== "react" &&
            !name.startsWith("react/") &&
            isUnrelatedAlias(value, scopes),
        )
      )
        return false;
    }
  }
  const build = fields.get("build");
  if (build) {
    const settings = getObjectProperties(build);
    if (
      !settings ||
      ![...settings].every(
        ([name, value]) =>
          STABLE_BUILD_FIELDS.has(name) && isPlainConfigValue(value, scopes, environments),
      )
    )
      return false;
  }
  const server = fields.get("server");
  if (server) {
    const settings = getObjectProperties(server);
    if (
      !settings ||
      ![...settings].every(
        ([name, value]) =>
          STABLE_SERVER_FIELDS.has(name) && isPlainConfigValue(value, scopes, environments),
      )
    )
      return false;
  }
  const clearScreen = fields.get("clearScreen");
  if (
    clearScreen &&
    (!isNodeOfType(clearScreen, "Literal") || typeof clearScreen.value !== "boolean")
  )
    return false;
  return true;
};

export const hasOrdinaryViteReactProvider = (filename: string | undefined): boolean => {
  if (!filename || !path.isAbsolute(filename)) return false;
  const directory = findNearestPackageDirectory(filename);
  if (!directory) return false;
  const manifest = readPackageManifest(directory);
  if (!manifest || MANIFEST_OVERRIDE_KEYS.some((key) => Reflect.has(manifest, key))) return false;
  if (manifest.dependencies?.react === undefined) return false;
  const build = manifest.scripts?.build;
  if (build !== "vite build" && build !== "tsc && vite build") return false;
  if (
    PACKAGE_INSTALL_SCRIPTS.some((name) => manifest.scripts?.[name] !== undefined) ||
    manifest.scripts?.prebuild !== undefined ||
    manifest.scripts?.predev !== undefined ||
    (manifest.scripts?.dev !== undefined && manifest.scripts.dev !== "vite")
  )
    return false;
  const lockedPackages = readLockedPackages(path.join(directory, "package-lock.json"));
  if (
    !lockedPackages ||
    !isRegistryLockedPackage(manifest, lockedPackages, "react") ||
    !isRegistryLockedPackage(manifest, lockedPackages, "vite")
  )
    return false;

  const configs = VITE_CONFIG_FILES.map((name) => path.join(directory, name)).filter((name) => {
    recordExistenceProbe(name);
    try {
      return fs.statSync(name, { throwIfNoEntry: false })?.isFile() === true;
    } catch {
      return true;
    }
  });
  if (configs.length !== 1) return false;
  const config = parseSourceFile(configs[0]);
  return config !== null && hasOnlyOrdinaryConfiguredImports(config, manifest, lockedPackages);
};
