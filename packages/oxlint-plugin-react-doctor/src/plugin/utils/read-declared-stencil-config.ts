import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isBoundedStencilOutputGenerator } from "./is-bounded-stencil-output-generator.js";
import { parseSourceText } from "./parse-source-file.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Data = null | boolean | number | string | readonly Data[] | { readonly [key: string]: Data };
type DataObject = { readonly [key: string]: Data };
const UNKNOWN = Symbol("unknown");
type Pending = Data | typeof UNKNOWN;

const plain = (value: unknown): value is DataObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const CLASHING_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const own = (object: object, key: string) => Object.hasOwn(object, key);
const fields = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const member of node.properties) {
    if (!isNodeOfType(member, "Property") || member.computed || member.kind !== "init") return null;
    const key = isNodeOfType(member.key, "Identifier")
      ? member.key.name
      : isNodeOfType(member.key, "Literal") && typeof member.key.value === "string"
        ? member.key.value
        : undefined;
    if (!key || CLASHING_KEYS.has(key) || result.has(key)) return null;
    result.set(key, member.value);
  }
  return result;
};

const memberOf = (object: EsTreeNode, name?: string): EsTreeNode | null => {
  const parent = object.parent;
  return isNodeOfType(parent, "MemberExpression") &&
    parent.object === object &&
    !parent.computed &&
    !parent.optional &&
    isNodeOfType(parent.property, "Identifier") &&
    (name === undefined || parent.property.name === name)
    ? parent
    : null;
};

