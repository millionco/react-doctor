import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

const IMPORTS = new Set([
  "node:module:builtinModules",
  "node:path:dirname",
  "node:path:resolve",
  "node:url:fileURLToPath",
  "vite:defineConfig",
  "@vitejs/plugin-react:default",
  "vite-plugin-css-injected-by-js:default",
]);
const UNSAFE_KEY = new Set(["__proto__", "constructor", "prototype"]);

const readFields = (node: EsTreeNode | null | undefined, names: readonly string[]) => {
  if (!isNodeOfType(node, "ObjectExpression") || node.properties.length !== names.length)
    return null;
  const fields = new Map<string, EsTreeNode>();
  const expected = new Set(names);
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || UNSAFE_KEY.has(name) || fields.has(name) || !expected.has(name)) return null;
    fields.set(name, property.value);
  }
  return fields;
};

const literal = (node: EsTreeNode | null | undefined) =>
  isNodeOfType(node, "Literal") ? node.value : undefined;

const call = (node: EsTreeNode | null | undefined, count: number) =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  !node.typeArguments &&
  node.arguments.length === count &&
  node.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? node
    : null;

const member = (node: EsTreeNode | null | undefined, name: string) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name
    ? node.object
    : null;

const binding = (node: EsTreeNode | undefined) => {
  if (
    !isNodeOfType(node, "VariableDeclaration") ||
    node.kind !== "const" ||
    node.declarations.length !== 1
  )
    return null;
  const [declaration] = node.declarations;
  return isNodeOfType(declaration.id, "Identifier") && declaration.init
    ? { name: declaration.id, value: declaration.init }
    : null;
};

const arrow = (node: EsTreeNode | null | undefined, count: number) =>
  isNodeOfType(node, "ArrowFunctionExpression") &&
  !node.async &&
  !node.typeParameters &&
  !node.returnType &&
  node.params.length === count
    ? node
    : null;

const stringList = (node: EsTreeNode | null | undefined): string[] | null => {
  if (!isNodeOfType(node, "ArrayExpression")) return null;
  const values = node.elements.map(literal);
  return values.every((value): value is string => typeof value === "string") ? values : null;
};

export interface DeclaredVite8KeyboardLibrary {
  readonly entry: string;
  readonly outDirectory: string;
  readonly outputFileName: string;
}

