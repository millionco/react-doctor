import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isPathInside } from "./is-path-inside.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTestlikeFilename } from "./is-testlike-filename.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceText } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { walkAst } from "./walk-ast.js";

const PACKAGE_PROVIDER_FIELDS = [
  "exports",
  "imports",
  "main",
  "module",
  "browser",
  "bin",
  "source",
  "react-native",
  "alias",
  "overrides",
  "resolutions",
  "pnpm",
  "babel",
];
const REGISTRY_DEPENDENCY = /^[~^]?\d+\.\d+\.\d+$/u;
const WORKSPACE_PATTERN = /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+(?:\/\*)?$/u;
const RENDERER_CONFIG_NAMES = [
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
  "babel.config.json",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  ".swcrc",
  "next.config.cjs",
  "next.config.ts",
  "next.config.cts",
  "next.config.mts",
  ".pnp.cjs",
  ".pnp.js",
  ".yarnrc",
  ".yarnrc.yml",
  ".npmrc",
];
const NEXT_JSX_PROVIDER_SPECIFIERS = [
  "next",
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];
const STOCK_JSX_MODES = new Set(["preserve", "react-jsx", "react-jsxdev"]);
const JSX_CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const JSX_OVERRIDE_OPTIONS = [
  "jsxFactory",
  "jsxFragmentFactory",
  "jsxImportSource",
  "reactNamespace",
  "customConditions",
];
const JSX_PROVIDER_PRAGMA = /@jsx(?:ImportSource|Runtime|Frag)?\b/u;

const readRegularText = (filePath: string): string | null => {
  recordContentProbe(filePath);
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && stat.size <= 512 * 1024 ? fs.readFileSync(filePath, "utf8") : null;
  } catch {
    return null;
  }
};

const existsOrOpaque = (filePath: string): boolean => {
  recordExistenceProbe(filePath);
  try {
    return fs.lstatSync(filePath, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
};

const isPrivateSourcePackage = (manifest: PackageManifest | null): manifest is PackageManifest =>
  !!manifest &&
  manifest.private === true &&
  !PACKAGE_PROVIDER_FIELDS.some((field) => Object.hasOwn(manifest, field));

const hasStockNextPackage = (manifest: PackageManifest): boolean =>
  manifest.scripts?.build === "next build" &&
  !Object.hasOwn(manifest.scripts, "prebuild") &&
  !Object.hasOwn(manifest.scripts, "postbuild") &&
  ["next", "react", "react-dom"].every((name) => {
    const specifier = manifest.dependencies?.[name];
    return typeof specifier === "string" && REGISTRY_DEPENDENCY.test(specifier);
  });

const readWorkspacePatterns = (filePath: string): string[] | null => {
  const text = readRegularText(filePath);
  if (text === null) return null;
  const [header, ...lines] = text.trimEnd().split(/\r?\n/u);
  if (header !== "packages:") return null;
  const patterns: string[] = [];
  for (const line of lines) {
    const match = /^ {2}- (?:"([^"]+)"|'([^']+)'|([^ ]+))$/u.exec(line);
    const pattern = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!pattern) return null;
    patterns.push(pattern);
  }
  return patterns;
};

const workspaceContainsApp = (patterns: readonly string[], app: string): boolean =>
  patterns.length > 0 &&
  patterns.every(
    (pattern) =>
      WORKSPACE_PATTERN.test(pattern) &&
      !pattern.split("/").some((segment) => segment === "." || segment === ".."),
  ) &&
  patterns.some((pattern) =>
    pattern.endsWith("/*")
      ? app.startsWith(pattern.slice(0, -1)) && !app.slice(pattern.length - 1).includes("/")
      : pattern === app,
  );

