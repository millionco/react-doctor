import { dirname, isAbsolute, join, resolve } from "node:path";
import { analyzeScopes, type SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceFile } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Node = EsTreeNode | null | undefined;
const SOURCE_EXTENSIONS = [
  ".web.tsx",
  ".web.ts",
  ".tsx",
  ".ts",
  ".web.js",
  ".js",
  ".lottie",
  ".json",
];
const WEBPACK_MAIN_FIELDS = ["react-native", "main"];

const literalString = (node: Node): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const equalStrings = (node: Node, expected: ReadonlyArray<string>): boolean =>
  isNodeOfType(node, "ArrayExpression") &&
  node.elements.length === expected.length &&
  node.elements.every((element, index) => literalString(element) === expected[index]);

const properties = (node: Node): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const item of node.properties) {
    if (!isNodeOfType(item, "Property") || item.computed || item.method || item.kind !== "init")
      return null;
    const key = getStaticPropertyKeyName(item);
    if (!key || key === "__proto__" || result.has(key)) return null;
    result.set(key, item.value);
  }
  return result;
};

const onlyKeys = (
  record: ReadonlyMap<string, EsTreeNode>,
  allowed: ReadonlyArray<string>,
): boolean => [...record.keys()].every((key) => allowed.includes(key));

const isPlainData = (node: EsTreeNode, depth = 0): boolean => {
  if (depth > 8) return false;
  if (isNodeOfType(node, "Literal"))
    return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every((item) => item && isPlainData(item, depth + 1));
  const record = properties(node);
  return Boolean(record && [...record.values()].every((entry) => isPlainData(entry, depth + 1)));
};

const propertyOn = (node: Node, name: string) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  !node.computed &&
  getStaticPropertyName(node) === name
    ? node
    : null;

interface WebpackMetroAlias {
  readonly entryPath: string;
  readonly htmlTemplate: string | null;
  readonly aliasDirectory: string;
}