export const readDeclaredVite8KeyboardLibrary = (
  filename: string,
  sourceText: string,
): DeclaredVite8KeyboardLibrary | null => {
  const program = parseSourceText({ filename, sourceText });
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return null;
  const scopes = analyzeScopes(program);
  const roles = new Map<string, EsTreeNode>();
  let cursor = 0;
  while (isNodeOfType(program.body[cursor], "ImportDeclaration")) {
    const statement = program.body[cursor++];
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      statement.attributes.length !== 0 ||
      statement.specifiers.length === 0
    )
      return null;
    for (const specifier of statement.specifiers) {
      const imported = isNodeOfType(specifier, "ImportDefaultSpecifier")
        ? "default"
        : isNodeOfType(specifier, "ImportSpecifier") &&
            specifier.importKind !== "type" &&
            isNodeOfType(specifier.imported, "Identifier")
          ? specifier.imported.name
          : null;
      const role = String(statement.source.value) + ":" + imported;
      if (!imported || !IMPORTS.has(role) || roles.has(role)) return null;
      roles.set(role, specifier.local);
    }
  }
  if (roles.size !== IMPORTS.size || program.body.length - cursor !== 6) return null;
  const [urlNode, directoryNode, builtinsNode, bannerNode, externalNode, exportNode] =
    program.body.slice(cursor);
  const url = binding(urlNode);
  const directory = binding(directoryNode);
  const builtins = binding(builtinsNode);
  const banner = binding(bannerNode);
  const external = binding(externalNode);
  if (!url || !directory || !builtins || !banner || !external) return null;

  const same = (reference: EsTreeNode | null | undefined, declaration: EsTreeNode | undefined) => {
    const symbol = declaration && scopes.symbolFor(declaration);
    return Boolean(
      symbol && isNodeOfType(reference, "Identifier") && scopes.symbolFor(reference) === symbol,
    );
  };
  const imported = (reference: EsTreeNode | null | undefined, role: string) =>
    same(reference, roles.get(role));
  const global = (node: EsTreeNode | null | undefined, name: string) =>
    isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

  const fileUrl = call(url.value, 1);
  const importMeta = member(fileUrl?.arguments[0], "url");
  const dirname = call(directory.value, 1);
  if (
    !fileUrl ||
    !imported(fileUrl.callee, "node:url:fileURLToPath") ||
    !isNodeOfType(importMeta, "MetaProperty") ||
    importMeta.meta.name !== "import" ||
    importMeta.property.name !== "meta" ||
    !dirname ||
    !imported(dirname.callee, "node:path:dirname") ||
    !same(dirname.arguments[0], url.name)
  )
    return null;

  const set = builtins.value;
  const source = isNodeOfType(set, "NewExpression") ? set.arguments[0] : null;
  if (
    !isNodeOfType(set, "NewExpression") ||
    !global(set.callee, "Set") ||
    set.arguments.length !== 1 ||
    !isNodeOfType(source, "ArrayExpression")
  )
    return null;
  const builtinElements = source.elements;
  if (builtinElements.length !== 2) return null;
  const [plain, namespaced] = builtinElements;
  const namespacedMap = isNodeOfType(namespaced, "SpreadElement") && call(namespaced.argument, 1);
  const prefix = namespacedMap && arrow(namespacedMap.arguments[0], 1);
  if (
    !isNodeOfType(plain, "SpreadElement") ||
    !imported(plain.argument, "node:module:builtinModules") ||
    !namespacedMap ||
    !imported(member(namespacedMap.callee, "map"), "node:module:builtinModules") ||
    !prefix ||
    !isNodeOfType(prefix.params[0], "Identifier") ||
    !isNodeOfType(prefix.body, "TemplateLiteral") ||
    prefix.body.quasis.length !== 2 ||
    prefix.body.quasis[0].value.cooked !== "node:" ||
    prefix.body.quasis[1].value.cooked !== "" ||
    prefix.body.expressions.length !== 1 ||
    !same(prefix.body.expressions[0], prefix.params[0])
  )
    return null;

  const checkExternal = arrow(external.value, 1);
  const checkSet = checkExternal && call(checkExternal.body, 1);
  const joinedBanner = call(banner.value, 1);
  if (
    !checkExternal ||
    !isNodeOfType(checkExternal.params[0], "Identifier") ||
    !checkSet ||
    !same(member(checkSet.callee, "has"), builtins.name) ||
    !same(checkSet.arguments[0], checkExternal.params[0]) ||
    !joinedBanner ||
    literal(joinedBanner.arguments[0]) !== "\n" ||
    !stringList(member(joinedBanner.callee, "join"))
  )
    return null;

  const config =
    isNodeOfType(exportNode, "ExportDefaultDeclaration") && call(exportNode.declaration, 1);
  const pick = config && arrow(config.arguments[0], 1);
  if (
    !config ||
    !imported(config.callee, "vite:defineConfig") ||
    !pick ||
    !isNodeOfType(pick.params[0], "ObjectPattern") ||
    pick.params[0].properties.length !== 1 ||
    !isNodeOfType(pick.body, "BlockStatement") ||
    pick.body.body.length !== 1 ||
    !isNodeOfType(pick.body.body[0], "ReturnStatement")
  )
    return null;
  const [mode] = pick.params[0].properties;
  if (
    !isNodeOfType(mode, "Property") ||
    mode.computed ||
    getStaticPropertyKeyName(mode) !== "mode" ||
    !isNodeOfType(mode.value, "Identifier")
  )
    return null;

  const settings = readFields(pick.body.body[0].argument, [
    "base",
    "define",
    "plugins",
    "build",
    "optimizeDeps",
    "worker",
  ]);
  const define = readFields(settings?.get("define"), ["process.env.NODE_ENV"]);
  const stringify = call(define?.get("process.env.NODE_ENV"), 1);
  const plugins = settings?.get("plugins");
  if (
    !settings ||
    literal(settings.get("base")) !== "./" ||
    !stringify ||
    !global(member(stringify.callee, "stringify"), "JSON") ||
    !same(stringify.arguments[0], mode.value) ||
    !isNodeOfType(plugins, "ArrayExpression") ||
    plugins.elements.length !== 2 ||
    !imported(call(plugins.elements[0], 0)?.callee, "@vitejs/plugin-react:default") ||
    !imported(call(plugins.elements[1], 0)?.callee, "vite-plugin-css-injected-by-js:default")
  )
    return null;

  const build = readFields(settings.get("build"), [
    "lib",
    "minify",
    "outDir",
    "rollupOptions",
    "sourcemap",
    "target",
  ]);
  const lib = readFields(build?.get("lib"), ["entry", "fileName", "formats"]);
  const outputFileName = literal(lib?.get("fileName"));
  const outDirectory = literal(build?.get("outDir"));
  const entryCall = call(lib?.get("entry"), 2);
  const entry = literal(entryCall?.arguments[1]);
  const formats = stringList(lib?.get("formats"));
  const buildRollup = readFields(build?.get("rollupOptions"), ["external"]);
  if (
    !build ||
    literal(build.get("minify")) !== false ||
    literal(build.get("sourcemap")) !== true ||
    literal(build.get("target")) !== "es2020" ||
    typeof outDirectory !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(outDirectory) ||
    typeof outputFileName !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(outputFileName) ||
    !entryCall ||
    !imported(entryCall.callee, "node:path:resolve") ||
    !same(entryCall.arguments[0], directory.name) ||
    typeof entry !== "string" ||
    !/^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.tsx?$/u.test(entry) ||
    formats?.length !== 1 ||
    formats[0] !== "es" ||
    !same(buildRollup?.get("external"), external.name)
  )
    return null;

  const optimize = readFields(settings.get("optimizeDeps"), ["include", "exclude"]);
  const worker = readFields(settings.get("worker"), ["format", "rollupOptions"]);
  const workerRollup = readFields(worker?.get("rollupOptions"), ["output"]);
  const workerOutput = readFields(workerRollup?.get("output"), ["banner"]);
  if (
    !stringList(optimize?.get("include")) ||
    !stringList(optimize?.get("exclude")) ||
    literal(worker?.get("format")) !== "es" ||
    !same(workerOutput?.get("banner"), banner.name)
  )
    return null;
  // The literal banner is carried only into the separate worker output.
  return { entry, outDirectory, outputFileName };
};
