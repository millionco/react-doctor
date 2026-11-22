import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface WebpackOutputRoute {
  readonly entryPath: string;
  readonly alias: string;
  readonly aliasDirectory: string;
  readonly extensions: readonly string[];
}

interface ResolvedWebpackModule {
  readonly filePath: string;
  readonly entryPaths: readonly string[];
}

const CONFIG_BASE_PROPERTIES = new Set(["mode", "optimization"]);
const RESOLVE_PROPERTIES = new Set(["alias", "extensions"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

const STOCK_REACT_EXTERNALS = new Map([
  ["react", "React"],
  ["react-dom", "ReactDOM"],
  ["react/jsx-runtime", "ReactJSXRuntime"],
  ["react/jsx-dev-runtime", "ReactJSXDevRuntime"],
]);
const STOCK_CONFIG_PLUGINS = new Set([
  "mini-css-extract-plugin",
  "css-minimizer-webpack-plugin",
  "terser-webpack-plugin",
  "remove-files-webpack-plugin",
]);
const CONFIG_PROPERTIES = new Set([
  "mode",
  "optimization",
  "entry",
  "output",
  "experiments",
  "externalsType",
  "resolve",
  "module",
  "externals",
  "plugins",
]);

const readProperties = (value: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(value, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    ) {
      return null;
    }
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || result.has(name)) return null;
    result.set(name, property.value);
  }
  return result;
};

const readString = (value: EsTreeNode | undefined): string | null =>
  isNodeOfType(value, "Literal") && typeof value.value === "string" ? value.value : null;

const readStringList = (value: EsTreeNode | undefined): string[] | null => {
  if (!isNodeOfType(value, "ArrayExpression")) return null;
  const result: string[] = [];
  for (const item of value.elements) {
    if (!item) return null;
    const literal = readString(item);
    if (literal === null) return null;
    result.push(literal);
  }
  return result;
};

const isWithin = (root: string, absolute: string): boolean => {
  const relative = path.relative(root, absolute);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};

const readConst = (node: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
  const initializer = getDirectConstInitializer(symbol);
  return initializer ? stripParenExpression(initializer) : null;
};

const readPath = (
  expression: EsTreeNode | undefined,
  rootDirectory: string,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 2 ||
    !isNodeOfType(expression.callee, "MemberExpression") ||
    expression.callee.optional ||
    getStaticPropertyName(expression.callee) !== "resolve"
  ) {
    return null;
  }
  const binding = readConst(expression.callee.object, scopes);
  const [directory, tail] = expression.arguments;
  if (!binding || !isNodeOfType(binding, "CallExpression") || binding.arguments.length !== 1) {
    return null;
  }
  const source = readStockConfigRequire(binding, scopes);
  const scopeBinding = scopes.symbolFor(expression.callee.object);
  if (
    (source !== "path" && source !== "node:path") ||
    !scopeBinding ||
    !scopeBinding.references.every((reference) => {
      const member = reference.identifier.parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.optional &&
        getStaticPropertyName(member) === "resolve" &&
        isNodeOfType(member.parent, "CallExpression") &&
        member.parent.callee === member &&
        !member.parent.optional
      );
    }) ||
    !isNodeOfType(directory, "Identifier") ||
    directory.name !== "__dirname" ||
    !scopes.isGlobalReference(directory)
  ) {
    return null;
  }
  const relative = readString(tail);
  if (relative === null || path.isAbsolute(relative)) return null;
  const absolute = path.resolve(rootDirectory, relative);
  return isWithin(rootDirectory, absolute) ? absolute : null;
};

