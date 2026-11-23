import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";

interface Alias {
  readonly find: string;
  readonly replacement: string;
}

export interface DeclaredViteProjectionInputs {
  readonly localTransform?: { readonly specifier: string; readonly exportedName: string };
  readonly packageShimAlias?: { readonly find: string; readonly relativeReplacement: string };
  readonly requiredSourceAliases?: readonly ("@" | "src")[];
}

export interface DeclaredViteDefaultBuild {
  readonly root: string;
  readonly entry: "index.html";
  readonly selectedEnvironment: "default-production-client";
  readonly aliases: readonly Alias[];
  readonly effects: readonly ("automatic-react-jsx" | "svg-components" | "local-jsx-transform")[];
  readonly externalProviders: readonly string[];
  readonly localTransform: { readonly specifier: string; readonly exportedName: string } | null;
  readonly localPackageShim: Alias | null;
  readonly implicitConfigLookups: readonly ("svgr" | "postcss" | "sass")[];
}

const UNKNOWN = Symbol("unknown");
type Scalar = string | boolean | number | null | undefined;
type Static = Scalar | typeof UNKNOWN;

const DEFAULT_ENV: ReadonlyMap<string, Scalar> = new Map([
  ["NODE_ENV", "production"],
  ["COVERAGE", undefined],
  ["ANALYZE_MODE", undefined],
  ["PORT", undefined],
]);

const PLUGIN_EXPORTS: ReadonlyMap<string, string> = new Map([
  ["vite", "defineConfig"],
  ["@vitejs/plugin-react", "default"],
  ["vite-plugin-svgr", "default"],
  ["vite-plugin-istanbul", "default"],
  ["rollup-plugin-visualizer", "visualizer"],
  ["vite-plugin-total-bundle-size", "totalBundleSize"],
  ["node:path", "default"],
  ["path", "default"],
]);

const relativePlugin = /^\.\/[A-Za-z0-9_-]+(?:\.[cm]?[jt]s)?$/u;

const readFields = (
  node: EsTreeNode | null | undefined,
  allowed?: readonly string[],
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
      return null;
    const key = getStaticPropertyKeyName(property);
    if (
      !key ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      fields.has(key) ||
      (allowed && !allowed.includes(key))
    )
      return null;
    fields.set(key, property.value);
  }
  return fields;
};

const literal = (node: EsTreeNode | undefined): Static => {
  if (
    isNodeOfType(node, "TemplateLiteral") &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  )
    return node.quasis[0]?.value.cooked ?? UNKNOWN;
  if (!isNodeOfType(node, "Literal")) return UNKNOWN;
  const value = node.value;
  return value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : UNKNOWN;
};

const envName = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.computed ||
    node.optional ||
    !isNodeOfType(node.property, "Identifier")
  )
    return null;
  const env = node.object;
  return isNodeOfType(env, "MemberExpression") &&
    !env.computed &&
    !env.optional &&
    isNodeOfType(env.property, "Identifier") &&
    env.property.name === "env" &&
    isNodeOfType(env.object, "Identifier") &&
    env.object.name === "process" &&
    scopes.isGlobalReference(env.object)
    ? node.property.name
    : null;
};

const imported = (node: EsTreeNode, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    declaration.importKind === "type" ||
    typeof declaration.source.value !== "string"
  )
    return null;
  const specifier = symbol.declarationNode;
  if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
    return { source: declaration.source.value, name: "default" };
  }
  if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind !== "type") {
    const name = isNodeOfType(specifier.imported, "Identifier") ? specifier.imported.name : null;
    return name ? { source: declaration.source.value, name } : null;
  }
  return null;
};

const builtinPath = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const binding = imported(node, scopes);
  return (
    !!binding &&
    binding.name === "default" &&
    (binding.source === "path" || binding.source === "node:path")
  );
};

const rootDirectoryIdentifier = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === "__dirname" && scopes.isGlobalReference(node);