const findPrivateIndexRoot = (appDirectory: string): string | null => {
  let root = appDirectory;
  let directory = appDirectory;
  while (true) {
    const manifest = readPackageManifest(directory);
    const yaml = path.join(directory, "pnpm-workspace.yaml");
    const yml = path.join(directory, "pnpm-workspace.yml");
    const hasYaml = existsOrOpaque(yaml);
    const hasYml = existsOrOpaque(yml);
    if (manifest && PACKAGE_PROVIDER_FIELDS.some((field) => Object.hasOwn(manifest, field)))
      return null;
    if (hasYaml || hasYml || manifest?.workspaces !== undefined) {
      if (!isPrivateSourcePackage(manifest) || hasYml || root !== appDirectory) return null;
      if (directory === appDirectory) return null;
      const patterns = hasYaml ? readWorkspacePatterns(yaml) : manifest.workspaces;
      if (!Array.isArray(patterns) || !patterns.every((value) => typeof value === "string"))
        return null;
      const relativeApp = path.relative(directory, appDirectory).split(path.sep).join("/");
      if (!workspaceContainsApp(patterns, relativeApp)) return null;
      root = directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return root;
    directory = parent;
  }
};

const isTracedPathValue = (value: EsTreeNode): boolean => {
  if (
    !isNodeOfType(value, "MemberExpression") ||
    value.computed ||
    !isNodeOfType(value.property, "Identifier") ||
    value.property.name !== "pathname" ||
    !isNodeOfType(value.object, "NewExpression")
  )
    return false;
  const construction = value.object;
  const [source, issuer] = construction.arguments;
  return (
    construction.arguments.length === 2 &&
    isNodeOfType(construction.callee, "Identifier") &&
    construction.callee.name === "URL" &&
    isNodeOfType(source, "Literal") &&
    source.value === "../.." &&
    isNodeOfType(issuer, "MemberExpression") &&
    !issuer.computed &&
    isNodeOfType(issuer.object, "MetaProperty") &&
    issuer.object.meta.name === "import" &&
    issuer.object.property.name === "meta" &&
    isNodeOfType(issuer.property, "Identifier") &&
    issuer.property.name === "url"
  );
};

const readStockNextOptions = (configPath: string): EsTreeNode | null => {
  const text = readRegularText(configPath);
  if (text === null) return null;
  const program = parseSourceText({ filename: configPath, sourceText: text });
  if (!isNodeOfType(program, "Program")) return null;
  const [first, exported] = program.body;
  if (configPath.endsWith(".js")) {
    if (program.body.length !== 1 || !isNodeOfType(first, "ExpressionStatement")) return null;
    const assignment = first.expression;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !isNodeOfType(assignment.left, "MemberExpression") ||
      assignment.left.computed ||
      !isNodeOfType(assignment.left.object, "Identifier") ||
      assignment.left.object.name !== "module" ||
      !isNodeOfType(assignment.left.property, "Identifier") ||
      assignment.left.property.name !== "exports"
    )
      return null;
    return assignment.right;
  }
  if (
    program.body.length !== 2 ||
    !isNodeOfType(first, "VariableDeclaration") ||
    first.kind !== "const" ||
    first.declarations.length !== 1 ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  )
    return null;
  const [binding] = first.declarations;
  if (
    !binding ||
    !isNodeOfType(binding.id, "Identifier") ||
    !isNodeOfType(exported.declaration, "Identifier") ||
    binding.id.name !== exported.declaration.name
  )
    return null;
  return binding.init ?? null;
};