const readAssignedProperties = (
  value: EsTreeNode,
  scopes: ScopeAnalysis,
): Map<string, EsTreeNode> | null => {
  const direct = readProperties(value);
  if (direct) return direct;
  const initializer = readConst(value, scopes) ?? value;
  if (!isNodeOfType(initializer, "CallExpression")) return readProperties(initializer);
  const { callee, arguments: argumentsList } = initializer;
  if (
    initializer.optional ||
    argumentsList.length !== 3 ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "assign" ||
    !isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Object", scopes, "assign") ||
    readProperties(argumentsList[0])?.size !== 0
  ) {
    return null;
  }
  const base = readConst(argumentsList[1], scopes);
  const baseProperties = base ? readProperties(base) : null;
  const overridingProperties = readProperties(argumentsList[2]);
  if (
    !baseProperties ||
    !overridingProperties ||
    Array.from(baseProperties.keys()).some((name) => !CONFIG_BASE_PROPERTIES.has(name))
  ) {
    return null;
  }
  return new Map([...baseProperties, ...overridingProperties]);
};

const hasDirectConfigReferences = (
  declaration: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(declaration);
  return Boolean(
    symbol &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(({ identifier }) => {
      const parent = identifier.parent;
      if (
        isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === identifier)
      ) {
        const exporter = parent.parent;
        return (
          isNodeOfType(exporter, "AssignmentExpression") &&
          exporter.right === parent &&
          exporter.parent?.parent === program
        );
      }
      if (isNodeOfType(parent, "AssignmentExpression")) {
        return parent.right === identifier && parent.parent?.parent === program;
      }
      return (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.length === 3 &&
        parent.arguments[1] === identifier &&
        isNodeOfType(parent.callee, "MemberExpression") &&
        getStaticPropertyName(parent.callee) === "assign" &&
        isNodeOfType(parent.parent, "VariableDeclarator") &&
        parent.parent.parent?.parent === program
      );
    }),
  );
};

const readRegex = (value: EsTreeNode | undefined, pattern: string, flags = ""): boolean => {
  if (!isNodeOfType(value, "Literal")) return false;
  const literal = value as { regex?: { pattern: string; flags: string } };
  return literal.regex?.pattern === pattern && literal.regex.flags === flags;
};

const readStockConfigRequire = (node: EsTreeNode, scopes: ScopeAnalysis): string | null =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "require" &&
  node.arguments.length === 1
    ? getGlobalRequireModuleSource(node, scopes)
    : null;

const readStockRequireBinding = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const initializer = readConst(node, scopes);
  return initializer ? readStockConfigRequire(initializer, scopes) : null;
};

const readsLoaderFromStockCssPlugin = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  getStaticPropertyName(node) === "loader" &&
  readStockRequireBinding(node.object, scopes) === "mini-css-extract-plugin";

const isStockRemovalPredicate = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "ArrowFunctionExpression") ||
    node.async ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.body.body.length !== 1
  )
    return false;
  const parameter = scopes.symbolFor(node.params[0]);
  if (!parameter) return false;
  const [returned] = node.body.body;
  const call = isNodeOfType(returned, "ReturnStatement") ? returned.argument : null;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    getStaticPropertyName(call.callee) !== "test" ||
    !isNodeOfType(call.arguments[0], "Identifier") ||
    scopes.symbolFor(call.arguments[0]) !== parameter
  )
    return false;
  const regex = call.callee.object;
  if (
    !isNodeOfType(regex, "NewExpression") ||
    !isNodeOfType(regex.callee, "Identifier") ||
    regex.callee.name !== "RegExp" ||
    !scopes.isGlobalReference(regex.callee) ||
    regex.arguments.length < 1 ||
    regex.arguments.length > 2
  )
    return false;
  return regex.arguments.length === 1
    ? readRegex(regex.arguments[0], "\\.js$") || readRegex(regex.arguments[0], "\\.txt$")
    : readRegex(regex.arguments[0], "\\.js$") && readString(regex.arguments[1]) === "m";
};

const readStockRemovalOptions = (value: EsTreeNode | undefined, scopes: ScopeAnalysis): boolean => {
  const options = readProperties(value);
  const after = readProperties(options?.get("after"));
  const candidates = after?.get("test");
  if (
    options?.size !== 1 ||
    after?.size !== 1 ||
    !isNodeOfType(candidates, "ArrayExpression") ||
    candidates.elements.length !== 1
  )
    return false;
  const first = candidates.elements[0];
  const item = first ? readProperties(first) : null;
  const folder = readString(item?.get("folder"));
  const predicate = item?.get("method");
  return (
    item?.size === 2 &&
    (folder === "build" || folder === "demo") &&
    Boolean(predicate && isStockRemovalPredicate(predicate, scopes))
  );
};