const pathResolve = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(node, "CallExpression") || node.optional || node.arguments.length !== 2)
    return null;
  const [directory, filename] = node.arguments;
  const callee = node.callee;
  const replacement = literal(filename);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "resolve" &&
    builtinPath(callee.object, scopes) &&
    directory &&
    rootDirectoryIdentifier(directory, scopes) &&
    typeof replacement === "string" &&
    !path.isAbsolute(replacement) &&
    !replacement.includes("\\")
    ? replacement
    : null;
};

const rootSrcTemplate = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "TemplateLiteral") ||
    node.expressions.length !== 1 ||
    node.quasis.length !== 2
  )
    return false;
  const [directory] = node.expressions;
  return (
    !!directory &&
    rootDirectoryIdentifier(directory, scopes) &&
    node.quasis[0]?.value.cooked === "" &&
    node.quasis[1]?.value.cooked === "/src/"
  );
};

const strings = (node: EsTreeNode | undefined): string[] | null => {
  if (!isNodeOfType(node, "ArrayExpression")) return null;
  const values: string[] = [];
  for (const item of node.elements) {
    const value = literal(item ?? undefined);
    if (typeof value !== "string") return null;
    values.push(value);
  }
  return values;
};

const readAliases = (
  node: EsTreeNode,
  root: string,
  scopes: ScopeAnalysis,
  packageShim: DeclaredViteProjectionInputs["packageShimAlias"],
): Alias[] | null => {
  const resolve = readFields(node, ["alias"]);
  const aliases = resolve?.get("alias");
  if (!isNodeOfType(aliases, "ArrayExpression")) return null;
  const result: Alias[] = [];
  const seen = new Set<string>();
  for (const item of aliases.elements) {
    const field = readFields(item, ["find", "replacement"]);
    const find = literal(field?.get("find"));
    const replacement = field?.get("replacement");
    if (typeof find !== "string" || !replacement || seen.has(find)) return null;
    seen.add(find);
    if ((find === "@/" || find === "src/") && rootSrcTemplate(replacement, scopes)) {
      const normalized = find.replace(/\/$/u, "");
      if (result.some((alias) => alias.find === normalized)) return null;
      result.push({ find: normalized, replacement: path.join(root, "src") });
      continue;
    }
    // This package import is deliberately outside React, JSX and Vite. Its
    // resolved shim must still be included in the effective source graph.
    const relative = pathResolve(replacement, scopes);
    if (
      !packageShim ||
      find !== packageShim.find ||
      !/^@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u.test(find) ||
      /^(?:@vitejs|@svgr|@rollup|@babel|@esbuild|@testing-library)\//u.test(find) ||
      !relative ||
      relative !== packageShim.relativeReplacement ||
      !/^src\/shims\/[A-Za-z0-9_-]+\.cjs$/u.test(relative)
    )
      return null;
    result.push({ find, replacement: path.join(root, relative) });
  }
  return result;
};

const isStringReceiverExpression = (
  node: EsTreeNode,
  parameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Identifier"))
    return scopes.symbolFor(value) === scopes.symbolFor(parameter);
  if (isNodeOfType(value, "MemberExpression")) {
    return (
      value.computed &&
      literal(value.property) === 0 &&
      isStringReceiverExpression(value.object, parameter, scopes)
    );
  }
  if (
    !isNodeOfType(value, "CallExpression") ||
    !isNodeOfType(value.callee, "MemberExpression") ||
    value.callee.computed ||
    !isNodeOfType(value.callee.property, "Identifier")
  )
    return false;
  const method = value.callee.property.name;
  const args = value.arguments;
  return (
    ((method === "pop" && args.length === 0) ||
      (method === "split" && args.length === 1 && ["/", "."].includes(String(literal(args[0]))))) &&
    isStringReceiverExpression(value.callee.object, parameter, scopes)
  );
};

const isSvgPrefix = (node: EsTreeNode | undefined, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "ArrowFunctionExpression") ||
    node.async ||
    node.params.length !== 2 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    !isNodeOfType(node.params[1], "ObjectPattern") ||
    node.params[1].properties.length !== 1 ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.body.body.length !== 2
  )
    return false;
  const property = node.params[1].properties[0];
  const [declaration, returnStatement] = node.body.body;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.kind !== "init" ||
    getStaticPropertyKeyName(property) !== "path" ||
    !isNodeOfType(property.value, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !isNodeOfType(returnStatement.argument, "TemplateLiteral") ||
    returnStatement.argument.expressions.length !== 1
  )
    return false;
  const variable = declaration.declarations[0];
  const expression = returnStatement.argument.expressions[0];
  return (
    !!variable &&
    !!variable.init &&
    isNodeOfType(variable.id, "Identifier") &&
    isNodeOfType(expression, "Identifier") &&
    scopes.symbolFor(expression) === scopes.symbolFor(variable.id) &&
    isStringReceiverExpression(variable.init, property.value, scopes)
  );
};