const hasStockNextCompilerConfig = (appDirectory: string, root: string): boolean => {
  let active: string | undefined;
  for (let current = appDirectory; ; current = path.dirname(current)) {
    if (RENDERER_CONFIG_NAMES.some((name) => existsOrOpaque(path.join(current, name))))
      return false;
    for (const name of ["next.config.mjs", "next.config.js"]) {
      const candidate = path.join(current, name);
      if (!existsOrOpaque(candidate)) continue;
      if (current !== appDirectory || active) return false;
      active = candidate;
    }
    if (path.resolve(current) === path.resolve(root)) break;
    if (path.dirname(current) === current) return false;
  }
  if (!active) return true;
  // An ESM package's .js config cannot use the CommonJS literal form.
  const manifest = readPackageManifest(appDirectory);
  if (active.endsWith(".js") && manifest && Reflect.get(manifest, "type") === "module")
    return false;
  const options = readStockNextOptions(active);
  if (!isNodeOfType(options, "ObjectExpression")) return false;
  const seen = new Set<string>();
  return options.properties.every((property) => {
    if (!isNodeOfType(property, "Property") || property.computed || property.kind !== "init")
      return false;
    const key = getStaticPropertyKeyName(property);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    switch (key) {
      case "output":
        return isNodeOfType(property.value, "Literal") && property.value.value === "standalone";
      case "reactStrictMode":
      case "typedRoutes":
        return isNodeOfType(property.value, "Literal") && typeof property.value.value === "boolean";
      case "outputFileTracingRoot":
        return isTracedPathValue(property.value);
      case "transpilePackages":
        return (
          isNodeOfType(property.value, "ArrayExpression") &&
          property.value.elements.every(
            (name) => isNodeOfType(name, "Literal") && typeof name.value === "string",
          )
        );
      default:
        return false;
    }
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const couldSelectProvider = (pattern: string, source: string): boolean => {
  const [prefix, suffix, ...additional] = pattern.split("*");
  if (prefix === undefined || additional.length > 0) return true;
  const matches = (candidate: string): boolean =>
    suffix === undefined
      ? prefix === candidate
      : candidate.startsWith(prefix) && candidate.endsWith(suffix);
  return matches(source);
};

const hasStockJsxCompilerOptions = (options: unknown): boolean => {
  if (options === undefined) return true;
  if (!isRecord(options) || JSX_OVERRIDE_OPTIONS.some((key) => Object.hasOwn(options, key)))
    return false;
  if (
    options.jsx !== undefined &&
    (typeof options.jsx !== "string" || !STOCK_JSX_MODES.has(options.jsx))
  )
    return false;
  if (
    options.plugins !== undefined &&
    (!Array.isArray(options.plugins) ||
      !options.plugins.every(
        (plugin) => isRecord(plugin) && plugin.name === "next" && Object.keys(plugin).length === 1,
      ))
  )
    return false;
  if (options.paths === undefined) return true;
  return (
    isRecord(options.paths) &&
    Object.keys(options.paths).every((pattern) =>
      NEXT_JSX_PROVIDER_SPECIFIERS.every((source) => !couldSelectProvider(pattern, source)),
    )
  );
};

const hasStockJsxConfigChain = (entry: string, root: string): boolean => {
  const seen = new Set<string>();
  for (let current = entry; ; ) {
    if (seen.has(current) || seen.size >= 16) return false;
    seen.add(current);
    const text = readRegularText(current);
    if (text === null) return false;
    const config = parseTsconfigJson(text);
    if (
      !config ||
      Object.hasOwn(config, "references") ||
      !hasStockJsxCompilerOptions(config.compilerOptions)
    )
      return false;
    if (!Object.hasOwn(config, "extends")) return true;
    const from = config.extends;
    if (typeof from !== "string" || !/^(?:\.\.?[/\\])/u.test(from)) return false;
    const filename = from.endsWith(".json") ? from : from + ".json";
    current = path.resolve(path.dirname(current), filename);
    if (
      !isPathInside(current, root) ||
      path.relative(root, current).split(path.sep).includes("node_modules")
    )
      return false;
  }
};

const hasStockJsxConfigs = (from: string, root: string): boolean => {
  for (let current = from; ; current = path.dirname(current)) {
    for (const name of JSX_CONFIG_NAMES) {
      const candidate = path.join(current, name);
      if (existsOrOpaque(candidate) && !hasStockJsxConfigChain(candidate, root)) return false;
    }
    if (path.resolve(current) === path.resolve(root)) return true;
    if (path.dirname(current) === current) return false;
  }
};

const isClosedDefaultComponent = (
  component: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (findExportedValue(program, "default") !== component) return false;
  const bindings = getFunctionBindingSymbols(component, scopes);
  const [binding] = bindings;
  return (
    bindings.length === 1 &&
    !!binding &&
    (binding.kind === "function" || binding.kind === "const") &&
    hasCompleteSymbolReferences(binding, program, scopes) &&
    binding.references.every(
      ({ flag, identifier }) =>
        flag === "read" &&
        isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
        identifier.parent.declaration === identifier,
    )
  );
};

const countEligibleConsumerOpenings = (
  consumer: SourceProjectModule,
  index: SourceProjectIndex,
  sourcePath: string,
  propName: string,
  root: string,
): number => {
  let openingCount = 0;
  let invalid = false;
  const { programNode, scopes, filePath } = consumer;
  const text = readRegularText(filePath);
  if (
    text === null ||
    JSX_PROVIDER_PRAGMA.test(text) ||
    !hasStockJsxConfigs(path.dirname(filePath), root) ||
    NEXT_JSX_PROVIDER_SPECIFIERS.some((specifier) => resolveModulePath(filePath, specifier))
  )
    return -1;
  walkAst(programNode, (node) => {
    if (invalid) return false;
    if (index.resolvedSourcePathByNode.get(node) !== sourcePath) return;
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      node.specifiers.length !== 1 ||
      !isNodeOfType(node.specifiers[0], "ImportDefaultSpecifier")
    ) {
      invalid = true;
      return false;
    }
    const local = node.specifiers[0].local;
    const symbol = scopes.symbolFor(local);
    if (!symbol || !hasCompleteSymbolReferences(symbol, programNode, scopes)) {
      invalid = true;
      return false;
    }
    for (const { flag, identifier } of symbol.references) {
      const parent = identifier.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(parent, "JSXOpeningElement") &&
          !isNodeOfType(parent, "JSXClosingElement")) ||
        parent.name !== identifier
      ) {
        invalid = true;
        break;
      }
      if (isNodeOfType(parent, "JSXClosingElement")) continue;
      if (
        parent.attributes.some(
          (attribute) =>
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            attribute.name.name === propName,
        )
      ) {
        invalid = true;
        break;
      }
      openingCount++;
    }
  });
  return invalid ? -1 : openingCount;
};

