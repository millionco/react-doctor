import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";

const BUILD_CONFIG = "tsup.config.ts";

const PLUGIN_OPTIONS = new Set([
  "entry",
  "format",
  "dts",
  "sourcemap",
  "clean",
  "splitting",
  "target",
  "external",
  "loader",
  "onSuccess",
]);
const IMPORT_ROLES = new Map([
  ["node:fs:readFileSync", "read"],
  ["node:fs:writeFileSync", "write"],
  ["node:path:join", "join"],
  ["esbuild:*", "esbuild"],
  ["tsup:defineConfig", "define"],
]);
const CLASHING_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const literal = (node: EsTreeNode | undefined): unknown =>
  isNodeOfType(node, "Literal") ? node.value : undefined;

const fields = (node: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const key = isNodeOfType(property.key, "Identifier")
      ? property.key.name
      : literal(property.key);
    if (typeof key !== "string" || CLASHING_KEYS.has(key) || result.has(key)) return null;
    result.set(key, property.value);
  }
  return result;
};

const call = (node: EsTreeNode | undefined, count: number) =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  !node.typeArguments &&
  node.arguments.length === count &&
  node.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? node
    : null;

const constPair = (node: EsTreeNode) => {
  if (
    !isNodeOfType(node, "VariableDeclaration") ||
    node.kind !== "const" ||
    node.declarations.length !== 1
  ) {
    return null;
  }
  const declaration = node.declarations[0];
  return isNodeOfType(declaration.id, "Identifier") &&
    declaration.init &&
    !declaration.id.typeAnnotation
    ? { binding: declaration.id, value: declaration.init }
    : null;
};

const member = (node: EsTreeNode | undefined, name: string) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name
    ? node.object
    : null;

const identifierIs = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(symbol && isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol);

interface BoundedCssOutput {
  readonly inputPath: string;
  readonly outputPath: string;
}

const readBoundedCssOutput = (
  handler: EsTreeNode | undefined,
  roles: ReadonlyMap<string, SymbolDescriptor>,
  scopes: ScopeAnalysis,
): BoundedCssOutput | null => {
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    !handler.async ||
    handler.params.length !== 0 ||
    handler.returnType ||
    !isNodeOfType(handler.body, "BlockStatement") ||
    handler.body.body.length !== 4
  )
    return null;
  const [cwdStatement, inputStatement, transformedStatement, writeStatement] = handler.body.body;
  const cwd = constPair(cwdStatement);
  const input = constPair(inputStatement);
  const transformed = constPair(transformedStatement);
  if (!cwd || !input || !transformed || !isNodeOfType(writeStatement, "ExpressionStatement"))
    return null;

  const currentDirectory = call(cwd.value, 0);
  const processIdentifier = currentDirectory && member(currentDirectory.callee, "cwd");
  if (
    !isNodeOfType(processIdentifier, "Identifier") ||
    processIdentifier.name !== "process" ||
    !scopes.isGlobalReference(processIdentifier)
  )
    return null;

  const relativeToCwd = (node: EsTreeNode): string | null => {
    const join = call(node, 2);
    if (
      !join ||
      !identifierIs(join.callee, roles.get("join"), scopes) ||
      !identifierIs(join.arguments[0], scopes.symbolFor(cwd.binding) ?? undefined, scopes)
    )
      return null;
    const location = literal(join.arguments[1]);
    return typeof location === "string" ? location : null;
  };
  const read = call(input.value, 2);
  if (
    !read ||
    !identifierIs(read.callee, roles.get("read"), scopes) ||
    literal(read.arguments[1]) !== "utf8"
  ) {
    return null;
  }
  const inputPath = relativeToCwd(read.arguments[0]);
  if (!inputPath || !/^src\/(?:[\w-]+\/)*[\w.-]+\.css$/u.test(inputPath)) return null;

  const transform = isNodeOfType(transformed.value, "AwaitExpression")
    ? call(transformed.value.argument, 2)
    : null;
  if (
    !transform ||
    !identifierIs(member(transform.callee, "transform"), roles.get("esbuild"), scopes) ||
    !identifierIs(transform.arguments[0], scopes.symbolFor(input.binding) ?? undefined, scopes)
  )
    return null;
  const options = fields(transform.arguments[1]);
  if (
    options?.size !== 2 ||
    literal(options.get("loader")) !== "css" ||
    literal(options.get("minify")) !== true
  ) {
    return null;
  }

  const write = call(writeStatement.expression, 3);
  if (
    !write ||
    !identifierIs(write.callee, roles.get("write"), scopes) ||
    !identifierIs(
      member(write.arguments[1], "code"),
      scopes.symbolFor(transformed.binding) ?? undefined,
      scopes,
    ) ||
    literal(write.arguments[2]) !== "utf8"
  )
    return null;
  const outputPath = relativeToCwd(write.arguments[0]);
  return outputPath && /^dist\/[\w.-]+\.css$/u.test(outputPath) ? { inputPath, outputPath } : null;
};