const isSvgConfig = (argument: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const root = readFields(argument, ["svgrOptions"]);
  const options = readFields(root?.get("svgrOptions"), [
    "prettier",
    "plugins",
    "icon",
    "svgoConfig",
    "svgProps",
    "replaceAttrValues",
    "runtimeConfig",
  ]);
  if (!options) return false;
  const plugins = strings(options.get("plugins"));
  if (
    plugins?.length !== 2 ||
    plugins[0] !== "@svgr/plugin-svgo" ||
    plugins[1] !== "@svgr/plugin-jsx"
  )
    return false;
  if (options.has("runtimeConfig") && literal(options.get("runtimeConfig")) !== false) return false;
  for (const key of ["prettier", "icon"]) {
    if (options.has(key) && typeof literal(options.get(key)) !== "boolean") return false;
  }
  const svgProps = readFields(options.get("svgProps"), ["role"]);
  const replacements = readFields(options.get("replaceAttrValues"));
  if (
    !svgProps ||
    [...svgProps.values()].some((v) => typeof literal(v) !== "string") ||
    !replacements ||
    [...replacements.values()].some((v) => typeof literal(v) !== "string")
  )
    return false;
  const audit = readFields(options.get("svgoConfig"), ["multipass", "plugins"]);
  const steps = audit?.get("plugins");
  if (
    !isNodeOfType(steps, "ArrayExpression") ||
    steps.elements.length !== 2 ||
    typeof literal(audit?.get("multipass")) !== "boolean"
  )
    return false;
  const first = readFields(steps.elements[0], ["name", "params"]);
  const last = readFields(steps.elements[1], ["name", "params"]);
  const params = readFields(first?.get("params"), ["overrides"]);
  const overrides = readFields(params?.get("overrides"), ["removeViewBox"]);
  const prefix = readFields(last?.get("params"), ["prefix"]);
  return (
    literal(first?.get("name")) === "preset-default" &&
    literal(overrides?.get("removeViewBox")) === false &&
    literal(last?.get("name")) === "prefixIds" &&
    isSvgPrefix(prefix?.get("prefix"), scopes)
  );
};

const isPureChunkSelector = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "FunctionExpression") ||
    node.async ||
    node.generator ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    node.body.body.length !== 1
  )
    return false;
  const [parameter] = node.params;
  const [statement] = node.body.body;
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.consequent, "BlockStatement") ||
    statement.consequent.body.length !== 1
  )
    return false;
  const [returned] = statement.consequent.body;
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument ||
    typeof literal(returned.argument) !== "string"
  )
    return false;
  const readsOwnPath = (value: EsTreeNode): boolean => {
    const test = stripParenExpression(value);
    if (isNodeOfType(test, "LogicalExpression") && test.operator === "||")
      return readsOwnPath(test.left) && readsOwnPath(test.right);
    return (
      isNodeOfType(test, "CallExpression") &&
      !test.optional &&
      test.arguments.length === 1 &&
      typeof literal(test.arguments[0]) === "string" &&
      isNodeOfType(test.callee, "MemberExpression") &&
      !test.callee.computed &&
      !test.callee.optional &&
      isNodeOfType(test.callee.property, "Identifier") &&
      test.callee.property.name === "includes" &&
      isNodeOfType(test.callee.object, "Identifier") &&
      scopes.symbolFor(test.callee.object) === scopes.symbolFor(parameter)
    );
  };
  return readsOwnPath(statement.test);
};