// Proves inert local initialization, a bounded stock-data generator and
// direct compiler filesystem writes through the verified compiler contract.
export const readDeclaredStencilLocalOutputFactory = (
  sourceText: string,
  expectedExport: string,
): { providerImports: readonly string[]; writeOptionKeys: readonly string[] } | null => {
  if (sourceText.length > 128 * 1024) return null;
  const program = parseSourceText({ filename: "local-output.plugin.ts", sourceText });
  if (!isNodeOfType(program, "Program")) return null;
  const imports = new Set<string>();
  const locals = new Set<string>();
  let selected: EsTreeNode | null = null;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      const [entry] = statement.specifiers;
      const source = statement.source.value;
      if (
        typeof source !== "string" ||
        imports.has(source) ||
        statement.attributes?.length ||
        statement.specifiers.length !== 1 ||
        !entry ||
        locals.has(entry.local.name)
      )
        return null;
      if (source === "@stencil/core/internal") {
        if (
          !isNodeOfType(entry, "ImportSpecifier") ||
          !isNodeOfType(entry.imported, "Identifier") ||
          entry.imported.name !== "OutputTargetCustom"
        )
          return null;
      } else if (
        source !== "json2md" ||
        !isNodeOfType(entry, "ImportDefaultSpecifier") ||
        statement.importKind === "type"
      )
        return null;
      locals.add(entry.local.name);
      imports.add(source);
      continue;
    }
    if (
      isNodeOfType(statement, "FunctionDeclaration") &&
      statement.id &&
      !locals.has(statement.id.name)
    ) {
      locals.add(statement.id.name);
      continue;
    }
    const exportNode = isNodeOfType(statement, "ExportNamedDeclaration");
    const declared = exportNode ? statement.declaration : statement;
    if (
      !isNodeOfType(declared, "VariableDeclaration") ||
      declared.kind !== "const" ||
      declared.declarations.length !== 1
    )
      return null;
    const [variable] = declared.declarations;
    if (!isNodeOfType(variable.id, "Identifier") || locals.has(variable.id.name) || !variable.init)
      return null;
    locals.add(variable.id.name);
    if (exportNode) {
      if (selected || variable.id.name !== expectedExport) return null;
      selected = variable.init;
    } else if (
      readData(variable.init, new Map()) === UNKNOWN &&
      !(isNodeOfType(variable.init, "Literal") && "regex" in variable.init)
    )
      return null;
  }
  if (
    !isNodeOfType(selected, "ArrowFunctionExpression") ||
    selected.async ||
    selected.params.length !== 1 ||
    !isNodeOfType(selected.params[0], "Identifier")
  )
    return null;
  const body = fields(stripParenExpression(selected.body));
  const generator = body?.get("generator");
  const kind = body?.get("type");
  const name = body?.get("name");
  if (
    !body ||
    body.size !== 3 ||
    !kind ||
    readData(kind, new Map()) !== "custom" ||
    !name ||
    !isNodeOfType(name, "Literal") ||
    typeof name.value !== "string" ||
    !isNodeOfType(generator, "FunctionExpression") ||
    !generator.async ||
    generator.generator ||
    generator.params.length !== 3 ||
    !generator.params.every((p) => isNodeOfType(p, "Identifier"))
  )
    return null;
  const scopes = analyzeScopes(program);
  const output = scopes.symbolFor(selected.params[0]);
  const compiler = scopes.symbolFor(generator.params[1]);
  if (
    !output ||
    !compiler ||
    !hasCompleteSymbolReferences(output, program, scopes) ||
    !hasCompleteSymbolReferences(compiler, program, scopes)
  )
    return null;
  const paths = new Set<string>();
  const usedOutput = new Set<EsTreeNode>();
  for (const { identifier, flag } of compiler.references) {
    const fs = memberOf(identifier, "fs");
    const method = fs ? memberOf(fs, "writeFile") : null;
    const call = method?.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== method ||
      call.optional ||
      call.arguments.length !== 2 ||
      !isNodeOfType(call.parent, "AwaitExpression")
    )
      return null;
    const [path] = call.arguments;
    if (
      !isNodeOfType(path, "MemberExpression") ||
      memberOf(path.object) !== path ||
      !isNodeOfType(path.property, "Identifier") ||
      scopes.symbolFor(path.object) !== output ||
      paths.has(path.property.name)
    )
      return null;
    paths.add(path.property.name);
    usedOutput.add(path.object);
  }
  if (paths.size !== 2 || !paths.has("tsPath") || !paths.has("mdPath")) return null;
  for (const { identifier, flag } of output.references) {
    if (flag !== "read") return null;
    if (usedOutput.has(identifier)) continue;
    const footer = memberOf(identifier, "footer");
    const fallback = footer?.parent;
    if (
      !isNodeOfType(fallback, "LogicalExpression") ||
      fallback.left !== footer ||
      fallback.operator !== "||" ||
      !isNodeOfType(fallback.right, "Literal") ||
      fallback.right.value !== "" ||
      !isNodeOfType(fallback.parent, "TemplateLiteral")
    )
      return null;
  }
  if (!isBoundedStencilOutputGenerator(program, generator, selected.params[0], scopes)) return null;
  return { providerImports: [...imports], writeOptionKeys: [...paths] };
};

interface StaticPathFunction {
  readonly receiver: ReadonlyMap<string, Data>;
  readonly parameters: readonly { name: string; fallback?: string }[];
  readonly chunks: readonly string[];
  readonly substitutions: readonly string[];
}

const readPathFunction = (
  node: EsTreeNode,
  literals: ReadonlyMap<string, Data>,
): StaticPathFunction | null => {
  if (
    !isNodeOfType(node, "ArrowFunctionExpression") ||
    node.async ||
    !isNodeOfType(node.body, "TemplateLiteral") ||
    node.params.length < 1 ||
    node.params.length > 3
  )
    return null;
  const parameters: { name: string; fallback?: string }[] = [];
  for (const parameter of node.params) {
    if (isNodeOfType(parameter, "Identifier")) {
      parameters.push({ name: parameter.name });
    } else if (
      isNodeOfType(parameter, "AssignmentPattern") &&
      isNodeOfType(parameter.left, "Identifier")
    ) {
      const fallback = readData(parameter.right, literals);
      if (typeof fallback !== "string") return null;
      parameters.push({ name: parameter.left.name, fallback });
    } else return null;
  }
  const names = new Set(parameters.map(({ name }) => name));
  if (names.size !== parameters.length) return null;
  const chunks = node.body.quasis.map((piece) => piece.value.cooked);
  if (chunks.some((piece) => typeof piece !== "string")) return null;
  const substitutions = [];
  for (const expression of node.body.expressions) {
    if (
      !isNodeOfType(expression, "Identifier") ||
      (!names.has(expression.name) && typeof literals.get(expression.name) !== "string")
    )
      return null;
    substitutions.push(expression.name);
  }
  return { receiver: new Map(literals), parameters, chunks: chunks as string[], substitutions };
};

