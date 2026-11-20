import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readPackageManifest } from "../../../utils/read-nearest-package-manifest.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";

// Next 14 searches upward for its config, and checks the project directory
// for Babel settings that can also rewrite application import specifiers.
const CONFIG_FILES = ["next.config.js", "next.config.mjs"];
const UNSUPPORTED_CONFIG_FILES = [
  "next.config.jsx",
  "next.config.ts",
  "next.config.tsx",
  "next.config.json",
];
const BABEL_CONFIG_FILES = [
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.mjs",
  ".babelrc.cjs",
  "babel.config.js",
  "babel.config.json",
  "babel.config.mjs",
  "babel.config.cjs",
];

const matchesMemberPath = (
  node: EsTreeNode,
  properties: readonly string[],
  matchesRoot: (root: EsTreeNode) => boolean,
): boolean => {
  let current = node;
  for (let index = properties.length - 1; index >= 0; index--) {
    if (
      !isNodeOfType(current, "MemberExpression") ||
      current.computed ||
      current.optional ||
      !isNodeOfType(current.property, "Identifier") ||
      current.property.name !== properties[index]
    )
      return false;
    current = current.object;
  }
  return matchesRoot(current);
};

const isGlobal = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

const readsModule = (
  node: EsTreeNode | null | undefined,
  name: string,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isGlobal(node.callee, "require", scopes) &&
  node.arguments.length === 1 &&
  isNodeOfType(node.arguments[0], "Literal") &&
  node.arguments[0].value === name;

const staticProperties = (object: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const entries = new Map<string, EsTreeNode>();
  for (const item of object.properties) {
    if (
      !isNodeOfType(item, "Property") ||
      item.computed ||
      item.kind !== "init" ||
      !isNodeOfType(item.key, "Identifier") ||
      entries.has(item.key.name)
    )
      return null;
    entries.set(item.key.name, item.value);
  }
  return entries;
};

const isStaticConfigValue = (
  value: EsTreeNode | null,
  isKnownRead: (node: EsTreeNode) => boolean,
): boolean => {
  if (!value) return false;
  if (isKnownRead(value) || isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "TemplateLiteral")) return value.expressions.length === 0;
  if (isNodeOfType(value, "ArrayExpression"))
    return value.elements.every((item) => Boolean(item && isStaticConfigValue(item, isKnownRead)));
  const entries = staticProperties(value);
  return Boolean(
    entries && [...entries.values()].every((item) => isStaticConfigValue(item, isKnownRead)),
  );
};

const isSvgLoaderOnly = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isFunctionLike(node) ||
    node.async ||
    node.generator ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.body.body.length !== 2
  )
    return false;
  const config = scopes.symbolFor(node.params[0]);
  if (!config) return false;
  const isConfig = (value: EsTreeNode) =>
    isNodeOfType(value, "Identifier") && scopes.symbolFor(value) === config;
  const [update, returned] = node.body.body;
  if (
    !isNodeOfType(update, "ExpressionStatement") ||
    !isNodeOfType(update.expression, "CallExpression") ||
    update.expression.optional ||
    update.expression.arguments.length !== 1 ||
    !matchesMemberPath(update.expression.callee, ["module", "rules", "push"], isConfig) ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument ||
    !isConfig(returned.argument)
  )
    return false;
  const rule = staticProperties(update.expression.arguments[0]);
  if (!rule || rule.size !== 3) return false;
  const test = rule.get("test");
  const issuer = rule.get("issuer");
  const use = rule.get("use");
  return (
    isNodeOfType(test, "Literal") &&
    "regex" in test &&
    test.regex?.pattern === "\\.svg$" &&
    test.regex.flags === "" &&
    isNodeOfType(issuer, "Literal") &&
    "regex" in issuer &&
    issuer.regex?.pattern === "\\.js$" &&
    issuer.regex.flags === "" &&
    isNodeOfType(use, "ArrayExpression") &&
    use.elements.length === 1 &&
    isNodeOfType(use.elements[0], "Literal") &&
    use.elements[0].value === "@svgr/webpack"
  );
};

