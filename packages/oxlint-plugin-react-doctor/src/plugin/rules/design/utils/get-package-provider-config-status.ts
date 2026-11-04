import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import {
  hasCanonicalPackageDependency,
  resolvePackageVersion,
} from "../../../utils/resolve-package-version.js";
import { getTsconfigPackageProviderStatus } from "../../../utils/resolve-tsconfig-alias.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isLoggerOnlyVitePlugin } from "./is-logger-only-vite-plugin.js";
import {
  CLOSED_CLASS_MERGER_CONFIG_IMPORTS,
  CLOSED_CLASS_MERGER_CONFIG_PROVIDER_MAJORS,
  CLOSED_CLASS_MERGER_CONFIG_NAMES,
  CLOSED_CLASS_MERGER_CONFIG_NODE_LIMIT,
  CLOSED_CLASS_MERGER_PACKAGE_SELECTOR_PATTERN,
  CLOSED_CLASS_MERGER_RESOLUTION_LIMIT,
  CLOSED_CLASS_MERGER_VITE_PLUGINS,
} from "./closed-class-merger/constants.js";

const hasUnrelatedSelectors = (
  value: unknown,
  packages: ReadonlySet<string>,
  depth = 0,
): boolean => {
  if (value === undefined) return true;
  if (
    depth >= CLOSED_CLASS_MERGER_RESOLUTION_LIMIT ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  )
    return false;
  return Object.entries(value).every(
    ([selector, replacement]) =>
      CLOSED_CLASS_MERGER_PACKAGE_SELECTOR_PATTERN.test(selector) &&
      !packages.has(selector) &&
      (typeof replacement === "string" || hasUnrelatedSelectors(replacement, packages, depth + 1)),
  );
};

const isClosedViteConfig = (
  program: EsTreeNode,
  filename: string,
  packages: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const scopes = analyzeScopes(program);
  let remaining = CLOSED_CLASS_MERGER_CONFIG_NODE_LIMIT;
  const resolving = new Set<EsTreeNode>();
  const hasCanonicalConfigImport = (source: string): boolean => {
    if (getTsconfigPackageProviderStatus(filename, source) !== "external") return false;
    if (source === "path" || source === "node:path") {
      const directory = findNearestPackageDirectory(filename);
      const manifest = directory && readPackageManifest(directory);
      return Boolean(
        manifest &&
        [
          manifest.dependencies,
          manifest.devDependencies,
          manifest.peerDependencies,
          manifest.optionalDependencies,
        ].every((dependencies) => dependencies?.[source] === undefined),
      );
    }
    const major = CLOSED_CLASS_MERGER_CONFIG_PROVIDER_MAJORS.get(source);
    const version = resolvePackageVersion(filename, source);
    return Boolean(
      major &&
      hasCanonicalPackageDependency(filename, source) &&
      version &&
      version.version.major === major &&
      !version.version.isPrerelease,
    );
  };
  const localValue = (expression: EsTreeNode): EsTreeNode | null => {
    if (!isNodeOfType(expression, "Identifier")) return null;
    const symbol = scopes.symbolFor(expression);
    return symbol &&
      isSymbolReadOnly(symbol) &&
      hasCompleteSymbolReferences(symbol, program, scopes)
      ? getDirectConstInitializer(symbol)
      : null;
  };
  const imported = (expression: EsTreeNode) => {
    if (!isNodeOfType(expression, "Identifier")) return null;
    const symbol = scopes.symbolFor(expression);
    if (
      !symbol ||
      symbol.kind !== "import" ||
      !isSymbolReadOnly(symbol) ||
      !hasCompleteSymbolReferences(symbol, program, scopes)
    )
      return null;
    const reference = resolveImportedApiReference(expression, scopes);
    return reference && hasCanonicalConfigImport(reference.source) ? reference : null;
  };
  const aliasIsUnrelated = (name: string): boolean =>
    !name.includes("*") &&
    [...packages].every(
      (selected) => selected !== name.replace(/\$$/, "") && !selected.startsWith(`${name}/`),
    );
  const isPlugin = (rawExpression: EsTreeNode): boolean => {
    const expression = stripParenExpression(rawExpression);
    if (
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      expression.arguments.length
    )
      return false;
    const provider = imported(expression.callee);
    if (
      provider &&
      provider.importedName === "default" &&
      CLOSED_CLASS_MERGER_VITE_PLUGINS.has(provider.source)
    )
      return true;
    const factory = localValue(expression.callee);
    return Boolean(factory && isLoggerOnlyVitePlugin(factory, program, scopes));
  };
  const resolve = (rawExpression: EsTreeNode, location: string): boolean => {
    if (--remaining < 0) return false;
    const expression = stripParenExpression(rawExpression);
    if (resolving.has(expression)) return false;
    if (location.endsWith(".alias") && !isNodeOfType(expression, "ObjectExpression")) return false;
    if (isNodeOfType(expression, "Literal"))
      return (
        expression.value === null ||
        ["string", "number", "boolean"].includes(typeof expression.value)
      );
    if (getStaticStringExpression(expression) !== null) return true;
    if (isNodeOfType(expression, "Identifier")) {
      const initializer = localValue(expression);
      if (!initializer) return false;
      resolving.add(expression);
      const result = resolve(initializer, location);
      resolving.delete(expression);
      return result;
    }
    if (isNodeOfType(expression, "ArrayExpression")) {
      if (location === "plugins")
        return expression.elements.every((element) => element && isPlugin(element));
      if (location.endsWith(".plugins") || location.endsWith(".dedupe"))
        return expression.elements.length === 0;
      return expression.elements.every((element) => element && resolve(element, `${location}[]`));
    }
    if (isNodeOfType(expression, "ObjectExpression")) {
      const names = new Set<string>();
      return expression.properties.every((property) => {
        if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
          return false;
        const name = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (!name || names.has(name) || name === "extends") return false;
        names.add(name);
        if (location.endsWith("alias") && !aliasIsUnrelated(name)) return false;
        return resolve(property.value, location ? `${location}.${name}` : name);
      });
    }
    if (
      isNodeOfType(expression, "CallExpression") &&
      !expression.optional &&
      location.includes(".alias.")
    ) {
      if (!isNodeOfType(expression.callee, "MemberExpression")) return false;
      const provider = imported(expression.callee.object);
      if (
        !provider ||
        !["path", "node:path"].includes(provider.source) ||
        !["resolve", "join"].includes(getStaticPropertyName(expression.callee) ?? "")
      )
        return false;
      return expression.arguments.every(
        (argument) =>
          getStaticStringExpression(argument) !== null ||
          (isNodeOfType(argument, "Identifier") &&
            argument.name === "__dirname" &&
            scopes.isGlobalReference(argument)),
      );
    }
    return false;
  };
  let exported: EsTreeNode | null = null;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (
        statement.importKind !== "type" &&
        (!CLOSED_CLASS_MERGER_CONFIG_IMPORTS.has(statement.source.value) ||
          !hasCanonicalConfigImport(statement.source.value))
      )
        return false;
    } else if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      if (
        !statement.declarations.every(
          (declaration) =>
            declaration.init && (isFunctionLike(declaration.init) || resolve(declaration.init, "")),
        )
      )
        return false;
    } else if (isNodeOfType(statement, "ExportDefaultDeclaration") && !exported) {
      exported = stripParenExpression(statement.declaration);
    } else return false;
  }
  if (!exported) return false;
  if (isNodeOfType(exported, "CallExpression")) {
    const provider = imported(exported.callee);
    if (
      exported.optional ||
      exported.arguments.length !== 1 ||
      provider?.source !== "vite" ||
      provider.importedName !== "defineConfig"
    )
      return false;
    const argument = exported.arguments[0];
    if (!argument) return false;
    exported = stripParenExpression(argument);
  }
  if (isFunctionLike(exported)) {
    if (exported.async || exported.generator || exported.params.length) return false;
    exported = getSingleReturnExpression(exported);
  }
  return Boolean(exported && resolve(exported, ""));
};