function readData(
  node: EsTreeNode,
  literals: ReadonlyMap<string, Data>,
  paths: ReadonlyMap<string, StaticPathFunction> = new Map(),
  depth = 0,
): Pending {
  if (depth > 12) return UNKNOWN;
  const child = (value: EsTreeNode) => readData(value, literals, paths, depth + 1);
  if (isNodeOfType(node, "Literal")) {
    const value = node.value;
    return value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
      ? value
      : UNKNOWN;
  }
  if (isNodeOfType(node, "Identifier"))
    return literals.get(node.name) ?? (literals.has(node.name) ? null : UNKNOWN);
  if (isNodeOfType(node, "TemplateLiteral") && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? UNKNOWN;
  if (isNodeOfType(node, "TSAsExpression")) return child(node.expression);
  if (isNodeOfType(node, "ArrayExpression")) {
    const values: Data[] = [];
    for (const element of node.elements) {
      if (!element) return UNKNOWN;
      const value = child(element);
      if (value === UNKNOWN) return UNKNOWN;
      values.push(value);
    }
    return values;
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    isNodeOfType(node.callee, "Identifier")
  ) {
    const helper = paths.get(node.callee.name);
    if (!helper || node.arguments.length > helper.parameters.length) return UNKNOWN;
    const local = new Map(helper.receiver);
    for (const [index, parameter] of helper.parameters.entries()) {
      const arg = node.arguments[index];
      const value = arg ? child(arg) : parameter.fallback;
      if (typeof value !== "string") return UNKNOWN;
      local.set(parameter.name, value);
    }
    return helper.chunks
      .map((part, index) => part + (local.get(helper.substitutions[index]) ?? ""))
      .join("");
  }
  const properties = fields(node);
  if (!properties) return UNKNOWN;
  const values: Record<string, Data> = Object.create(null);
  for (const [key, ast] of properties) {
    const value = child(ast);
    if (value === UNKNOWN) return UNKNOWN;
    values[key] = value;
  }
  return values;
}

const SOURCES = new Map([
  ["@stencil/sass", "sass"],
  ["@revolist/stencil-angular-output", "angularOutputTarget"],
  ["@stencil/react-output-target", "reactOutputTarget"],
  ["@stencil/vue-output-target", "vueOutputTarget"],
  ["@revolist/svelte-output-target", "svelteOutputTarget"],
  ["@revolist/stencil-vue2-output-target", "vueOutputTarget"],
  ["@revolist/stencil-dash-output-target", "dashOutputTarget"],
]);

const ROOT_OPTIONS = new Set([
  "enableCache",
  "hashFileNames",
  "autoprefixCss",
  "minifyCss",
  "minifyJs",
  "preamble",
  "hashedFileNameLength",
  "invisiblePrehydration",
  "extras",
  "namespace",
  "taskQueue",
  "validatePrimaryPackageOutputTarget",
  "plugins",
  "outputTargets",
  "nodeResolve",
  "devServer",
  "testing",
]);
const TARGET_FIELDS = new Map([
  [
    "dist-custom-elements",
    ["type", "customElementsExportBehavior", "minify", "dir", "generateTypeDeclarations", "empty"],
  ],
  ["dist", ["type", "esmLoaderPath", "empty", "isPrimaryPackageOutputTarget"]],
  ["docs-readme", ["type", "dir", "footer"]],
  ["docs-vscode", ["type", "file"]],
  ["dist-hydrate-script", ["type"]],
  ["www", ["type", "copy", "serviceWorker"]],
]);
const TARGET_OPTIONS = new Map([
  [
    "@revolist/stencil-angular-output",
    [
      "componentCorePackage",
      "outputType",
      "customElementsDir",
      "directivesProxyFile",
      "directivesArrayFile",
      "excludeComponents",
      "lazyLoadCustomElements",
    ],
  ],
  ["@stencil/react-output-target", ["componentCorePackage", "proxiesFile", "excludeComponents"]],
  [
    "@stencil/vue-output-target",
    ["componentCorePackage", "proxiesFile", "excludeComponents", "includePolyfills"],
  ],
  [
    "@revolist/svelte-output-target",
    [
      "componentCorePackage",
      "proxiesFile",
      "includeDefineCustomElements",
      "legacy",
      "excludeComponents",
    ],
  ],
  [
    "@revolist/stencil-vue2-output-target",
    ["componentCorePackage", "proxiesFile", "excludeComponents"],
  ],
  [
    "@revolist/stencil-dash-output-target",
    [
      "outputDir",
      "components",
      "componentNames",
      "customElements",
      "excludeProperties",
      "defaultEvents",
    ],
  ],
  ["local", ["mdPath", "tsPath", "footer"]],
]);
const EXTRAS = new Set([
  "initializeNextTick",
  "scriptDataOpts",
  "appendChildSlotFix",
  "cloneNodeFix",
  "slotChildNodesFix",
  "enableImportInjection",
]);
const keysIn = (data: DataObject, keys: readonly string[]) =>
  Object.keys(data).every((key) => keys.includes(key));
const insidePath = /^(?:\.\/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*$/u;
const projectPath = (input: Data) =>
  typeof input === "string" &&
  insidePath.test(input) &&
  !input
    .split("/")
    .slice(1)
    .some((part) => part === ".." || part === ".") &&
  !input.split("/").includes("node_modules");

interface OutputFactory {
  readonly module: string;
  readonly exportedName: string;
  readonly arguments: DataObject;
  readonly deferredLocalOutputs?: readonly string[];
}
export interface DeclaredStencilConfig {
  readonly stylePlugin: string | null;
  readonly outputFactories: readonly OutputFactory[];
  readonly builtinOutputTargets: readonly DataObject[];
}

const allowedBuiltin = (target: DataObject): boolean => {
  const type = target.type;
  const allowed = typeof type === "string" ? TARGET_FIELDS.get(type) : undefined;
  if (!allowed || !keysIn(target, allowed)) return false;
  if (type === "dist" && target.esmLoaderPath !== undefined && target.esmLoaderPath !== "../loader")
    return false;
  if (type === "www" && target.serviceWorker !== null && target.serviceWorker !== undefined)
    return false;
  if (type === "www" && target.copy !== undefined) {
    if (!Array.isArray(target.copy)) return false;
    for (const item of target.copy) {
      if (!plain(item) || !keysIn(item, ["src", "dest"]) || typeof item.src !== "string")
        return false;
      if (
        !projectPath(item.src) &&
        !/^(?:\.\.\/node_modules\/[A-Za-z0-9_/-]+|\*\*\/e2e\/\*\.(?:html|css))$/u.test(item.src)
      )
        return false;
      if (item.dest !== undefined && item.dest !== "." && !projectPath(item.dest)) return false;
    }
  }
  if (target.dir !== undefined) {
    if (typeof target.dir !== "string" || !projectPath(target.dir)) return false;
    if (type === "docs-readme" && !/^(?:\.\/)?docs(?:\/|$)/u.test(target.dir)) return false;
    if (
      type === "dist-custom-elements" &&
      !/^(?:\.\/)?(?:dist|standalone|loader)(?:\/|$)/u.test(target.dir)
    )
      return false;
  }
  if (
    target.file !== undefined &&
    (typeof target.file !== "string" || !/^(?:\.\/)?[A-Za-z0-9_-]+-data\.json$/u.test(target.file))
  )
    return false;
  if (
    target.customElementsExportBehavior !== undefined &&
    target.customElementsExportBehavior !== "single-export-module"
  )
    return false;
  return ["generateTypeDeclarations", "empty", "isPrimaryPackageOutputTarget", "minify"].every(
    (key) => target[key] === undefined || typeof target[key] === "boolean",
  );
};

const plainConfigOther = (key: string, value: Data): boolean => {
  if (key === "extras")
    return (
      plain(value) &&
      Object.entries(value).every(([field, flag]) => EXTRAS.has(field) && typeof flag === "boolean")
    );
  if (key === "nodeResolve")
    return plain(value) && keysIn(value, ["preferBuiltins"]) && value.preferBuiltins === true;
  if (key === "devServer")
    return plain(value) && keysIn(value, ["address"]) && value.address === "localhost";
  if (key === "testing") {
    if (!plain(value) || !keysIn(value, ["transformIgnorePatterns", "testRegex", "transform"]))
      return false;
    const transform = value.transform;
    return (
      (transform === undefined ||
        (plain(transform) &&
          Object.values(transform).every(
            (ptr) => ptr === "<rootDir>/node_modules/@stencil/core/testing/jest-preprocessor.js",
          ))) &&
      [value.transformIgnorePatterns, value.testRegex].every(
        (entry) =>
          entry === undefined ||
          (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
      )
    );
  }
  if (key === "preamble") return typeof value === "string";
  if (key === "namespace")
    return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value);
  if (key === "taskQueue")
    return value === "async" || value === "immediate" || value === "congestionAsync";
  if (key === "hashedFileNameLength")
    return typeof value === "number" && Number.isInteger(value) && value >= 4 && value <= 32;
  return typeof value === "boolean";
};

// The result describes declarations only. Callers verify the actual compiler,
// source path, provider identities, local factory and output phase separately.
export const readDeclaredStencilConfig = (sourceText: string): DeclaredStencilConfig | null => {
  if (sourceText.length > 128 * 1024) return null;
  const program = parseSourceText({ filename: "stencil.config.ts", sourceText });
  if (!isNodeOfType(program, "Program")) return null;
  const imports = new Map<string, { module: string; exportedName: string }>();
  const literals = new Map<string, Data>();
  const paths = new Map<string, StaticPathFunction>();
  const used = new Set<string>();
  const names = new Set<string>();
  let configType: string | undefined;
  let config: Map<string, EsTreeNode> | null = null;
  for (const [index, statement] of program.body.entries()) {
    if (isNodeOfType(statement, "ImportDeclaration") && !literals.size && !paths.size && !config) {
      const module = statement.source.value;
      if (
        typeof module !== "string" ||
        statement.attributes?.length ||
        statement.specifiers.length !== 1
      )
        return null;
      const [specifier] = statement.specifiers;
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        !isNodeOfType(specifier.imported, "Identifier") ||
        names.has(specifier.local.name)
      )
        return null;
      const local = specifier.local.name;
      const exportedName = specifier.imported.name;
      names.add(local);
      if (module === "@stencil/core" && exportedName === "Config" && !configType)
        configType = local;
      else if (
        statement.importKind !== "type" &&
        specifier.importKind !== "type" &&
        (SOURCES.get(module) === exportedName ||
          /^\.\/scripts\/[a-zA-Z0-9_-]+\.plugin$/u.test(module))
      )
        imports.set(local, { module, exportedName });
      else return null;
      continue;
    }
    const declared = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (
      !isNodeOfType(declared, "VariableDeclaration") ||
      declared.kind !== "const" ||
      declared.declarations.length !== 1
    )
      return null;
    const [variable] = declared.declarations;
    if (!isNodeOfType(variable.id, "Identifier") || !variable.init || names.has(variable.id.name))
      return null;
    names.add(variable.id.name);
    if (declared !== statement) {
      if (index !== program.body.length - 1 || variable.id.name !== "config") return null;
      const annotation = variable.id.typeAnnotation?.typeAnnotation;
      if (
        annotation &&
        (!isNodeOfType(annotation, "TSTypeReference") ||
          !isNodeOfType(annotation.typeName, "Identifier") ||
          annotation.typeName.name !== configType)
      )
        return null;
      if (configType && !annotation) return null;
      config = fields(variable.init);
      if (!config) return null;
    } else {
      const literal = readData(variable.init, literals);
      if (literal !== UNKNOWN) literals.set(variable.id.name, literal);
      else {
        const helper = readPathFunction(variable.init, literals);
        if (!helper) return null;
        paths.set(variable.id.name, helper);
      }
    }
  }
  if (!config || Array.from(config.keys()).some((key) => !ROOT_OPTIONS.has(key))) return null;
  let stylePlugin: string | null = null;
  const outputFactories: OutputFactory[] = [];
  const builtinOutputTargets: DataObject[] = [];
  for (const [key, ast] of config) {
    if (key !== "plugins" && key !== "outputTargets") {
      const value = readData(ast, literals, paths);
      if (value === UNKNOWN || !plainConfigOther(key, value)) return null;
      continue;
    }
    if (!isNodeOfType(ast, "ArrayExpression")) return null;
    for (const entry of ast.elements) {
      if (!entry) return null;
      if (!isNodeOfType(entry, "CallExpression")) {
        if (key === "plugins") return null;
        const literal = readData(entry, literals, paths);
        if (!plain(literal) || !allowedBuiltin(literal)) return null;
        builtinOutputTargets.push(literal);
        continue;
      }
      if (entry.optional || !isNodeOfType(entry.callee, "Identifier")) return null;
      const binding = imports.get(entry.callee.name);
      if (!binding || used.has(entry.callee.name)) return null;
      used.add(entry.callee.name);
      if (key === "plugins") {
        if (binding.module !== "@stencil/sass" || entry.arguments.length || stylePlugin)
          return null;
        stylePlugin = binding.module;
        continue;
      }
      const local = binding.module.startsWith(".");
      const options = TARGET_OPTIONS.get(local ? "local" : binding.module);
      if (!options || entry.arguments.length !== 1) return null;
      const value = readData(entry.arguments[0], literals, paths);
      if (!plain(value) || !keysIn(value, options)) return null;
      if (local) {
        if (
          typeof value.tsPath !== "string" ||
          typeof value.mdPath !== "string" ||
          !projectPath(value.tsPath) ||
          !projectPath(value.mdPath) ||
          !/^(?:\.\/)?src\/(?:[\w-]+\/)+[\w-]+\.ts$/u.test(value.tsPath) ||
          !/^(?:\.\/)?docs\/(?:[\w-]+\/)*[\w-]+\.md$/u.test(value.mdPath) ||
          (value.footer !== undefined && typeof value.footer !== "string")
        )
          return null;
        outputFactories.push({
          ...binding,
          arguments: value,
          deferredLocalOutputs: [value.tsPath, value.mdPath],
        });
      } else {
        const destinations = [
          "proxiesFile",
          "directivesProxyFile",
          "directivesArrayFile",
          "outputDir",
        ];
        if (
          Object.entries(value).some(
            ([name, option]) =>
              destinations.includes(name) &&
              (typeof option !== "string" ||
                !projectPath(option) ||
                !/^(?:\.\/)?packages\//u.test(option)),
          )
        )
          return null;
        outputFactories.push({ ...binding, arguments: value });
      }
    }
  }
  return used.size === imports.size ? { stylePlugin, outputFactories, builtinOutputTargets } : null;
};

const jsoncFields = (name: string, text: string) => {
  if (text.length > 128 * 1024) return null;
  let parsed;
  try {
    parsed = name === "package.json" ? JSON.parse(text) : parseTsconfigJson(text);
  } catch {
    return null;
  }
  const program = parseSourceText({
    filename: name,
    sourceText: `const input = ${text}\n`,
    language: "js",
  });
  if (!plain(parsed) || !isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const [statement] = program.body;
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.declarations.length !== 1 ||
    !statement.declarations[0].init
  )
    return null;
  const ast = fields(statement.declarations[0].init);
  return ast ? { parsed, ast } : null;
};

export const readDeclaredStencilBuild = (
  packageText: string,
  tsconfigText: string,
  alternateEmitterPaths: readonly string[],
): { script: "build"; sourceDirectory: "src"; postBuildCleanup: boolean } | null => {
  if (alternateEmitterPaths.length) return null;
  const manifest = jsoncFields("package.json", packageText);
  const config = jsoncFields("tsconfig.json", tsconfigText);
  const scripts = manifest?.parsed.scripts;
  const scriptNode = manifest?.ast?.get("scripts");
  if (
    !plain(scripts) ||
    !scriptNode ||
    !fields(scriptNode) ||
    own(scripts, "prebuild") ||
    own(scripts, "postbuild")
  )
    return null;
  if (
    scripts.build !== "stencil build --prod" &&
    scripts.build !== "stencil build --prod && rm -f loader/package.json"
  )
    return null;
  for (const [name, source] of Object.entries(scripts)) {
    if (
      name.startsWith("build:") &&
      (name !== "build:packages" ||
        typeof source !== "string" ||
        source.replace(/\s+/gu, " ").trim() !==
          "npm run api:clear && npm run build && npm run api:update && npm run docs")
    )
      return null;
  }
  if (
    manifest &&
    ["babel", "browser", "imports", "overrides", "resolutions"].some((field) =>
      own(manifest.parsed, field),
    )
  )
    return null;
  const root = config?.parsed;
  const compilerNode = config?.ast?.get("compilerOptions");
  const opts = root?.compilerOptions;
  if (
    !root ||
    !compilerNode ||
    !fields(compilerNode) ||
    !plain(opts) ||
    own(root, "extends") ||
    own(root, "references") ||
    opts.jsx !== "react" ||
    opts.jsxFactory !== "h" ||
    opts.jsxFragmentFactory !== "Fragment" ||
    opts.experimentalDecorators !== true ||
    ["noEmit", "plugins", "jsxImportSource", "rootDirs"].some((field) => own(opts, field)) ||
    !Array.isArray(root.include) ||
    !root.include.includes("src") ||
    !root.include.every(
      (item) => item === "src" || (typeof item === "string" && /^[\w/-]+\.d\.ts$/u.test(item)),
    ) ||
    JSON.stringify(root.exclude) !== '["node_modules"]'
  )
    return null;
  if (opts.baseUrl !== undefined && opts.baseUrl !== "." && opts.baseUrl !== "./") return null;
  if (
    opts.paths !== undefined &&
    (!plain(opts.paths) ||
      !Object.entries(opts.paths).every(
        ([alias, target]) =>
          /^@[A-Za-z][\w-]*$/u.test(alias) &&
          Array.isArray(target) &&
          target.length === 1 &&
          typeof target[0] === "string" &&
          /^src\/[\w/-]+$/u.test(target[0]),
      ))
  )
    return null;
  return {
    script: "build",
    sourceDirectory: "src",
    postBuildCleanup: scripts.build !== "stencil build --prod",
  };
};

export const hasDirectStencilFactoryBinding = (
  node: EsTreeNode,
  name: "h" | "Fragment",
  scopes: ScopeAnalysis,
): boolean => {
  for (
    let scope: ReturnType<ScopeAnalysis["scopeFor"]> | null = scopes.scopeFor(node);
    scope;
    scope = scope.parent
  ) {
    const symbol = scope.symbolsByName.get(name);
    if (!symbol) continue;
    const specifier = symbol.declarationNode;
    const declaration = getImportDeclarationForSymbol(symbol);
    return (
      symbol.kind === "import" &&
      declaration?.source.value === "@stencil/core" &&
      declaration.importKind !== "type" &&
      !declaration.attributes?.length &&
      isNodeOfType(specifier, "ImportSpecifier") &&
      specifier.importKind !== "type" &&
      isNodeOfType(specifier.imported, "Identifier") &&
      specifier.imported.name === name
    );
  }
  return false;
};

const CONFIG_ENDINGS = ["js", "cjs", "mjs", "ts", "cts", "mts"];
const ALTERNATE_CONFIGS = [
  ...["vite.config", "webpack.config", "babel.config", "react.config"].flatMap((prefix) =>
    CONFIG_ENDINGS.map((extension) => prefix + "." + extension),
  ),
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
];
const physical = (filename: string, directory = false): boolean => {
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  return (
    !!stat &&
    (directory ? stat.isDirectory() : stat.isFile()) &&
    fs.realpathSync(filename) === filename
  );
};

function hasDisjointOutputPath(projectRoot: string, relative: string): boolean {
  const destination = path.resolve(projectRoot, relative);
  const relativeDestination = path.relative(projectRoot, destination);
  if (
    !relativeDestination ||
    relativeDestination.startsWith("..") ||
    path.isAbsolute(relativeDestination)
  )
    return false;
  const leaf = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (leaf && (!leaf.isFile() || leaf.nlink !== 1 || fs.realpathSync(destination) !== destination))
    return false;
  for (
    let directory = path.dirname(destination);
    directory !== projectRoot;
    directory = path.dirname(directory)
  ) {
    const info = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (info && (!info.isDirectory() || fs.realpathSync(directory) !== directory)) return false;
  }
  return true;
}

// Reads only the static compiler manifest/config bytes. Focal and possible
// alternate files are checked by metadata; the caller owns package and output
// provider selection, configuration dependencies, and source pragma checks.
export const readPhysicalStencilBuild = (input: { projectRoot: string; filename: string }) => {
  try {
    const { projectRoot, filename } = input;
    const relative = path.relative(projectRoot, filename).split(path.sep).join("/");
    if (
      !path.isAbsolute(projectRoot) ||
      !path.isAbsolute(filename) ||
      !physical(projectRoot, true) ||
      !/^src\/(?:[\w.-]+\/)*[\w.-]+\.tsx$/u.test(relative) ||
      !physical(filename)
    )
      return null;
    const exists = (name: string) => fs.lstatSync(name, { throwIfNoEntry: false }) !== undefined;
    const alternate: string[] = [];
    for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
      const names =
        directory === projectRoot
          ? [
              "jsconfig.json",
              ...CONFIG_ENDINGS.filter((ext) => ext !== "ts").map((ext) => "stencil.config." + ext),
            ]
          : [
              "package.json",
              "tsconfig.json",
              "jsconfig.json",
              ...CONFIG_ENDINGS.map((ext) => "stencil.config." + ext),
            ];
      for (const name of [...names, ...ALTERNATE_CONFIGS]) {
        const candidate = path.join(directory, name);
        if (exists(candidate)) alternate.push(candidate);
      }
      if (directory === projectRoot) break;
      if (directory === path.dirname(directory)) return null;
    }
    const names = ["package.json", "tsconfig.json", "stencil.config.ts"] as const;
    const [manifest, tsconfig, config] = names.map((name) => path.join(projectRoot, name));
    const read = (name: string) =>
      physical(name) && fs.statSync(name).size <= 128 * 1024 ? fs.readFileSync(name, "utf8") : null;
    const manifestText = read(manifest);
    const tsconfigText = read(tsconfig);
    const configText = read(config);
    if (manifestText === null || tsconfigText === null || configText === null) return null;
    const build = readDeclaredStencilBuild(manifestText, tsconfigText, alternate);
    const projection = readDeclaredStencilConfig(configText);
    const localOutputs = projection?.outputFactories.flatMap(
      (factory) => factory.deferredLocalOutputs ?? [],
    );
    return build &&
      projection &&
      localOutputs?.every((output) => hasDisjointOutputPath(projectRoot, output))
      ? { projectRoot, filename, manifest, tsconfig, config, build, projection }
      : null;
  } catch {
    return null;
  }
};