const hasNonReplacingNextConfig = (config: EsTreeNode): boolean => {
  if (!isNodeOfType(config, "Program")) return false;
  const scopes = analyzeScopes(config);
  let exported: Map<string, EsTreeNode> | null = null;
  let manifestBinding: ReturnType<ScopeAnalysis["symbolFor"]> = null;
  for (const statement of config.body) {
    if (exported) return false;
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.length === 1
    ) {
      const [variable] = statement.declarations;
      if (
        manifestBinding ||
        !isNodeOfType(variable.id, "Identifier") ||
        !readsModule(variable.init, "./package.json", scopes)
      )
        return false;
      manifestBinding = scopes.symbolFor(variable.id);
      if (!manifestBinding) return false;
      continue;
    }
    if (!isNodeOfType(statement, "ExpressionStatement")) return false;
    const expression = statement.expression;
    if (
      isNodeOfType(expression, "CallExpression") &&
      !expression.optional &&
      expression.arguments.length === 0 &&
      matchesMemberPath(expression.callee, ["config"], (root) =>
        readsModule(root, "dotenv", scopes),
      )
    )
      continue;
    if (
      !isNodeOfType(expression, "AssignmentExpression") ||
      expression.operator !== "=" ||
      !matchesMemberPath(expression.left, ["exports"], (root) => isGlobal(root, "module", scopes))
    )
      return false;
    exported = staticProperties(expression.right);
    if (!exported) return false;
  }
  if (!exported) return false;
  const readIsInert = (node: EsTreeNode) =>
    matchesMemberPath(node, ["env", "BASE_PATH"], (root) => isGlobal(root, "process", scopes)) ||
    Boolean(
      manifestBinding &&
      matchesMemberPath(
        node,
        ["version"],
        (root) => isNodeOfType(root, "Identifier") && scopes.symbolFor(root) === manifestBinding,
      ),
    );
  for (const [key, value] of exported) {
    switch (key) {
      case "webpack":
        if (!isSvgLoaderOnly(value, scopes)) return false;
        break;
      case "headers":
        if (
          !isFunctionLike(value) ||
          value.params.length !== 0 ||
          !isStaticConfigValue(getSingleReturnExpression(value), readIsInert)
        )
          return false;
        break;
      case "env":
      case "basePath":
      case "eslint":
        if (!isStaticConfigValue(value, readIsInert)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
};

const probeFile = (directory: string, name: string): boolean => {
  const filename = join(directory, name);
  recordExistenceProbe(filename);
  return statSync(filename, { throwIfNoEntry: false }) !== undefined;
};

export const hasStandardNextModuleResolution = (packageDirectory: string): boolean => {
  try {
    if (BABEL_CONFIG_FILES.some((name) => probeFile(packageDirectory, name))) return false;

    for (let directory = packageDirectory; ; directory = dirname(directory)) {
      const configurations = CONFIG_FILES.filter((name) => probeFile(directory, name));
      if (configurations.length) {
        if (
          directory !== packageDirectory ||
          configurations.length !== 1 ||
          configurations[0] !== "next.config.js"
        )
          return false;
        const parsed = parseSourceFile(join(directory, configurations[0]));
        return Boolean(parsed && hasNonReplacingNextConfig(parsed));
      }
      if (UNSUPPORTED_CONFIG_FILES.some((name) => probeFile(directory, name))) return false;
      if (dirname(directory) === directory) return true;
    }
  } catch {
    return false;
  }
};

const PACKAGE_OVERRIDE_KEY =
  /(?:^|[^a-z0-9_-])(?:cors|next|dotenv|object-assign|vary)(?=$|[^a-z0-9_-])/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasProviderOverride = (setting: unknown): boolean =>
  isObject(setting) &&
  Object.entries(setting).some(
    ([key, value]) => PACKAGE_OVERRIDE_KEY.test(key) || hasProviderOverride(value),
  );

const WORKSPACE_LIST_KEYS = new Set([
  "packages:",
  "ignoredBuiltDependencies:",
  "onlyBuiltDependencies:",
]);

const readSmallConfig = (filename: string): string | null => {
  recordContentProbe(filename);
  const file = statSync(filename);
  return file.isFile() && file.size <= 65536 ? readFileSync(filename, "utf8") : null;
};

const hasPackageOnlyWorkspace = (workspace: string): boolean => {
  const text = readSmallConfig(workspace);
  if (!text) return false;
  const lines = text.split(/\r?\n/).filter((line) => !/^ *(?:#.*)?$/.test(line));
  const seen = new Set<string>();
  for (const line of lines) {
    if (WORKSPACE_LIST_KEYS.has(line) && !seen.has(line)) {
      seen.add(line);
      continue;
    }
    if (!seen.size || !/^ +-[ ]+["']?[!@a-zA-Z0-9_./*?-]+["']? *$/.test(line)) return false;
  }
  return seen.has("packages:");
};

const hasOnlyDependencyLayoutSettings = (filename: string): boolean => {
  const text = readSmallConfig(filename);
  return (
    text !== null &&
    text.split(/\r?\n/).every((line) => {
      const setting = line.trim();
      if (!setting || setting.startsWith("#") || setting.startsWith(";")) return true;
      return (
        /^(?:auto-install-peers|strict-peer-dependencies) *= *(?:true|false)$/.test(setting) ||
        /^(?:public-)?hoist-pattern\[\] *= *["']?[!@a-zA-Z0-9_./*-]+["']?$/.test(setting)
      );
    })
  );
};

export const hasStandardProviderOverrides = (packageDirectory: string): boolean => {
  try {
    for (let directory = packageDirectory; ; directory = dirname(directory)) {
      if (probeFile(directory, ".pnpmfile.cjs") || probeFile(directory, ".pnpmfile.js"))
        return false;
      const isPnpmWorkspace = probeFile(directory, "pnpm-workspace.yaml");
      if (isPnpmWorkspace && !hasPackageOnlyWorkspace(join(directory, "pnpm-workspace.yaml")))
        return false;
      const manifest = readPackageManifest(directory);
      if (directory === packageDirectory || isPnpmWorkspace || manifest?.workspaces) {
        if (probeFile(directory, ".yarnrc") || probeFile(directory, ".yarnrc.yml")) return false;
        if (
          probeFile(directory, ".npmrc") &&
          !hasOnlyDependencyLayoutSettings(join(directory, ".npmrc"))
        )
          return false;
      }
      if (isObject(manifest)) {
        const { overrides, resolutions, pnpm } = manifest;
        if (hasProviderOverride(overrides) || hasProviderOverride(resolutions)) return false;
        if (
          isObject(pnpm) &&
          (hasProviderOverride(pnpm.overrides) ||
            hasProviderOverride(pnpm.patchedDependencies) ||
            hasProviderOverride(pnpm.packageExtensions))
        )
          return false;
      }
      if (dirname(directory) === directory) return true;
    }
  } catch {
    return false;
  }
};