interface DeclaredTsupConfig {
  readonly indexEntry: string;
  readonly stylesEntry: string;
  readonly css: BoundedCssOutput;
}

const readSourceEntry = (node: EsTreeNode | undefined): string | null => {
  const value = literal(node);
  return typeof value === "string" &&
    /^src\/(?:[\w-]+\/)*[\w.-]+\.ts$/u.test(value) &&
    !value.endsWith(".d.ts")
    ? value
    : null;
};

// Static declaration and output contract only. No project config is evaluated.
export const readDeclaredTsupConfig = (sourceText: string): DeclaredTsupConfig | null => {
  const program = parseSourceText({ filename: BUILD_CONFIG, sourceText });
  if (!isNodeOfType(program, "Program") || program.body.length !== 5) return null;
  const scopes = analyzeScopes(program);
  const roles = new Map<string, SymbolDescriptor>();
  const [fsImport, pathImport, esbuildImport, tsupImport, exported] = program.body;
  for (const statement of [fsImport, pathImport, esbuildImport, tsupImport]) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      statement.specifiers.length === 0 ||
      statement.attributes?.length
    )
      return null;
    for (const specifier of statement.specifiers) {
      const name = isNodeOfType(specifier, "ImportNamespaceSpecifier")
        ? "*"
        : isNodeOfType(specifier, "ImportSpecifier") &&
            specifier.importKind !== "type" &&
            isNodeOfType(specifier.imported, "Identifier")
          ? specifier.imported.name
          : null;
      if (typeof statement.source.value !== "string" || !name) return null;
      const role = IMPORT_ROLES.get(`${statement.source.value}:${name}`);
      const symbol = scopes.symbolFor(specifier.local);
      if (!role || !symbol || symbol.kind !== "import" || roles.has(role)) return null;
      roles.set(role, symbol);
    }
  }
  if (roles.size !== IMPORT_ROLES.size || !isNodeOfType(exported, "ExportDefaultDeclaration"))
    return null;

  const define = call(exported.declaration, 1);
  if (!define || !identifierIs(define.callee, roles.get("define"), scopes)) return null;
  const config = fields(define.arguments[0]);
  if (
    config?.size !== PLUGIN_OPTIONS.size ||
    ![...config.keys()].every((option) => PLUGIN_OPTIONS.has(option)) ||
    literal(config.get("target")) !== "es2022" ||
    !["dts", "sourcemap", "clean", "splitting"].every(
      (option) => literal(config.get(option)) === true,
    )
  )
    return null;
  const entry = fields(config.get("entry"));
  if (entry?.size !== 2) return null;
  const indexEntry = readSourceEntry(entry.get("index"));
  const stylesEntry = readSourceEntry(entry.get("styles"));
  if (!indexEntry || !stylesEntry || indexEntry === stylesEntry) return null;
  const format = config.get("format");
  if (
    !isNodeOfType(format, "ArrayExpression") ||
    format.elements.length !== 1 ||
    literal(format.elements[0] ?? undefined) !== "esm"
  ) {
    return null;
  }
  const external = config.get("external");
  if (!isNodeOfType(external, "ArrayExpression")) return null;
  const packages = new Set<string>();
  for (const element of external.elements) {
    const name = literal(element ?? undefined);
    if (
      typeof name !== "string" ||
      !/^(?:@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/u.test(name) ||
      packages.has(name)
    ) {
      return null;
    }
    packages.add(name);
  }
  const loaders = fields(config.get("loader"));
  const css = readBoundedCssOutput(config.get("onSuccess"), roles, scopes);
  return packages.has("react") &&
    packages.has("react-dom") &&
    loaders?.size === 1 &&
    literal(loaders.get(".css")) === "copy" &&
    css
    ? { indexEntry, stylesEntry, css }
    : null;
};

const ownRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const packageSelectsBuild = (sourceText: string): boolean => {
  const manifest = ownRecord(JSON.parse(sourceText));
  if (
    !manifest ||
    manifest.type !== "module" ||
    manifest.main !== "./dist/index.js" ||
    manifest.module !== manifest.main ||
    ["browser", "imports", "workspaces", "tsup", "alias", "postcss"].some((name) =>
      Object.hasOwn(manifest, name),
    )
  ) {
    return false;
  }
  const scripts = ownRecord(manifest.scripts);
  const exports = ownRecord(manifest.exports);
  const index = ownRecord(exports?.["."]);
  return Boolean(
    scripts &&
    scripts.build === "tsup --config tsup.config.ts" &&
    !Object.hasOwn(scripts, "prebuild") &&
    !Object.hasOwn(scripts, "postbuild") &&
    index &&
    Object.keys(index).length === 2 &&
    index.import === manifest.main &&
    index.types === "./dist/index.d.ts",
  );
};

const TSCONFIG_BOOLEAN_OPTIONS = new Set([
  "declaration",
  "declarationMap",
  "sourceMap",
  "esModuleInterop",
  "forceConsistentCasingInFileNames",
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "noUnusedLocals",
  "noUnusedParameters",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "skipLibCheck",
]);
const TSCONFIG_STRING_OPTIONS = new Map([
  ["target", "es2022"],
  ["jsx", "react-jsx"],
  ["module", "ESNext"],
  ["moduleResolution", "Node"],
  ["rootDir", "src"],
  ["outDir", "dist"],
]);

const tsconfigDoesNotRedirect = (sourceText: string): boolean => {
  const config = ownRecord(parseTsconfigJson(sourceText));
  const options = ownRecord(config?.compilerOptions);
  const include = config?.include;
  if (
    !config ||
    Object.keys(config).length !== 2 ||
    !Array.isArray(include) ||
    include.length !== 1 ||
    include[0] !== "src" ||
    !options ||
    options.jsx !== "react-jsx"
  )
    return false;
  return Object.entries(options).every(([key, value]) =>
    TSCONFIG_BOOLEAN_OPTIONS.has(key)
      ? typeof value === "boolean"
      : key === "lib"
        ? Array.isArray(value) &&
          value.every((entry) => ["es2022", "dom", "dom.iterable"].includes(entry))
        : typeof value === "string" && TSCONFIG_STRING_OPTIONS.get(key) === value,
  );
};

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};
const physicalRealpath = (filename: string): string => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename);
};
const isPhysicalFile = (filename: string): boolean => {
  const info = stat(filename);
  return Boolean(info?.isFile() && info.nlink === 1 && physicalRealpath(filename) === filename);
};
const isPhysicalDirectory = (filename: string): boolean =>
  Boolean(stat(filename)?.isDirectory() && physicalRealpath(filename) === filename);