const hasClosedConfigEvaluation = (
  expression: EsTreeNode,
  rootDirectory: string,
  scopes: ScopeAnalysis,
): boolean => {
  let unsupported = false;
  walkAst(expression, (node) => {
    if (unsupported) return false;
    if (isFunctionLike(node)) {
      unsupported = !isStockRemovalPredicate(node, scopes);
      return false;
    }
    if (isNodeOfType(node, "NewExpression")) {
      const provider = readStockRequireBinding(node.callee, scopes);
      unsupported =
        !provider ||
        !STOCK_CONFIG_PLUGINS.has(provider) ||
        (provider === "remove-files-webpack-plugin" &&
          (node.arguments.length !== 1 || !readStockRemovalOptions(node.arguments[0], scopes)));
      return;
    }
    if (isNodeOfType(node, "CallExpression")) {
      unsupported = !readPath(node, rootDirectory, scopes) && !readAssignedProperties(node, scopes);
      return;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const parent = node.parent;
      unsupported =
        !readsLoaderFromStockCssPlugin(node, scopes) &&
        (!isNodeOfType(parent, "CallExpression") || parent.callee !== node);
      return;
    }
    if (isNodeOfType(node, "ObjectExpression")) {
      unsupported = !readProperties(node);
      return;
    }
    const nodeType: string = node.type;
    switch (nodeType) {
      case "ArrayExpression":
      case "Identifier":
      case "Literal":
      case "ParenthesizedExpression":
      case "Property":
        return;
      default:
        unsupported = true;
    }
  });
  return !unsupported;
};

// Even a literal externals key intercepts the original request before alias
// resolution. Only these known React peer mappings leave the owned graph alone.
const hasStockExternalDeclarations = (
  properties: Map<string, EsTreeNode>,
  output: Map<string, EsTreeNode>,
): boolean => {
  const externalType = properties.get("externalsType");
  if (externalType !== undefined && readString(externalType) !== "module") return false;
  const value = properties.get("externals");
  if (value === undefined) return true;
  const externals = readProperties(value);
  if (!externals) return false;
  return [...externals].every(([request, external]) => {
    const root = STOCK_REACT_EXTERNALS.get(request);
    if (!root) return false;
    if (readString(external) === request) return true;
    if (externalType !== undefined || readString(output.get("libraryTarget")) !== "umd")
      return false;
    const bindings = readProperties(external);
    return (
      bindings?.size === 4 &&
      readString(bindings.get("root")) === root &&
      ["commonjs", "commonjs2", "amd"].every((key) => readString(bindings.get(key)) === request)
    );
  });
};

const hasStockLoaderDeclarations = (
  configuration: Map<string, EsTreeNode>,
  scopes: ScopeAnalysis,
  selectedLibraryOutput: boolean,
): boolean => {
  const value = configuration.get("module");
  if (value === undefined) return true;
  const moduleProperties = readProperties(value);
  const rules = moduleProperties?.get("rules");
  if (moduleProperties?.size !== 1 || !isNodeOfType(rules, "ArrayExpression")) return false;
  return rules.elements.every((entry) => {
    const rule = entry ? readProperties(entry) : null;
    if (!rule) return false;
    const test = rule.get("test");
    const loader = readString(rule.get("loader"));
    if (loader === "ts-loader" && readRegex(test, "\\.(ts|tsx)$")) {
      return rule.size === 3 && readRegex(rule.get("exclude"), "node_modules");
    }
    if (loader === "babel-loader" && readRegex(test, "\\.(js|jsx)$")) {
      return (
        (!selectedLibraryOutput && rule.size === 2) ||
        (rule.size === 3 && readRegex(rule.get("exclude"), "node_modules"))
      );
    }
    if (selectedLibraryOutput || rule.size !== 2 || !readRegex(test, "\\.css$", "i")) return false;
    if (readString(rule.get("type")) === "asset/source") return true;
    const use = rule.get("use");
    return (
      isNodeOfType(use, "ArrayExpression") &&
      use.elements.length === 2 &&
      Boolean(use.elements[0] && readsLoaderFromStockCssPlugin(use.elements[0], scopes)) &&
      readString(use.elements[1] ?? undefined) === "css-loader"
    );
  });
};