/** Interpret a literal Webpack route that derives its only package aliases from a separately certified Metro map. */
export const readDeclaredWebpackMetroAlias = (
  filename: string,
  certifiedMetroAliasDirectory: string,
): WebpackMetroAlias | null => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length > 16) return null;
  const scopes = analyzeScopes(program);
  const directory = dirname(filename);
  const usedDeclarations = new Set<EsTreeNode>();

  const globalName = (node: Node, name: string): boolean =>
    isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);
  const readConst = (node: Node): EsTreeNode | null => {
    if (!isNodeOfType(node, "Identifier")) return null;
    const symbol = scopes.symbolFor(node);
    const value = symbol && getDirectConstInitializer(symbol);
    if (!symbol || !value || symbol.references.some(({ flag }) => flag !== "read")) return null;
    usedDeclarations.add(symbol.declarationNode);
    return stripParenExpression(value);
  };
  const requireSource = (node: Node): string | null =>
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    node.arguments.length === 1 &&
    globalName(node.callee, "require")
      ? getGlobalRequireModuleSource(node, scopes)
      : null;
  const usesPathModule = (node: Node): boolean =>
    ["path", "node:path"].includes(requireSource(readConst(node)) ?? "");

  const readText = (
    node: Node,
    variables: ReadonlyMap<SymbolDescriptor, string>,
    depth = 0,
  ): string | null => {
    if (!node || depth > 10) return null;
    const literal = literalString(node);
    if (literal !== null) return literal;
    if (globalName(node, "__dirname")) return directory;
    if (isNodeOfType(node, "Identifier")) {
      const binding = scopes.symbolFor(node);
      const supplied = binding && variables.get(binding);
      return supplied ?? readText(readConst(node), variables, depth + 1);
    }
    if (isNodeOfType(node, "TemplateLiteral")) {
      let result = "";
      for (const [index, quasi] of node.quasis.entries()) {
        if (quasi.value.cooked === null) return null;
        result += quasi.value.cooked;
        if (index === node.expressions.length) continue;
        const part = readText(node.expressions[index], variables, depth + 1);
        if (part === null) return null;
        result += part;
      }
      return result;
    }
    if (!isNodeOfType(node, "CallExpression") || node.optional || !node.arguments.length)
      return null;
    const method = propertyOn(node.callee, "join") ?? propertyOn(node.callee, "resolve");
    if (!method || !usesPathModule(method.object)) return null;
    const first = readText(node.arguments[0], variables, depth + 1);
    if (first === null || !isAbsolute(first)) return null;
    const parts = [first];
    for (const argument of node.arguments.slice(1)) {
      const part = readText(argument, variables, depth + 1);
      if (part === null) return null;
      parts.push(part);
    }
    return getStaticPropertyName(method) === "resolve" ? resolve(...parts) : join(...parts);
  };
  const emptyVariables = new Map<SymbolDescriptor, string>();
  const isRequiredField = (node: Node, modulePath: string, field: string): boolean => {
    if (!isNodeOfType(node, "Identifier")) return false;
    const binding = scopes.symbolFor(node);
    const declaration = binding?.declarationNode;
    if (
      !binding ||
      binding.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      declaration.id.properties.length !== 1 ||
      !isNodeOfType(declaration.init, "CallExpression") ||
      declaration.init.optional ||
      declaration.init.arguments.length !== 1 ||
      !globalName(declaration.init.callee, "require")
    )
      return false;
    const [property] = declaration.id.properties;
    const request = readText(declaration.init.arguments[0], emptyVariables);
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.value !== binding.bindingIdentifier ||
      getStaticPropertyKeyName(property) !== field ||
      request === null ||
      (!request.startsWith(".") && !isAbsolute(request)) ||
      resolve(directory, request) !== modulePath
    )
      return false;
    const shorthand = node.parent;
    const useKey =
      isNodeOfType(shorthand, "Property") && shorthand.shorthand && shorthand.value === node
        ? shorthand.key
        : null;
    const references = binding.references.filter(
      ({ identifier }) => identifier !== property.key && identifier !== useKey,
    );
    if (references.length !== 1 || references[0]?.identifier !== node) return false;
    usedDeclarations.add(declaration);
    return true;
  };

  const exported = program.body.at(-1);
  const assignment = isNodeOfType(exported, "ExpressionStatement") ? exported.expression : null;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=") return null;
  const exportTarget = propertyOn(assignment.left, "exports");
  const config = properties(assignment.right);
  if (
    !exportTarget ||
    !globalName(exportTarget.object, "module") ||
    !config ||
    !onlyKeys(config, [
      "mode",
      "entry",
      "stats",
      "output",
      "resolve",
      "module",
      "watch",
      "watchOptions",
      "plugins",
    ])
  )
    return null;
  const buildEntry = properties(config.get("entry"));
  if (buildEntry?.size !== 1) return null;
  const entry = literalString(buildEntry.values().next().value);
  if (entry !== "./index.web.js") return null;
  const entryPath = resolve(directory, entry);
  const resolution = properties(config.get("resolve"));
  if (
    !resolution ||
    !onlyKeys(resolution, ["mainFields", "extensions", "alias", "symlinks", "modules"]) ||
    !equalStrings(resolution.get("mainFields"), WEBPACK_MAIN_FIELDS) ||
    !equalStrings(resolution.get("extensions"), SOURCE_EXTENSIONS) ||
    !equalStrings(resolution.get("modules"), ["node_modules", "src"])
  )
    return null;
  const links = resolution.get("symlinks");
  if (!isNodeOfType(links, "Literal") || links.value !== false) return null;
  const aliases = resolution.get("alias");
  if (
    !isNodeOfType(aliases, "ObjectExpression") ||
    aliases.properties.length !== 2 ||
    certifiedMetroAliasDirectory !== join(directory, "node_modules")
  )
    return null;
  const [spread, substitution] = aliases.properties;
  const aliasProperty = isNodeOfType(spread, "SpreadElement")
    ? propertyOn(spread.argument, "extraNodeModules")
    : null;
  if (
    !aliasProperty ||
    !isRequiredField(aliasProperty.object, join(directory, "metro.config.js"), "resolver") ||
    !isNodeOfType(substitution, "Property") ||
    substitution.computed ||
    substitution.method ||
    substitution.kind !== "init" ||
    getStaticPropertyKeyName(substitution) !== "react-native" ||
    literalString(substitution.value) !== "react-native-web"
  )
    return null;

  const sourceIncludes = (node: Node): boolean => {
    if (!isNodeOfType(node, "ArrayExpression")) return false;
    return node.elements.every((entry) => {
      if (!entry) return false;
      if (!isNodeOfType(entry, "SpreadElement")) {
        const path = readText(entry, emptyVariables);
        return path !== null && isPathInside(path, directory);
      }
      const mapped = readConst(entry.argument) ?? entry.argument;
      if (
        !isNodeOfType(mapped, "CallExpression") ||
        mapped.optional ||
        mapped.arguments.length !== 1
      )
        return false;
      const method = propertyOn(mapped.callee, "map");
      const values = method?.object;
      const callback = mapped.arguments[0];
      if (
        !isNodeOfType(values, "ArrayExpression") ||
        !isNodeOfType(callback, "ArrowFunctionExpression") ||
        callback.async ||
        callback.params.length !== 1 ||
        !isNodeOfType(callback.params[0], "Identifier")
      )
        return false;
      const binding = scopes.symbolFor(callback.params[0]);
      return Boolean(
        binding &&
        values.elements.every((value) => {
          const name = literalString(value);
          if (name === null) return false;
          const path = readText(callback.body, new Map([[binding, name]]));
          return path !== null && isPathInside(path, join(directory, "node_modules"));
        }),
      );
    });
  };
  const loaders = properties(config.get("module"));
  const rules = loaders?.get("rules");
  if (loaders?.size !== 1 || !isNodeOfType(rules, "ArrayExpression") || !rules.elements.length)
    return null;
  let babelLoaders = 0;
  for (const seed of rules.elements) {
    const rule = properties(readConst(seed) ?? seed);
    if (!rule) return null;
    const test = rule.get("test");
    if (!isNodeOfType(test, "Literal") || !("regex" in test)) return null;
    if (literalString(rule.get("type")) === "asset/resource") {
      if (!onlyKeys(rule, ["type", "test"])) return null;
      continue;
    }
    const use = properties(rule.get("use"));
    const options = properties(use?.get("options"));
    if (
      !onlyKeys(rule, ["test", "include", "use"]) ||
      !sourceIncludes(rule.get("include")) ||
      use?.size !== 2 ||
      literalString(use.get("loader")) !== "babel-loader" ||
      !options ||
      !onlyKeys(options, ["cacheDirectory", "presets", "plugins"]) ||
      !isRequiredField(options.get("presets"), join(directory, "babel.config.js"), "presets") ||
      !equalStrings(options.get("plugins"), ["react-native-web"])
    )
      return null;
    const cache = options.get("cacheDirectory");
    if (cache && (!isNodeOfType(cache, "Literal") || typeof cache.value !== "boolean")) return null;
    babelLoaders++;
  }
  if (babelLoaders !== 1) return null;

  let htmlTemplate: string | null = null;
  const plugins = config.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression")) return null;
  for (const plugin of plugins.elements) {
    if (!isNodeOfType(plugin, "NewExpression")) return null;
    if (requireSource(readConst(plugin.callee)) === "html-webpack-plugin") {
      const options = properties(plugin.arguments[0]);
      const template = readText(options?.get("template"), emptyVariables);
      if (
        htmlTemplate ||
        plugin.arguments.length !== 1 ||
        options?.size !== 1 ||
        !template ||
        !isPathInside(template, directory) ||
        !template.endsWith(".html")
      )
        return null;
      htmlTemplate = template;
      continue;
    }
    const hmr = propertyOn(plugin.callee, "HotModuleReplacementPlugin");
    if (hmr && requireSource(readConst(hmr.object)) === "webpack" && plugin.arguments.length === 0)
      continue;
    const define = propertyOn(plugin.callee, "DefinePlugin");
    if (
      !define ||
      requireSource(readConst(define.object)) !== "webpack" ||
      plugin.arguments.length !== 1
    )
      return null;
    const replacements = properties(plugin.arguments[0]);
    const value = replacements?.get("__DEV__");
    if (
      replacements?.size !== 1 ||
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      value.arguments.length !== 1
    )
      return null;
    const stringify = propertyOn(value.callee, "stringify");
    if (
      !stringify ||
      !globalName(stringify.object, "JSON") ||
      !value.arguments[0] ||
      !isPlainData(value.arguments[0])
    )
      return null;
  }

  const output = properties(config.get("output"));
  if (output) {
    const path = readText(output.get("path"), emptyVariables);
    if (
      !onlyKeys(output, ["path", "publicPath", "filename"]) ||
      (output.has("path") && (path === null || !isPathInside(path, directory))) ||
      [...output].some(([key, value]) => key !== "path" && literalString(value) === null)
    )
      return null;
  } else if (config.has("output")) return null;
  for (const key of ["mode", "stats", "watch", "watchOptions"]) {
    const value = config.get(key);
    if (value && !isPlainData(value)) return null;
  }
  if (
    !program.body
      .slice(0, -1)
      .every(
        (statement) =>
          isNodeOfType(statement, "VariableDeclaration") &&
          statement.kind === "const" &&
          statement.declarations.every((declaration) => usedDeclarations.has(declaration)),
      )
  )
    return null;
  return { entryPath, htmlTemplate, aliasDirectory: certifiedMetroAliasDirectory };
};
