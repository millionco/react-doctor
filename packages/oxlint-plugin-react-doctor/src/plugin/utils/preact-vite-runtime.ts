import { existsSync } from "node:fs";
import * as path from "node:path";
import { FAST_REFRESH_CONFIG_FILENAMES } from "../constants/fast-refresh.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import { readPackageManifest } from "./read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

const viteConfigNames = FAST_REFRESH_CONFIG_FILENAMES.filter((filename) =>
  filename.startsWith("vite.config."),
);

const readStaticProperties = (
  node: EsTreeNode | undefined,
  allowedNames: ReadonlyArray<string>,
): ReadonlyMap<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const remainingNames = new Set(allowedNames);
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed) {
      return null;
    }
    const name = getStaticPropertyKeyName(property);
    if (!name || !remainingNames.delete(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};

const isStaticData = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "ArrayExpression")) {
    return node.elements.every((element) => element !== null && isStaticData(element));
  }
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  return node.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      !property.computed &&
      isStaticData(property.value),
  );
};

const hasKnownPreactExternal = (argument: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const options = readStaticProperties(argument, ["entry", "userscript", "build"]);
  const entry = options?.get("entry");
  const userscript = options?.get("userscript");
  if (!isNodeOfType(entry, "Literal") || typeof entry.value !== "string") return false;
  if (userscript) {
    const metadata = readStaticProperties(userscript, ["icon", "namespace", "match"]);
    if (!metadata || ![...metadata.values()].every(isStaticData)) return false;
  }

  // vite-plugin-monkey may replace a runtime with a remote global. Only accept
  // its same-package Preact distribution mapping.
  const build = readStaticProperties(options?.get("build"), ["externalGlobals"]);
  const globals = readStaticProperties(build?.get("externalGlobals"), ["preact"]);
  const preact = globals?.get("preact");
  if (!isNodeOfType(preact, "CallExpression") || preact.arguments.length !== 2) return false;
  if (
    !isNodeOfType(preact.callee, "MemberExpression") ||
    preact.callee.computed ||
    !isNodeOfType(preact.callee.property, "Identifier") ||
    preact.callee.property.name !== "jsdelivr"
  ) {
    return false;
  }
  const cdn = resolveImportedApiReference(preact.callee.object, scopes);
  if (cdn?.source !== "vite-plugin-monkey" || cdn.importedName !== "cdn") return false;
  const [packageName, distribution] = preact.arguments;
  return (
    isNodeOfType(packageName, "Literal") &&
    packageName.value === "preact" &&
    isNodeOfType(distribution, "Literal") &&
    distribution.value === "dist/preact.min.js"
  );
};

const hasPublishedPackageVersion = (manifest: PackageManifest, name: string): boolean => {
  const versions = [manifest.dependencies?.[name], manifest.devDependencies?.[name]].filter(
    (version) => version !== undefined,
  );
  return (
    versions.length > 0 &&
    versions.every(
      (version) => typeof version === "string" && /^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version),
    )
  );
};

export const hasPreactViteRuntime = (packageDirectory: string): boolean => {
  const manifest = readPackageManifest(packageDirectory);
  if (
    !manifest ||
    !["preact", "vite", "@preact/preset-vite"].every((name) =>
      hasPublishedPackageVersion(manifest, name),
    )
  )
    return false;
  const build = manifest.scripts?.build;
  if (build !== "vite build" && build !== "tsc && vite build") return false;
  if (manifest?.scripts?.dev !== undefined && manifest.scripts.dev !== "vite") return false;
  if (manifest?.scripts?.prebuild !== undefined) return false;

  let config: EsTreeNode | null = null;
  for (const filename of viteConfigNames) {
    const configPath = path.join(packageDirectory, filename);
    const nextConfig = parseSourceFile(configPath);
    if (!nextConfig) {
      recordExistenceProbe(configPath);
      if (existsSync(configPath)) return false;
      continue;
    }
    if (config) return false;
    config = nextConfig;
  }
  if (!isNodeOfType(config, "Program")) return false;
  const statements: Array<EsTreeNode> = [];
  for (const statement of config.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) {
      statements.push(statement);
      continue;
    }
    if (
      statement.specifiers.length === 0 ||
      !["vite", "@preact/preset-vite", "vite-plugin-monkey"].includes(
        String(statement.source.value),
      )
    ) {
      return false;
    }
  }
  if (statements.length !== 1) return false;
  const [declaration] = statements;
  if (!isNodeOfType(declaration, "ExportDefaultDeclaration")) return false;
  const define = declaration.declaration;
  if (!isNodeOfType(define, "CallExpression") || define.arguments.length !== 1) return false;
  const scopes = analyzeScopes(config);
  const configFactory = resolveImportedApiReference(define.callee, scopes);
  if (configFactory?.source !== "vite" || configFactory.importedName !== "defineConfig")
    return false;
  const settings = readStaticProperties(define.arguments[0], ["plugins"]);
  const plugins = settings?.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression")) return false;

  let foundPreact = false;
  for (const element of plugins.elements) {
    if (!isNodeOfType(element, "CallExpression")) return false;
    const factory = resolveImportedApiReference(element.callee, scopes);
    if (factory?.importedName !== "default") return false;
    switch (factory.source) {
      case "@preact/preset-vite":
        if (foundPreact || element.arguments.length !== 0) return false;
        foundPreact = true;
        break;
      case "vite-plugin-monkey":
        if (
          !hasPublishedPackageVersion(manifest, factory.source) ||
          element.arguments.length !== 1 ||
          !hasKnownPreactExternal(element.arguments[0], scopes)
        ) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return foundPreact;
};