const hasClosedConfigInitialization = (
  declaration: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  rootDirectory: string,
): boolean => {
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !declaration.init
  )
    return false;
  const initializer = declaration.init;
  const source = readStockConfigRequire(initializer, scopes);
  if (source)
    return source === "path" || source === "node:path" || STOCK_CONFIG_PLUGINS.has(source);
  return Boolean(
    readAssignedProperties(declaration.id, scopes) &&
    hasDirectConfigReferences(declaration.id, program, scopes) &&
    hasClosedConfigEvaluation(initializer, rootDirectory, scopes),
  );
};

const readConfigurations = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  rootDirectory: string,
): EsTreeNode[] | null => {
  if (!isNodeOfType(program, "Program")) return null;
  let configurations: EsTreeNode[] | null = null;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      if (
        !statement.declarations.every((declaration) =>
          hasClosedConfigInitialization(declaration, program, scopes, rootDirectory),
        )
      )
        return null;
      continue;
    }
    if (!isNodeOfType(statement, "ExpressionStatement")) return null;
    const { expression } = statement;
    if (readString(expression) === "use strict") continue;
    if (
      configurations ||
      !isNodeOfType(expression, "AssignmentExpression") ||
      expression.operator !== "=" ||
      !isNodeOfType(expression.left, "MemberExpression") ||
      !isNodeOfType(expression.left.object, "Identifier") ||
      expression.left.object.name !== "module" ||
      !scopes.isGlobalReference(expression.left.object) ||
      getStaticPropertyName(expression.left) !== "exports"
    ) {
      return null;
    }
    const exported = stripParenExpression(expression.right);
    if (!hasClosedConfigEvaluation(exported, rootDirectory, scopes)) return null;
    if (isNodeOfType(exported, "ArrayExpression")) {
      configurations = [];
      for (const element of exported.elements) {
        if (!element || isNodeOfType(element, "SpreadElement")) return null;
        configurations.push(element);
      }
    } else {
      configurations = [exported];
    }
  }
  return configurations;
};