// The result is a projection of a selected route, not an installed-provider
// certificate. Named local obligations are carried to that separate verifier.
export const readDeclaredViteDefaultBuild = (
  filename: string,
  inputs: DeclaredViteProjectionInputs = {},
): DeclaredViteDefaultBuild | null => {
  if (!path.isAbsolute(filename) || !/^vite\.config\.[cm]?[jt]s$/u.test(path.basename(filename)))
    return null;
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  try {
    if (fs.realpathSync(filename) !== filename || !fs.lstatSync(filename).isFile()) return null;
  } catch {
    return null;
  }
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return null;
  const scopes = analyzeScopes(program);
  const scalars = new Map<number, Scalar>();
  const def = program.body.at(-1);
  if (!isNodeOfType(def, "ExportDefaultDeclaration")) return null;
  const definition = stripParenExpression(def.declaration);
  if (
    !isNodeOfType(definition, "CallExpression") ||
    definition.optional ||
    definition.arguments.length !== 1
  )
    return null;
  const factory = imported(definition.callee, scopes);
  if (factory?.source !== "vite" || factory.name !== "defineConfig") return null;

  const readScalar = (raw: EsTreeNode): Static => {
    const node = stripParenExpression(raw);
    if (isNodeOfType(node, "Literal")) return literal(node);
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (symbol && scalars.has(symbol.id)) return scalars.get(symbol.id);
      return node.name === "undefined" && scopes.isGlobalReference(node) ? undefined : UNKNOWN;
    }
    const name = envName(node, scopes);
    if (name && DEFAULT_ENV.has(name)) return DEFAULT_ENV.get(name);
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
      const operand = readScalar(node.argument);
      return operand !== UNKNOWN ? !operand : UNKNOWN;
    }
    if (
      isNodeOfType(node, "BinaryExpression") &&
      (node.operator === "===" || node.operator === "!==")
    ) {
      const left = readScalar(node.left);
      const right = readScalar(node.right);
      if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
      return node.operator === "===" ? left === right : left !== right;
    }
    if (
      isNodeOfType(node, "LogicalExpression") &&
      (node.operator === "||" || node.operator === "&&")
    ) {
      const left = readScalar(node.left);
      if (left === UNKNOWN) return UNKNOWN;
      return (node.operator === "||" ? Boolean(left) : !left) ? left : readScalar(node.right);
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      const test = readScalar(node.test);
      return test !== UNKNOWN ? readScalar(test ? node.consequent : node.alternate) : UNKNOWN;
    }
    return UNKNOWN;
  };

  const external = new Set<string>();
  let localSource: string | null = null;
  for (const statement of program.body.slice(0, -1)) {
    if (isNodeOfType(statement, "FunctionDeclaration")) continue; // Only inactive declarations are callable below.
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (statement.importKind === "type") continue;
      if (statement.specifiers.length === 0 || typeof statement.source.value !== "string")
        return null;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const binding = imported(specifier.local, scopes);
        if (!binding) return null;
        if (PLUGIN_EXPORTS.get(binding.source) === binding.name) {
          if (binding.source !== "path" && binding.source !== "node:path")
            external.add(binding.source);
        } else if (
          !localSource &&
          relativePlugin.test(binding.source) &&
          binding.source === inputs.localTransform?.specifier &&
          binding.name === inputs.localTransform.exportedName
        ) {
          localSource = binding.source;
        } else return null;
      }
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
    for (const declaration of statement.declarations) {
      if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return null;
      const binding = scopes.symbolFor(declaration.id);
      if (!binding || binding.references.some(({ flag }) => flag !== "read")) return null;
      const resolved = readScalar(declaration.init);
      if (resolved !== UNKNOWN) scalars.set(binding.id, resolved);
      else if (pathResolve(declaration.init, scopes) === null) return null;
    }
  }

  const options = readFields(definition.arguments[0], [
    "plugins",
    "clearScreen",
    "server",
    "envPrefix",
    "esbuild",
    "build",
    "resolve",
    "optimizeDeps",
    "css",
  ]);
  const list = options?.get("plugins");
  if (!options || !isNodeOfType(list, "ArrayExpression")) return null;
  const effects = new Set<DeclaredViteDefaultBuild["effects"][number]>();
  let localTransform: DeclaredViteDefaultBuild["localTransform"] = null;
  let svgLooksForConfig = false;
  for (const raw of list.elements) {
    if (!raw || isNodeOfType(raw, "SpreadElement")) return null;
    const conditional = isNodeOfType(raw, "ConditionalExpression");
    if (conditional && readScalar(raw.alternate) !== undefined) return null;
    const test = conditional ? readScalar(raw.test) : true;
    if (test === UNKNOWN) return null;
    const node = conditional ? raw.consequent : raw;
    if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
    const call = imported(node.callee, scopes);
    if (!test) {
      if (
        !call &&
        isNodeOfType(node.callee, "Identifier") &&
        isNodeOfType(scopes.symbolFor(node.callee)?.declarationNode, "FunctionDeclaration") &&
        node.arguments.length === 0
      )
        continue;
      const [argument] = node.arguments;
      if (!call || node.arguments.length !== 1) return null;
      const allowed =
        call.source === "vite-plugin-istanbul"
          ? ["requireEnv", "include", "exclude"]
          : call.source === "rollup-plugin-visualizer"
            ? ["emitFile"]
            : call.source === "vite-plugin-total-bundle-size"
              ? ["fileNameRegex", "calculateGzip"]
              : null;
      const inactiveOptions = allowed && readFields(argument, allowed);
      if (
        !inactiveOptions ||
        [...inactiveOptions.values()].some(
          (value) =>
            literal(value) === UNKNOWN &&
            !strings(value) &&
            !(isNodeOfType(value, "Literal") && "regex" in value),
        )
      )
        return null;
      continue;
    }
    let effect: DeclaredViteDefaultBuild["effects"][number];
    if (
      call?.source === "@vitejs/plugin-react" &&
      call.name === "default" &&
      !conditional &&
      node.arguments.length === 0
    ) {
      effect = "automatic-react-jsx";
    } else if (
      call?.source === "vite-plugin-svgr" &&
      call.name === "default" &&
      !conditional &&
      node.arguments.length === 1 &&
      node.arguments[0] &&
      isSvgConfig(node.arguments[0], scopes)
    ) {
      effect = "svg-components";
      svgLooksForConfig = !readFields(readFields(node.arguments[0])?.get("svgrOptions"))?.has(
        "runtimeConfig",
      );
    } else if (
      call &&
      call.source === localSource &&
      call.name === inputs.localTransform?.exportedName &&
      conditional &&
      node.arguments.length === 0
    ) {
      effect = "local-jsx-transform";
      localTransform = { specifier: call.source, exportedName: call.name };
    } else return null;
    if (effects.has(effect)) return null;
    effects.add(effect);
  }
  const supportedOrder: DeclaredViteDefaultBuild["effects"] = [
    "automatic-react-jsx",
    "local-jsx-transform",
    "svg-components",
  ];
  const effectOrder = supportedOrder.filter((name) => effects.has(name));
  if (
    !effects.has("automatic-react-jsx") ||
    !!localSource !== !!localTransform ||
    (inputs.localTransform && !localTransform) ||
    [...effects].some((effect, index) => effect !== effectOrder[index])
  )
    return null;

  const root = path.dirname(filename);
  const resolve = options.get("resolve");
  const aliases = resolve ? readAliases(resolve, root, scopes, inputs.packageShimAlias) : [];
  if (
    !aliases ||
    inputs.requiredSourceAliases?.some((name) => !aliases.some((alias) => alias.find === name))
  )
    return null;
  const localPackageShim =
    aliases.find((alias) => alias.find === inputs.packageShimAlias?.find) ?? null;
  if (inputs.packageShimAlias && !localPackageShim) return null;

  const inspectServerData = (node: EsTreeNode): boolean => {
    if (readScalar(node) !== UNKNOWN) return true;
    if (isNodeOfType(node, "ObjectExpression")) {
      const fields = readFields(node);
      return !!fields && [...fields.values()].every(inspectServerData);
    }
    if (isNodeOfType(node, "ArrayExpression")) return !!strings(node);
    return false;
  };
  const server = options.get("server");
  if (server) {
    const fields = readFields(server, [
      "host",
      "port",
      "strictPort",
      "watch",
      "proxy",
      "cors",
      "sourcemapIgnoreList",
    ]);
    if (!fields) return null;
    for (const [key, value] of fields) {
      if (key !== "proxy") {
        if (!inspectServerData(value)) return null;
        continue;
      }
      const proxies = readFields(value);
      if (!proxies) return null;
      for (const proxy of proxies.values()) {
        const props = readFields(proxy, ["target", "changeOrigin", "rewrite"]);
        // Only this server-side callback can be present, and the selected
        // production build does not invoke it.
        if (
          !props ||
          [...props].some(([name, child]) =>
            name === "rewrite"
              ? !isNodeOfType(child, "ArrowFunctionExpression") || child.async
              : !inspectServerData(child),
          )
        )
          return null;
      }
    }
  }
  const clearScreen = options.get("clearScreen");
  if (clearScreen && typeof literal(clearScreen) !== "boolean") return null;
  const envPrefix = options.get("envPrefix");
  if (envPrefix && !strings(envPrefix)) return null;
  const optimize = options.get("optimizeDeps");
  if (optimize && !strings(readFields(optimize, ["include"])?.get("include"))) return null;

  const esbuild = options.get("esbuild");
  if (esbuild) {
    const values = readFields(esbuild, [
      "keepNames",
      "sourcesContent",
      "sourcemap",
      "minifyIdentifiers",
      "minifySyntax",
      "drop",
      "pure",
    ]);
    if (!values) return null;
    for (const [name, value] of values) {
      if (name === "drop" || name === "pure") {
        const test = isNodeOfType(value, "ConditionalExpression") ? readScalar(value.test) : true;
        if (test === UNKNOWN) return null;
        const allowed = name === "drop" ? ["debugger"] : ["console.log", "console.debug"];
        // Both arms must be effect-free at config evaluation.
        const variants = isNodeOfType(value, "ConditionalExpression")
          ? [value.consequent, value.alternate]
          : [value];
        if (
          !variants.every((variant) => strings(variant)?.every((entry) => allowed.includes(entry)))
        )
          return null;
      } else if (typeof literal(value) !== "boolean") return null;
    }
  }
  const build = options.get("build");
  if (build) {
    const values = readFields(build, [
      "target",
      "reportCompressedSize",
      "chunkSizeWarningLimit",
      "rollupOptions",
    ]);
    if (!values) return null;
    for (const [key, value] of values) {
      if (key === "target") {
        if (typeof literal(value) !== "string") return null;
      } else if (key === "reportCompressedSize") {
        if (typeof literal(value) !== "boolean") return null;
      } else if (key === "chunkSizeWarningLimit") {
        if (typeof literal(value) !== "number") return null;
      } else {
        const conditional = isNodeOfType(value, "ConditionalExpression");
        const enabled = conditional ? readScalar(value.test) : true;
        if (enabled === UNKNOWN || (conditional && readFields(value.alternate)?.size !== 0))
          return null;
        const selected = readFields(conditional ? value.consequent : value, ["output"]);
        if (!selected) return null;
        const output = selected.get("output");
        if (!output) continue;
        const chunk = readFields(output, [
          "chunkFileNames",
          "entryFileNames",
          "assetFileNames",
          "manualChunks",
        ]);
        if (
          !chunk ||
          [...chunk].some(([name, option]) =>
            name === "manualChunks"
              ? !isPureChunkSelector(option, scopes)
              : typeof literal(option) !== "string",
          )
        )
          return null;
      }
    }
  }
  const css = options.get("css");
  const preprocessor = css && readFields(css, ["preprocessorOptions"]);
  const scss = preprocessor && readFields(preprocessor.get("preprocessorOptions"), ["scss"]);
  if (css && literal(readFields(scss?.get("scss"), ["api"])?.get("api")) !== "modern-compiler")
    return null;

  return {
    root,
    entry: "index.html",
    selectedEnvironment: "default-production-client",
    aliases,
    effects: [...effects],
    externalProviders: [...external],
    localTransform,
    localPackageShim,
    implicitConfigLookups: [
      "postcss",
      ...(css ? ["sass" as const] : []),
      ...(svgLooksForConfig ? ["svgr" as const] : []),
    ],
  };
};