const readFile = (filename: string): string | null => {
  recordContentProbe(filename);
  const before = stat(filename);
  if (
    !before?.isFile() ||
    before.nlink !== 1 ||
    before.size > 256 * 1024 ||
    physicalRealpath(filename) !== filename
  )
    return null;
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const unchanged = (current: fs.Stats | undefined): boolean =>
      current?.isFile() === true &&
      current.nlink === before.nlink &&
      current.ino === before.ino &&
      current.dev === before.dev &&
      current.ctimeMs === before.ctimeMs &&
      current.mtimeMs === before.mtimeMs &&
      current.size === before.size;
    if (!unchanged(fs.fstatSync(descriptor))) return null;
    const buffer = Buffer.alloc(before.size);
    if (fs.readSync(descriptor, buffer, 0, buffer.length, 0) !== before.size) return null;
    return unchanged(fs.fstatSync(descriptor)) && unchanged(stat(filename))
      ? buffer.toString("utf8")
      : null;
  } finally {
    fs.closeSync(descriptor);
  }
};

const insideSource = (root: string, candidate: string): boolean =>
  path.isAbsolute(candidate) &&
  /^src\/(?:[\w.-]+\/)*[\w.-]+$/u.test(path.relative(root, candidate));

// Reject every alternate loader candidate; this is deliberately stricter than
// modelling the esbuild extension order or directory-index selection.
const resolveUniqueSourceFile = (
  root: string,
  importer: string,
  specifier: string,
): string | null => {
  if (!/^(?:\.\/|\.\.\/)+(?:[\w.-]+\/)*[\w.-]+$/u.test(specifier)) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  if (!insideSource(root, base)) return null;
  const extensions = [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".css",
    ".json",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
  ];
  const candidates = [base, ...extensions.map((extension) => base + extension)].filter(
    (candidate) => stat(candidate),
  );
  return candidates.length === 1 && isPhysicalFile(candidates[0]) ? candidates[0] : null;
};

// Stock tsup calls postcss-load-config from cwd on every CSS module, even with
// the "copy" loader. No alternative PostCSS config may execute on this route.
const POSTCSS_CONFIG_CANDIDATES = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ...["ts", "cts", "mts", "js", "cjs", "mjs"].flatMap((extension) => [
    `.postcssrc.${extension}`,
    `postcss.config.${extension}`,
  ]),
];
const hasNoPostcssConfiguration = (root: string): boolean => {
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (POSTCSS_CONFIG_CANDIDATES.some((name) => stat(path.join(directory, name)))) return false;
    if (directory !== root && stat(path.join(directory, "package.json"))) return false;
    if (path.dirname(directory) === directory) return true;
  }
};

const SOURCE_DIRECTORY_ALTERNATES = ["package.json", "tsconfig.json", "jsconfig.json"];
const hasCleanSourceAncestors = (root: string, filename: string): boolean => {
  for (let current = path.dirname(filename); current !== root; current = path.dirname(current)) {
    if (
      !isPhysicalDirectory(current) ||
      SOURCE_DIRECTORY_ALTERNATES.some((name) => stat(path.join(current, name)))
    )
      return false;
  }
  return true;
};

export interface DeclaredTsupProject {
  readonly projectRoot: string;
  readonly entryFilename: string;
  readonly focalFilename: string;
  readonly providerFilename: string;
  readonly physicalFiles: readonly string[];
}