export const getPackageProviderConfigStatus = (
  filename: string,
  packages: ReadonlySet<string>,
): "external" | "alias" | "unknown" => {
  packages = new Set([...packages, ...CLOSED_CLASS_MERGER_CONFIG_IMPORTS]);
  for (const selected of packages) {
    const status = getTsconfigPackageProviderStatus(filename, selected);
    if (status !== "external") return status;
  }
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return "unknown";
  const manifest = readPackageManifest(packageDirectory);
  if (!manifest) return "unknown";
  for (const provider of CLOSED_CLASS_MERGER_CONFIG_IMPORTS) {
    const isDeclared = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].some((dependencies) => dependencies?.[provider] !== undefined);
    if (isDeclared && !hasCanonicalPackageDependency(filename, provider)) return "unknown";
  }
  if (
    (typeof manifest.name === "string" && packages.has(manifest.name)) ||
    Reflect.get(manifest, "browser") !== undefined ||
    !hasUnrelatedSelectors(Reflect.get(manifest, "alias"), packages) ||
    Object.values(manifest.scripts ?? {}).some(
      (script) =>
        typeof script === "string" &&
        /\b(?:vite|webpack)\b[^\n;&|]*\s(?:--config|-c)(?:\s|=)/.test(script),
    )
  )
    return "unknown";
  const pnpm = Reflect.get(manifest, "pnpm");
  if (pnpm !== undefined && (typeof pnpm !== "object" || pnpm === null || Array.isArray(pnpm)))
    return "unknown";
  const selectors = [
    Reflect.get(manifest, "overrides"),
    Reflect.get(manifest, "resolutions"),
    Reflect.get(manifest, "patchedDependencies"),
  ];
  if (typeof pnpm === "object" && pnpm !== null)
    selectors.push(Reflect.get(pnpm, "overrides"), Reflect.get(pnpm, "patchedDependencies"));
  if (!selectors.every((value) => hasUnrelatedSelectors(value, packages))) return "unknown";
  let directory = path.dirname(filename);
  while (true) {
    for (const name of CLOSED_CLASS_MERGER_CONFIG_NAMES) {
      const candidate = path.join(directory, name);
      recordContentProbe(candidate);
      try {
        const stat = fs.statSync(candidate, { throwIfNoEntry: false });
        if (!stat) continue;
        if (!stat.isFile() || name.startsWith("webpack")) return "unknown";
        const program = parseSourceFile(candidate);
        if (!program || !isClosedViteConfig(program, candidate, packages)) return "unknown";
      } catch {
        return "unknown";
      }
    }
    if (directory === packageDirectory) return "external";
    const parent = path.dirname(directory);
    if (parent === directory) return "unknown";
    directory = parent;
  }
};