const GLOBAL_CARRIERS = new Set(["globalThis", "window", "self", "global"]);
const OPAQUE_GLOBAL_MEMBERS = new Set([
  ...GLOBAL_CARRIERS,
  "eval",
  "Function",
  "require",
  "System",
  "SystemJS",
  "importScripts",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const DATA_STORAGE_MEMBERS = new Set(["localStorage", "sessionStorage"]);
const DATA_DESCRIPTOR_FLAGS = new Set(["configurable", "enumerable", "writable"]);

const getStaticDirectMember = (receiver: EsTreeNode) => {
  const member = receiver.parent;
  return isNodeOfType(member, "MemberExpression") &&
    member.object === receiver &&
    !member.computed &&
    isNodeOfType(member.property, "Identifier")
    ? { member, name: member.property.name }
    : null;
};

const getDirectMethodCall = (receiver: EsTreeNode, name: string) => {
  const access = getStaticDirectMember(receiver);
  if (access?.name !== name || access.member.optional) return null;
  const callee = findTransparentExpressionRoot(access.member);
  const call = callee.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === callee && !call.optional
    ? call
    : null;
};

const hasOrdinaryGlobalMember = (receiver: EsTreeNode): boolean => {
  const access = getStaticDirectMember(receiver);
  return !!access && !OPAQUE_GLOBAL_MEMBERS.has(access.name);
};

const hasMemberOnlyGlobalAlias = (
  receiver: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declarator = receiver.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== receiver ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  return (
    !!symbol &&
    symbol.kind === "const" &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      ({ flag, identifier }) =>
        flag === "read" && hasOrdinaryGlobalMember(findTransparentExpressionRoot(identifier)),
    )
  );
};

const isStorageDataDescriptor = (descriptor: EsTreeNode | undefined): boolean => {
  if (!isNodeOfType(descriptor, "ObjectExpression")) return false;
  const seen = new Set<string>();
  for (const property of descriptor.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (key === "value") continue;
    if (
      !DATA_DESCRIPTOR_FLAGS.has(key) ||
      !isNodeOfType(property.value, "Literal") ||
      typeof property.value.value !== "boolean"
    )
      return false;
  }
  return seen.has("value");
};

const isKnownGlobalMethodArgument = (
  receiver: EsTreeNode,
  filePath: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const call = receiver.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments[0] !== receiver ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    !isNodeOfType(call.callee.property, "Identifier")
  )
    return false;
  const [, property, descriptor] = call.arguments;
  if (!isNodeOfType(property, "Literal") || typeof property.value !== "string") return false;
  const { object, property: method } = call.callee;
  if (
    object.name === "Object" &&
    method.name === "defineProperty" &&
    scopes.isGlobalReference(object)
  )
    return (
      call.arguments.length === 3 &&
      DATA_STORAGE_MEMBERS.has(property.value) &&
      isStorageDataDescriptor(descriptor)
    );
  if (
    method.name !== "spyOn" ||
    call.arguments.length !== 2 ||
    property.value !== "clearTimeout" ||
    !isTestlikeFilename(filePath)
  )
    return false;
  const imported = resolveImportedApiReference(object, scopes);
  const symbol = scopes.symbolFor(object);
  return (
    imported?.source === "vitest" &&
    imported.importedName === "vi" &&
    !!symbol &&
    symbol.kind === "import" &&
    resolveModulePath(filePath, "vitest") === null &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      ({ flag, identifier }) =>
        flag === "read" &&
        getDirectMethodCall(findTransparentExpressionRoot(identifier), "spyOn") !== null,
    )
  );
};