// This does not certify installed tsup/esbuild, the runtime React supplier,
// other build entry points, or the identity of a public export after re-exports.
export const readDeclaredTsupProject = ({
  projectRoot,
  focalFilename,
  providerSpecifier,
  providerExportName,
}: {
  projectRoot: string;
  focalFilename: string;
  providerSpecifier: string;
  providerExportName: string;
}): DeclaredTsupProject | null => {
  try {
    if (
      !path.isAbsolute(projectRoot) ||
      !isPhysicalDirectory(projectRoot) ||
      !insideSource(projectRoot, focalFilename) ||
      !focalFilename.endsWith(".tsx") ||
      !isPhysicalFile(focalFilename)
    )
      return null;
    const manifest = path.join(projectRoot, "package.json");
    const tsconfig = path.join(projectRoot, "tsconfig.json");
    const configuration = path.join(projectRoot, BUILD_CONFIG);
    // Verified tsup resolves only this filename because --config is explicit.
    // Its omitted tsconfig option resolves the present root tsconfig.json.
    if (stat(path.join(projectRoot, "jsconfig.json")) || !hasNoPostcssConfiguration(projectRoot))
      return null;
    const manifestText = readFile(manifest);
    const tsconfigText = readFile(tsconfig);
    const configurationText = readFile(configuration);
    if (
      !manifestText ||
      !tsconfigText ||
      !configurationText ||
      !packageSelectsBuild(manifestText) ||
      !tsconfigDoesNotRedirect(tsconfigText)
    )
      return null;
    const selected = readDeclaredTsupConfig(configurationText);
    if (!selected) return null;
    const entry = path.join(projectRoot, selected.indexEntry);
    const stylesEntry = path.join(projectRoot, selected.stylesEntry);
    const stylesInput = path.join(projectRoot, selected.css.inputPath);
    if (
      !isPhysicalFile(stylesEntry) ||
      !isPhysicalFile(stylesInput) ||
      !hasCleanSourceAncestors(projectRoot, entry) ||
      !hasCleanSourceAncestors(projectRoot, stylesEntry) ||
      !hasCleanSourceAncestors(projectRoot, stylesInput)
    )
      return null;
    const outputDirectory = path.join(projectRoot, "dist");
    const styleOutput = path.join(projectRoot, selected.css.outputPath);
    if (
      (stat(outputDirectory) && !isPhysicalDirectory(outputDirectory)) ||
      (stat(styleOutput) && !isPhysicalFile(styleOutput))
    )
      return null;
    const entryText = readFile(entry);
    if (!entryText) return null;

    const program = parseSourceText({ filename: entry, sourceText: entryText });
    if (!isNodeOfType(program, "Program")) return null;
    const edges = program.body.filter(
      (statement) =>
        isNodeOfType(statement, "ExportAllDeclaration") &&
        statement.exportKind !== "type" &&
        !statement.exported &&
        !statement.attributes?.length &&
        typeof statement.source.value === "string" &&
        resolveUniqueSourceFile(projectRoot, entry, statement.source.value) === focalFilename,
    );
    if (edges.length !== 1 || !hasCleanSourceAncestors(projectRoot, focalFilename)) return null;
    const focalText = readFile(focalFilename);
    if (!focalText || /@jsx(?:Runtime|ImportSource|Frag)?\b/u.test(focalText)) return null;
    const focalProgram = parseSourceText({ filename: focalFilename, sourceText: focalText });
    if (!isNodeOfType(focalProgram, "Program")) return null;
    const providerImports = focalProgram.body.filter(
      (statement) =>
        isNodeOfType(statement, "ImportDeclaration") &&
        statement.importKind !== "type" &&
        !statement.attributes?.length &&
        statement.source.value === providerSpecifier,
    );
    if (providerImports.length !== 1 || !isNodeOfType(providerImports[0], "ImportDeclaration"))
      return null;
    const namedProviderImports = providerImports[0].specifiers.filter(
      (specifier) =>
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        isNodeOfType(specifier.imported, "Identifier") &&
        specifier.imported.name === providerExportName,
    );
    if (namedProviderImports.length !== 1) return null;
    const providerFilename = resolveUniqueSourceFile(projectRoot, focalFilename, providerSpecifier);
    if (
      !providerFilename?.endsWith(".ts") ||
      providerFilename.endsWith(".d.ts") ||
      !hasCleanSourceAncestors(projectRoot, providerFilename)
    )
      return null;
    recordContentProbe(providerFilename);
    return {
      projectRoot,
      entryFilename: entry,
      focalFilename,
      providerFilename,
      physicalFiles: [
        manifest,
        tsconfig,
        configuration,
        entry,
        stylesEntry,
        stylesInput,
        focalFilename,
        providerFilename,
      ],
    };
  } catch {
    return null;
  }
};