const isInsideRoot = (rootDirectory: string, filePath: string): boolean => {
  const relativePath = path.relative(rootDirectory, filePath);
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

// Each group is the full candidate list for one supported declared output.
// Directory entry resolution and multiple plausible files are outside this proof.
const readUniqueDeclaredModuleCandidate = (
  rootDirectory: string,
  candidateGroups: readonly (readonly string[])[],
): string | null => {
  let selectedPath: string | null = null;
  for (const candidates of candidateGroups) {
    let outputPath: string | null = null;
    for (const input of new Set(candidates.map((candidate) => path.normalize(candidate)))) {
      if (!path.isAbsolute(input) || !isInsideRoot(rootDirectory, input)) return null;
      recordExistenceProbe(input);
      try {
        const entry = lstatSync(input, { throwIfNoEntry: false });
        if (!entry) continue;
        if (outputPath || !entry.isFile() || path.normalize(realpathSync(input)) !== input) {
          return null;
        }
        outputPath = input;
      } catch {
        return null;
      }
    }
    if (!outputPath || (selectedPath && selectedPath !== outputPath)) return null;
    selectedPath = outputPath;
  }
  if (selectedPath) recordContentProbe(selectedPath);
  return selectedPath;
};

export const createDeclaredWebpackModuleResolver = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  rootDirectory: string,
  libraryOutputs: readonly string[],
): ((specifier: string) => ResolvedWebpackModule | null) | null => {
  if (libraryOutputs.length === 0) return null;
  const outputs = new Set(libraryOutputs.map((value) => path.resolve(rootDirectory, value)));
  if (
    outputs.size !== libraryOutputs.length ||
    Array.from(outputs).some((value) => !isWithin(rootDirectory, value))
  ) {
    return null;
  }
  const configurations = readConfigurations(program, scopes, rootDirectory);
  if (!configurations) return null;
  const selectedRoutes = new Map<string, WebpackOutputRoute>();
  for (const configuration of configurations) {
    const properties = readAssignedProperties(configuration, scopes);
    const output = readProperties(properties?.get("output"));
    const outputDirectory = readPath(output?.get("path"), rootDirectory, scopes);
    const filename = readString(output?.get("filename"));
    if (
      !properties ||
      !output ||
      !outputDirectory ||
      [...properties.keys()].some((key) => !CONFIG_PROPERTIES.has(key)) ||
      !hasStockExternalDeclarations(properties, output)
    )
      return null;
    const selected = filename !== null && outputs.has(path.join(outputDirectory, filename));
    if (!hasStockLoaderDeclarations(properties, scopes, selected)) return null;
    const entry = properties.get("entry");
    const entries =
      readStringList(entry) ?? (typeof readString(entry) === "string" ? [readString(entry)] : []);
    if (entries.length === 0) return null;
    if (filename === null) {
      if (!entries.every((value) => value?.endsWith(".css"))) return null;
      continue;
    }
    if (path.basename(filename) !== filename || filename.includes("[")) return null;
    const outputPath = path.join(outputDirectory, filename);
    if (!outputs.has(outputPath)) continue;
    if (selectedRoutes.has(outputPath) || properties.has("plugins") || entries.length !== 1)
      return null;
    const [entrySource] = entries;
    if (!entrySource || !entrySource.startsWith("./")) return null;
    const entryPath = path.resolve(rootDirectory, entrySource);
    if (
      !/\.[cm]?tsx?$/.test(entryPath) ||
      !readUniqueDeclaredModuleCandidate(rootDirectory, [[entryPath]])
    )
      return null;
    const resolver = readProperties(properties.get("resolve"));
    if (!resolver || Array.from(resolver.keys()).some((key) => !RESOLVE_PROPERTIES.has(key)))
      return null;
    const aliases = readProperties(resolver.get("alias"));
    if (!aliases || aliases.size !== 1) return null;
    const [aliasEntry] = aliases;
    if (!aliasEntry) return null;
    const [alias, aliasValue] = aliasEntry;
    const aliasDirectory = readPath(aliasValue, rootDirectory, scopes);
    const extensions = readStringList(resolver.get("extensions"));
    if (
      !aliasDirectory ||
      !extensions?.length ||
      extensions.some((extension) => !SOURCE_EXTENSIONS.has(extension)) ||
      new Set(extensions).size !== extensions.length
    ) {
      return null;
    }
    selectedRoutes.set(outputPath, { entryPath, alias, aliasDirectory, extensions });
  }
  if (selectedRoutes.size !== outputs.size) return null;
  const routes = [...selectedRoutes.values()];
  const entryPaths = routes.map((route) => route.entryPath);

  return (specifier) => {
    const [alias, ...segments] = specifier.split("/");
    if (
      !alias ||
      segments.length === 0 ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      specifier.includes("\\")
    ) {
      return null;
    }
    const candidateGroups: string[][] = [];
    for (const route of routes) {
      if (route.alias !== alias) return null;
      const request = path.resolve(route.aliasDirectory, ...segments);
      if (!isWithin(route.aliasDirectory, request)) return null;
      candidateGroups.push([request, ...route.extensions.map((extension) => request + extension)]);
    }
    const filePath = readUniqueDeclaredModuleCandidate(rootDirectory, candidateGroups);
    return filePath && /\.[cm]?tsx?$/.test(filePath) ? { filePath, entryPaths } : null;
  };
};