const isBoundedGlobalCarrierUse = (
  node: EsTreeNode,
  filePath: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const receiver = findTransparentExpressionRoot(node);
  const use = receiver.parent;
  if (isNodeOfType(use, "UnaryExpression") && use.operator === "typeof") return true;
  if (hasOrdinaryGlobalMember(receiver)) return true;
  if (
    isNodeOfType(use, "BinaryExpression") &&
    use.operator === "in" &&
    use.right === receiver &&
    isNodeOfType(use.left, "Literal") &&
    typeof use.left.value === "string"
  )
    return !OPAQUE_GLOBAL_MEMBERS.has(use.left.value);
  if (
    isNodeOfType(use, "LogicalExpression") &&
    (use.operator === "??" || use.operator === "||") &&
    (use.left === receiver || use.right === receiver)
  ) {
    const call = getDirectMethodCall(findTransparentExpressionRoot(use), "dispatchEvent");
    return (
      !!call && call.arguments.length === 1 && !isNodeOfType(call.arguments[0], "SpreadElement")
    );
  }
  return (
    hasMemberOnlyGlobalAlias(receiver, program, scopes) ||
    isKnownGlobalMethodArgument(receiver, filePath, program, scopes)
  );
};

const hasOpaqueCodeEvaluation = ({
  programNode,
  scopes,
  filePath,
}: SourceProjectModule): boolean => {
  let invalid = false;
  walkAst(programNode, (node) => {
    if (invalid) return false;
    if (isNodeOfType(node, "WithStatement")) {
      invalid = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (
      node.name === "eval" ||
      node.name === "Function" ||
      (GLOBAL_CARRIERS.has(node.name) &&
        !isBoundedGlobalCarrierUse(node, filePath, programNode, scopes))
    ) {
      invalid = true;
      return false;
    }
  });
  return invalid;
};

// Called by the rule and its cache probe collector under the same Next/React
// renderer premise. This examines the runtime source graph, never the app.
export const isPropOmittedByPrivateJsxConsumers = (
  component: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
  propName: string,
): boolean => {
  // JSX body content can supply children without a JSX attribute.
  if (propName === "children" || !filename || !path.isAbsolute(filename)) return false;
  const program = findProgramRoot(component);
  if (!program || !isClosedDefaultComponent(component, program, scopes)) return false;
  const appDirectory = findNearestPackageDirectory(filename);
  // Next owns entry points in these trees and can render a default export
  // independently of its source-visible JSX consumers.
  if (
    !appDirectory ||
    ["app", "pages", "src/app", "src/pages"].some((directory) =>
      isPathInside(filename, path.join(appDirectory, directory)),
    )
  )
    return false;
  const manifest = readPackageManifest(appDirectory);
  if (!isPrivateSourcePackage(manifest) || !hasStockNextPackage(manifest)) return false;
  const root = findPrivateIndexRoot(appDirectory);
  if (
    !root ||
    !hasStockNextCompilerConfig(appDirectory, root) ||
    !hasStockJsxConfigs(path.dirname(filename), root)
  )
    return false;
  const sourcePath = normalizeFilename(path.resolve(filename));
  const index = buildSourceProjectIndex({
    rootDirectory: root,
    currentFilePath: sourcePath,
    currentProgramNode: program,
    currentScopes: scopes,
    includeTestlikeSources: true,
    javascriptAllowsJsx: true,
    includeGeneratedSourcesUnder: path.join(appDirectory, "app"),
  });
  if (
    !index ||
    !index.modulesByFilePath.has(sourcePath) ||
    index.hasOpaqueRuntimeConsumerSurface ||
    index.hasOpaqueMdxConsumerSurface ||
    [...index.modulesByFilePath.values()].some(hasOpaqueCodeEvaluation)
  )
    return false;
  for (const source of index.unresolvedRuntimeSources) {
    if (
      source.startsWith(".") ||
      source.startsWith("file:") ||
      source.startsWith("data:") ||
      path.isAbsolute(source) ||
      /[?#]/u.test(source) ||
      (typeof manifest.name === "string" &&
        (source === manifest.name || source.startsWith(manifest.name + "/")))
    )
      return false;
  }
  const consumers = index.consumerModulesByFilePath.get(sourcePath);
  if (!consumers || consumers.size === 0) return false;
  let openingCount = 0;
  for (const consumer of consumers) {
    // Other workspace packages are included to find incoming edges. Their
    // own renderer and compiler options are outside this app's certificate.
    if (consumer.filePath === sourcePath || !isPathInside(consumer.filePath, appDirectory))
      return false;
    const consumerPackage = findNearestPackageDirectory(consumer.filePath);
    if (!consumerPackage || path.resolve(consumerPackage) !== path.resolve(appDirectory))
      return false;
    const found = countEligibleConsumerOpenings(consumer, index, sourcePath, propName, root);
    if (found < 0) return false;
    openingCount += found;
  }
  return openingCount > 0;
};
