import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import {
  captureCrossFileProbes,
  recordContentProbe,
  recordExistenceProbe,
  replayCrossFileProbes,
  type CrossFileProbeTrace,
} from "../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  getManifestCacheGeneration,
  readPackageManifest,
} from "../../utils/read-nearest-package-manifest.js";
import { resolveModulePath } from "../../utils/resolve-module-path.js";
import { resolvePackageVersion } from "../../utils/resolve-package-version.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

export const LODASH_DEBOUNCE_SUBPATH = "lodash/debounce";

const BUILD_CONFIG_STEMS = [
  "vite.config",
  "rollup.config",
  "webpack.config",
  "rspack.config",
  "rsbuild.config",
  "next.config",
  "babel.config",
];
const BUILD_CONFIG_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"];
const CONFIG_FILENAMES = BUILD_CONFIG_STEMS.flatMap((stem) =>
  BUILD_CONFIG_EXTENSIONS.map((extension) => stem + extension),
);

const isProviderAlias = (name: string): boolean => {
  const prefix = name.endsWith("$") ? name.slice(0, -1) : name;
  return (
    prefix === "react" ||
    prefix === "lodash" ||
    LODASH_DEBOUNCE_SUBPATH === prefix ||
    LODASH_DEBOUNCE_SUBPATH.startsWith(prefix + "/")
  );
};

const isLiteralUnrelatedAliasEntries = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "ArrayExpression") &&
  expression.elements.every((entry) => {
    if (
      !isNodeOfType(entry, "ObjectExpression") ||
      entry.properties.length !== 2 ||
      !entry.properties.every(
        (property) => isNodeOfType(property, "Property") && property.kind === "init",
      )
    ) {
      return false;
    }
    const find = entry.properties.find(
      (property) => getStaticPropertyKeyName(property, { allowComputedString: true }) === "find",
    );
    const replacement = entry.properties.find(
      (property) =>
        getStaticPropertyKeyName(property, { allowComputedString: true }) === "replacement",
    );
    if (
      !replacement ||
      !isNodeOfType(find, "Property") ||
      !isNodeOfType(find.value, "Literal") ||
      typeof find.value.value !== "string"
    ) {
      return false;
    }
    return !isProviderAlias(find.value.value);
  });

const isLiteralUnrelatedAliasMap = (expression: EsTreeNode): boolean => {
  const map = stripParenExpression(expression);
  if (isNodeOfType(map, "ArrayExpression")) return isLiteralUnrelatedAliasEntries(map);
  return (
    isNodeOfType(map, "ObjectExpression") &&
    map.properties.every((property) => {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") return false;
      const key = getStaticPropertyKeyName(property, { allowComputedString: true });
      return key !== null && !isProviderAlias(key);
    })
  );
};

const hasOnlyUnrelatedRollupAliasCalls = (program: EsTreeNode): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const imports = program.body.filter(
    (statement) =>
      isNodeOfType(statement, "ImportDeclaration") &&
      statement.source.value === "@rollup/plugin-alias",
  );
  if (imports.length === 0) return true;
  const scopes = analyzeScopes(program);
  return imports.every((statement) => {
    if (!isNodeOfType(statement, "ImportDeclaration") || statement.specifiers.length !== 1) {
      return false;
    }
    const binding = scopes.symbolFor(statement.specifiers[0].local);
    if (!binding || getValueImportSource(binding) !== "@rollup/plugin-alias") return false;
    return binding.references.every(({ identifier, flag }) => {
      const call = identifier.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== identifier ||
        call.arguments.length !== 1
      ) {
        return false;
      }
      const options = call.arguments[0];
      if (!isNodeOfType(options, "ObjectExpression") || options.properties.length !== 1) {
        return false;
      }
      const entries = options.properties[0];
      return (
        isNodeOfType(entries, "Property") &&
        entries.kind === "init" &&
        getStaticPropertyKeyName(entries) === "entries" &&
        isLiteralUnrelatedAliasEntries(entries.value)
      );
    });
  });
};

const isSupportedBuildConfig = (configPath: string): boolean => {
  recordExistenceProbe(configPath);
  if (!fs.existsSync(configPath)) return true;
  const program = parseSourceFile(configPath);
  if (!program || !hasOnlyUnrelatedRollupAliasCalls(program)) return false;
  let hasRemap = false;
  walkAst(program, (node) => {
    if (hasRemap) return false;
    if (
      isNodeOfType(node, "Literal") &&
      (node.value === "babel-plugin-module-resolver" ||
        node.value === "module-resolver" ||
        (node.value === "@rollup/plugin-alias" && !isNodeOfType(node.parent, "ImportDeclaration")))
    ) {
      hasRemap = true;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      ["alias", "resolveId"].includes(getStaticPropertyName(node) ?? "")
    ) {
      hasRemap = true;
      return false;
    }
    const key = getStaticPropertyKeyName(node, { allowComputedString: true });
    if (
      key === "resolveId" ||
      key === "moduleNameMapper" ||
      (isNodeOfType(node, "Property") &&
        ((node.computed && key === null) ||
          (key === "alias" && (node.kind !== "init" || !isLiteralUnrelatedAliasMap(node.value)))))
    ) {
      hasRemap = true;
      return false;
    }
  });
  return !hasRemap;
};

const isProviderOverrideSelector = (selector: string): boolean =>
  selector.split(">").some((rawPart) => {
    const part = rawPart.trim().replace(/^(?:\*{1,2}\/)+/, "");
    if (isProviderAlias(part)) return true;
    return !part.startsWith("@") && isProviderAlias(part.split("@", 1)[0]);
  });

const hasProviderOverride = (value: unknown, depth = 0): boolean => {
  if (!value || typeof value !== "object") return false;
  if (depth >= 16) return true;
  return Object.entries(value).some(
    ([selector, child]) =>
      isProviderOverrideSelector(selector) || hasProviderOverride(child, depth + 1),
  );
};

const hasVisiblePackageAlias = (manifest: object): boolean => {
  const config = manifest as {
    alias?: unknown;
    browser?: unknown;
    overrides?: unknown;
    resolutions?: unknown;
    pnpm?: { overrides?: unknown; patchedDependencies?: unknown };
  };
  return [
    config.alias,
    config.browser,
    config.overrides,
    config.resolutions,
    config.pnpm?.overrides,
    config.pnpm?.patchedDependencies,
  ].some((map) => hasProviderOverride(map));
};

// Do not try to evaluate arbitrary YAML, merge keys or package
// catalogs here. Admit a simple workspace shape only when every
// top-level option is understood and cannot redirect these providers.
const PASSIVE_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  "packages",
  "allowBuilds",
  "onlyBuiltDependencies",
  "ignoredBuiltDependencies",
  "minimumReleaseAge",
  "minimumReleaseAgeIgnoreMissingTime",
  "minimumReleaseAgeStrict",
]);

const hasUnsupportedWorkspaceOptions = (filename: string): boolean => {
  recordExistenceProbe(filename);
  if (!fs.existsSync(filename)) return false;
  recordContentProbe(filename);
  try {
    if (fs.statSync(filename).size > 64 * 1024) return true;
    const text = fs.readFileSync(filename, "utf8");
    let hasRootKey = false;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      if (line.startsWith(" ")) {
        if (!hasRootKey) return true;
        continue;
      }
      const field = /^([A-Za-z][A-Za-z0-9]*)[ ]*:[ ]*(.*)$/.exec(line);
      if (!field || !PASSIVE_WORKSPACE_KEYS.has(field[1]) || /^[&*!{|>]/.test(field[2].trim())) {
        return true;
      }
      hasRootKey = true;
    }
    return !hasRootKey;
  } catch {
    return true;
  }
};

interface ProviderResult {
  isCanonical: boolean;
  trace: CrossFileProbeTrace;
}

const cachedProviderByDirectory = new Map<string, ProviderResult>();
let manifestGeneration = getManifestCacheGeneration();

const hasCanonicalPackageProvider = (filename: string, packageDirectory: string): boolean => {
  if (getManifestCacheGeneration() !== manifestGeneration) {
    cachedProviderByDirectory.clear();
    manifestGeneration = getManifestCacheGeneration();
  }
  const cached = cachedProviderByDirectory.get(packageDirectory);
  if (cached) {
    replayCrossFileProbes(cached.trace);
    return cached.isCanonical;
  }
  const checked = captureCrossFileProbes(() => {
    const manifest = readPackageManifest(packageDirectory);
    const version = resolvePackageVersion(filename, "lodash");
    const react = manifest?.dependencies?.react ?? manifest?.devDependencies?.react;
    if (
      !manifest ||
      typeof react !== "string" ||
      !/^[~^]?\d+\.\d+\.\d+$/.test(react) ||
      typeof manifest.dependencies?.lodash !== "string" ||
      !/^[~^]?4\.\d+\.\d+$/.test(manifest.dependencies.lodash) ||
      version?.version.major !== 4 ||
      version.version.isPrerelease ||
      hasVisiblePackageAlias(manifest)
    ) {
      return false;
    }
    const enclosingDirectory = findNearestPackageDirectory(
      path.join(path.dirname(packageDirectory), "package.json"),
    );
    const configRoots = enclosingDirectory
      ? [packageDirectory, enclosingDirectory]
      : [packageDirectory];
    if (enclosingDirectory) {
      const enclosingManifest = readPackageManifest(enclosingDirectory);
      if (enclosingManifest && hasVisiblePackageAlias(enclosingManifest)) return false;
    }
    return configRoots.every(
      (directory) =>
        !hasUnsupportedWorkspaceOptions(path.join(directory, "pnpm-workspace.yaml")) &&
        !hasUnsupportedWorkspaceOptions(path.join(directory, "pnpm-workspace.yml")) &&
        CONFIG_FILENAMES.every((name) => isSupportedBuildConfig(path.join(directory, name))),
    );
  });
  cachedProviderByDirectory.set(packageDirectory, {
    isCanonical: checked.value,
    trace: checked.trace,
  });
  return checked.value;
};

export const hasCanonicalLodashDebounceProvider = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  return Boolean(
    packageDirectory &&
    !resolveModulePath(filename, LODASH_DEBOUNCE_SUBPATH) &&
    !resolveModulePath(filename, "react") &&
    hasCanonicalPackageProvider(filename, packageDirectory),
  );
};
