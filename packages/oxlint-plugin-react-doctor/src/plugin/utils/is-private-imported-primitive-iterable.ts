import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { SourceProjectIndex } from "./build-source-project-index.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getImportedName } from "./get-imported-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { isPathInside } from "./is-path-inside.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const matchesRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const literalString = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const readBuildEntry = (root: string): string | null => {
  const chosenConfig = path.join(root, "tsup.config.ts");
  for (const candidate of [
    "tsup.config.js",
    "tsup.config.cjs",
    "tsup.config.mjs",
    "tsup.config.json",
  ]) {
    const filename = path.join(root, candidate);
    recordExistenceProbe(filename);
    if (fs.existsSync(filename)) return null;
  }
  const program = parseSourceFile(chosenConfig);
  if (!isNodeOfType(program, "Program") || program.body.length !== 2) return null;
  const [definitionImport, exportedConfig] = program.body;
  if (
    !isNodeOfType(definitionImport, "ImportDeclaration") ||
    !isNodeOfType(exportedConfig, "ExportDefaultDeclaration")
  )
    return null;
  const call = exportedConfig.declaration;
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 1) return null;
  const origin = resolveImportedApiReference(call.callee, analyzeScopes(program));
  const config = call.arguments[0];
  if (
    origin?.source !== "tsup" ||
    origin.importedName !== "defineConfig" ||
    !isNodeOfType(config, "ObjectExpression")
  )
    return null;
  const entries = new Map<string, EsTreeNode>();
  for (const property of config.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || entries.has(key)) return null;
    entries.set(key, property.value);
  }
  const entry = entries.get("entry");
  const formats = entries.get("format");
  if (
    !isNodeOfType(entry, "ArrayExpression") ||
    entry.elements.length !== 1 ||
    !isNodeOfType(formats, "ArrayExpression") ||
    formats.elements.length !== 2 ||
    formats.elements.map(literalString).sort().join() !== "cjs,esm"
  )
    return null;
  for (const [key, value] of entries) {
    if (
      key !== "entry" &&
      key !== "format" &&
      (!["clean", "dts", "sourcemap", "minify", "treeshake"].includes(key) ||
        !isNodeOfType(value, "Literal") ||
        typeof value.value !== "boolean")
    )
      return null;
  }
  const selectedEntry = literalString(entry.elements[0]);
  if (!selectedEntry || !/^src\/[\w/-]+\.ts$/u.test(selectedEntry)) return null;
  return normalizeFilename(path.join(root, selectedEntry));
};

const readStaticBuildInput = (filename: string): string | null => {
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  try {
    const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
    return stat?.isFile() && stat.size <= 2_000_000 ? fs.readFileSync(filename, "utf8") : null;
  } catch {
    return null;
  }
};

const lockToolVersion = (lock: string, name: string, range: string): string | null => {
  const key = `${name}@${range}`;
  const rows = lock.split(/\r?\n/u);
  const at = rows.findIndex((row) => row === `${key}:` || row === `"${key}":`);
  if (at === -1) return null;
  const version = /^  version "(\d+\.\d+\.\d+)"$/u.exec(rows[at + 1] ?? "")?.[1];
  if (!version) return null;
  const url = `/${name}/-/${name}-${version}.tgz#`;
  const tarball = rows[at + 2] ?? "";
  if (
    (!tarball.startsWith('  resolved "https://registry.yarnpkg.com/') &&
      !tarball.startsWith('  resolved "https://registry.npmjs.org/')) ||
    !tarball.includes(url) ||
    !/^  integrity sha512-[A-Za-z0-9+/]+=*$/u.test(rows[at + 3] ?? "")
  )
    return null;
  return version;
};

// tsup loads the compiler as a Node dependency from its own real module
// location. Check the closest package on that path, including nested installs.
const hasStockEsbuild = (tsupEntry: string): boolean => {
  let directory = path.dirname(tsupEntry);
  while (true) {
    if (path.basename(directory) !== "node_modules") {
      const nodeModules = path.join(directory, "node_modules");
      const packageDirectory = path.join(nodeModules, "esbuild");
      recordExistenceProbe(nodeModules);
      for (const extension of [".js", ".json", ".node"]) {
        const alternative = packageDirectory + extension;
        recordExistenceProbe(alternative);
        if (fs.existsSync(alternative)) return false;
      }
      recordExistenceProbe(packageDirectory);
      if (fs.existsSync(packageDirectory)) {
        const metadata = readStaticBuildInput(path.join(packageDirectory, "package.json"));
        if (!metadata) return false;
        try {
          const manifest: unknown = JSON.parse(metadata);
          if (
            !matchesRecord(manifest) ||
            manifest.name !== "esbuild" ||
            manifest.version !== "0.15.13" ||
            manifest.main !== "lib/main.js" ||
            manifest.exports !== undefined ||
            manifest.type === "module"
          )
            return false;
          const entry = path.join(packageDirectory, "lib/main.js");
          recordExistenceProbe(path.dirname(entry));
          const source = readStaticBuildInput(entry);
          return (
            source !== null &&
            createHash("sha256").update(source).digest("hex") ===
              "2fae88b0aadd9b6f01e859465fa010e684fb55ab0202b0f55b8979ad8d8bfd1f"
          );
        } catch {
          return false;
        }
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
};

const hasDeclaredStockCompiler = (
  root: string,
  manifest: Record<string, unknown>,
  stylesheetOutputs: boolean,
): boolean => {
  if (!matchesRecord(manifest.devDependencies) || typeof manifest.devDependencies.tsup !== "string")
    return false;
  const config = readStaticBuildInput(path.join(root, "tsconfig.json"));
  const parsed = config ? parseTsconfigJson(config) : null;
  const options = parsed?.compilerOptions;
  if (
    !parsed ||
    parsed.extends !== undefined ||
    !matchesRecord(options) ||
    ["paths", "baseUrl", "rootDirs", "moduleSuffixes", "customConditions", "plugins"].some(
      (key) => options[key] !== undefined,
    )
  )
    return false;
  for (const alternate of [
    "jsconfig.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnp.cjs",
    ".pnp.js",
  ]) {
    const filename = path.join(root, alternate);
    recordExistenceProbe(filename);
    if (fs.existsSync(filename)) return false;
  }
  const lock = readStaticBuildInput(path.join(root, "yarn.lock"));
  if (
    !lock ||
    !lock.startsWith(
      "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1",
    )
  )
    return false;
  // The source proof uses the default stock tsup 6.4/esbuild resolution and,
  // when present, style2js's standalone CSS output. Unknown local provider
  // or executable substitutions cannot establish that declared transform.
  const tsupVersion = lockToolVersion(lock, "tsup", manifest.devDependencies.tsup);
  const esbuildVersion = lockToolVersion(lock, "esbuild", "^0.15.1");
  if (tsupVersion !== "6.4.0" || esbuildVersion !== "0.15.13") return false;
  let tsupEntry = path.join(root, "node_modules/tsup/dist/index.js");
  const tools = [
    {
      name: "tsup",
      version: tsupVersion,
      bin: "dist/cli-default.js",
      main: "dist/index.js",
      files: {
        "dist/index.js": "0e59f425ee713bb84965acb71f1eabe406b0aa8a32a89a3e8ef9114c181bc8ba",
        "dist/cli-default.js": "ccff3d5a0a1909a29d2bd9b7f7a397efe96962c26ec70425d60c69e653f1a92c",
        "dist/cli-main.js": "17e59f896a4aa8cef61c5188f3749476280b6bf01822f70f40cea68fb5bf9fea",
      } as Record<string, string>,
    },
  ];
  if (stylesheetOutputs) {
    const styleRange = manifest.devDependencies.style2js;
    if (typeof styleRange !== "string" || !/^[~^]?1\.\d+\.\d+$/u.test(styleRange)) return false;
    const styleVersion = lockToolVersion(lock, "style2js", styleRange);
    if (styleVersion !== "1.0.1") return false;
    tools.push({
      name: "style2js",
      version: styleVersion,
      bin: "lib/cli.js",
      main: "./lib/style2js.js",
      files: {
        "lib/cli.js": "9090950621bb6d17f9d3eebe5d4ef77a153a77230cf0b79452c6c794d8a46c15",
        "lib/style2js.js": "9638263a2b7c7929c785819c73c418f9cace5f754c4003946867a69af7f336ff",
      },
    });
  }
  for (const tool of tools) {
    let directory = root;
    while (true) {
      const nodeModules = path.join(directory, "node_modules");
      const toolManifest = path.join(nodeModules, tool.name, "package.json");
      const toolBinDirectory = path.join(nodeModules, ".bin");
      const toolBin = path.join(toolBinDirectory, tool.name);
      for (const candidate of [
        nodeModules,
        path.join(nodeModules, tool.name),
        toolBinDirectory,
        toolManifest,
        toolBin,
        `${toolBin}.cmd`,
        `${toolBin}.ps1`,
      ])
        recordExistenceProbe(candidate);
      if (fs.existsSync(`${toolBin}.cmd`) || fs.existsSync(`${toolBin}.ps1`)) return false;
      if (fs.existsSync(toolManifest) || fs.existsSync(toolBin)) {
        const toolSource = readStaticBuildInput(toolManifest);
        if (!toolSource) return false;
        try {
          const toolInfo: unknown = JSON.parse(toolSource);
          if (
            !matchesRecord(toolInfo) ||
            toolInfo.name !== tool.name ||
            toolInfo.version !== tool.version ||
            toolInfo.main !== tool.main ||
            toolInfo.exports !== undefined ||
            toolInfo.type === "module" ||
            !matchesRecord(toolInfo.bin) ||
            toolInfo.bin[tool.name] !== tool.bin
          )
            return false;
          const expectedBin = path.join(nodeModules, tool.name, tool.bin);
          recordExistenceProbe(path.dirname(expectedBin));
          recordExistenceProbe(expectedBin);
          recordContentProbe(expectedBin);
          if (fs.realpathSync(toolBin) !== fs.realpathSync(expectedBin)) return false;
          if (tool.name === "tsup")
            tsupEntry = fs.realpathSync(path.join(nodeModules, tool.name, tool.main));
          for (const [relativeFile, digest] of Object.entries(tool.files)) {
            const source = readStaticBuildInput(path.join(nodeModules, tool.name, relativeFile));
            if (!source || createHash("sha256").update(source).digest("hex") !== digest)
              return false;
          }
        } catch {
          return false;
        }
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return hasStockEsbuild(tsupEntry);
};

const hasScopedPackageExports = (root: string, entry: string): boolean => {
  const manifest: unknown = readPackageManifest(root);
  if (
    !matchesRecord(manifest) ||
    manifest.tsup !== undefined ||
    manifest.imports !== undefined ||
    manifest.bin !== undefined ||
    manifest.browser !== undefined ||
    manifest["react-native"] !== undefined ||
    manifest.source !== undefined ||
    manifest.type === "module" ||
    !matchesRecord(manifest.devDependencies) ||
    typeof manifest.devDependencies.tsup !== "string" ||
    !/^[~^]?6\.\d+\.\d+$/u.test(manifest.devDependencies.tsup) ||
    manifest.resolutions !== undefined ||
    manifest.overrides !== undefined ||
    manifest.workspaces !== undefined ||
    !matchesRecord(manifest.exports) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.includes("dist") ||
    manifest.files.some((value) => value !== "dist" && value !== "scss") ||
    !matchesRecord(manifest.scripts)
  )
    return false;
  const entryName = path.basename(entry, ".ts");
  const expectedImport = `./dist/${entryName}.mjs`;
  const expectedRequire = `./dist/${entryName}.js`;
  const rootExport = manifest.exports["."];
  if (
    !matchesRecord(rootExport) ||
    rootExport.import !== expectedImport ||
    rootExport.require !== expectedRequire ||
    Object.keys(rootExport).some(
      (key) => key !== "import" && key !== "require" && key !== "types",
    ) ||
    `./${manifest.main}` !== expectedRequire ||
    `./${manifest.module}` !== expectedImport
  )
    return false;
  if (
    Object.keys(manifest.scripts).some((key) =>
      /^(?:pre|post)(?:build|build:style|style2js)$/u.test(key),
    ) ||
    manifest.scripts.presass !== undefined
  )
    return false;
  const stylesheetOutputs =
    manifest.scripts.build === "tsup && yarn run build:style" &&
    typeof manifest.scripts.sass === "string" &&
    /^sass scss\/[\w/-]+\.scss dist\/[\w-]+\.css$/u.test(manifest.scripts.sass) &&
    (manifest.scripts.postsass === undefined ||
      (typeof manifest.scripts.postsass === "string" &&
        /^postcss dist\/[\w-]+\.css --use autoprefixer -m -o dist\/[\w-]+\.css$/u.test(
          manifest.scripts.postsass,
        ))) &&
    typeof manifest.scripts["build:style"] === "string" &&
    /^yarn run sass && cssnano dist\/[\w-]+\.css dist\/[\w-]+\.min\.css --no-zindex --no-reduceIdents && yarn run style2js$/u.test(
      manifest.scripts["build:style"],
    ) &&
    typeof manifest.scripts.style2js === "string" &&
    /^style2js --out-dir dist dist\/[\w-]+\.min\.css$/u.test(manifest.scripts.style2js);
  if (
    (!stylesheetOutputs && manifest.scripts.build !== "tsup") ||
    Object.keys(manifest.scripts).some((key) =>
      /^(?:prepare|prepack|prepublishOnly|preinstall|install|postinstall)$/u.test(key),
    ) ||
    !hasDeclaredStockCompiler(root, manifest, stylesheetOutputs)
  )
    return false;
  return Object.entries(manifest.exports).every(([specifier, destination]) => {
    if (specifier === ".") return true;
    if (specifier === "./package.json") return destination === "./package.json";
    if (!stylesheetOutputs) return false;
    if (specifier === "./scss/") return destination === "./scss/";
    if (specifier === "./inject-style")
      return (
        matchesRecord(destination) &&
        destination.import === "./dist/inject-style.esm.mjs" &&
        destination.require === "./dist/inject-style.js" &&
        Object.keys(destination).every(
          (key) => key === "import" || key === "require" || key === "types",
        )
      );
    return (
      typeof destination === "string" &&
      /^\.\/dist\/[\w-]+(?:\.min)?\.css(?:\.map)?$/u.test(destination)
    );
  });
};

const onlyIterates = (
  symbol: SymbolDescriptor | null,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    symbol &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      ({ identifier, flag }) =>
        flag === "read" &&
        isNodeOfType(identifier.parent, "ForOfStatement") &&
        identifier.parent.right === identifier &&
        !identifier.parent.await,
    ),
  );

const isDensePrimitiveList = (symbol: SymbolDescriptor | undefined): boolean => {
  const init = symbol?.initializer && stripParenExpression(symbol.initializer);
  return (
    symbol?.kind === "const" &&
    isNodeOfType(init, "ArrayExpression") &&
    init.elements.length > 0 &&
    init.elements.every(
      (element) =>
        isNodeOfType(element, "Literal") &&
        (element.value === null || ["string", "boolean", "number"].includes(typeof element.value)),
    )
  );
};

// An unescaped binding is still iterable through the realm's Array
// prototype. Keep the warning if source can reach the iterator machinery.
const iteratorIndirections = new Set([
  "Array",
  "Symbol",
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertySymbols",
  "ownKeys",
]);
const opaqueGlobalNames = new Set(["eval", "Function", "Proxy", "Reflect", "Symbol"]);

const reachesIteratorIntrinsics = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedConstructors?: ReadonlySet<string>,
): boolean => {
  if (isNodeOfType(node, "MemberExpression")) {
    const name = getResolvedStaticPropertyName(node, scopes);
    if (name !== null && (iteratorIndirections.has(name) || allowedConstructors?.has(name)))
      return true;
    return (
      isProvenGlobalObjectReference(node.object, scopes) &&
      (name === null ||
        opaqueGlobalNames.has(name) ||
        name === "parent" ||
        name === "top" ||
        name === "frames")
    );
  }
  if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return false;
  if (opaqueGlobalNames.has(node.name)) return true;
  const use = node.parent;
  if (node.name === "Array") {
    return (
      !isNodeOfType(use, "MemberExpression") ||
      use.object !== node ||
      getResolvedStaticPropertyName(use, scopes) !== "from"
    );
  }
  if (allowedConstructors?.has(node.name))
    return !isNodeOfType(use, "NewExpression") || use.callee !== node;
  if (!isProvenGlobalObjectReference(node, scopes)) return false;
  if (isNodeOfType(use, "MemberExpression") && use.object === node) return false;
  if (isNodeOfType(use, "UnaryExpression") && use.operator === "typeof") return false;
  if (
    !isNodeOfType(use, "VariableDeclarator") ||
    use.init !== node ||
    !isNodeOfType(use.id, "ObjectPattern")
  )
    return true;
  return use.id.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    return (
      name === null ||
      iteratorIndirections.has(name) ||
      opaqueGlobalNames.has(name) ||
      Boolean(allowedConstructors?.has(name))
    );
  });
};

const hasUnsafeExportOrUse = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  isProducer: boolean,
  exportedName: string,
  definitionFile: string,
  indexed: WeakMap<EsTreeNode, string>,
): boolean => {
  let unsafe = false;

  walkAst(program, (node) => {
    if (unsafe) return false;
    if (indexed.get(node) === definitionFile) {
      if (isNodeOfType(node, "ImportDeclaration")) {
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            unsafe = true;
            break;
          }
          if (
            !isNodeOfType(specifier, "ImportSpecifier") ||
            specifier.importKind === "type" ||
            getImportedName(specifier) !== exportedName
          )
            continue;
          const symbol = scopes.symbolFor(specifier.local);
          if (!symbol || !onlyIterates(symbol, program, scopes)) {
            unsafe = true;
            break;
          }
        }
      } else if (isNodeOfType(node, "ExportNamedDeclaration") && node.source) {
        unsafe = node.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            specifier.exportKind !== "type" &&
            (isNodeOfType(specifier.local, "Identifier")
              ? specifier.local.name === exportedName
              : literalString(specifier.local) === exportedName),
        );
      } else unsafe = true;
    }
    if (
      isNodeOfType(node, "ExportSpecifier") &&
      isNodeOfType(node.parent, "ExportNamedDeclaration") &&
      !node.parent.source &&
      node.exportKind !== "type" &&
      isNodeOfType(node.local, "Identifier")
    ) {
      const symbol = scopes.symbolFor(node.local);
      const importedDeclaration = symbol?.declarationNode;
      if (
        (isProducer && node.local.name === exportedName) ||
        (isNodeOfType(importedDeclaration, "ImportSpecifier") &&
          getImportedName(importedDeclaration) === exportedName &&
          importedDeclaration.parent &&
          indexed.get(importedDeclaration.parent) === definitionFile)
      )
        unsafe = true;
    }
    if (reachesIteratorIntrinsics(node, scopes)) unsafe = true;
  });
  return unsafe;
};

// For an extensionless import, accept only if differing compiler extension
// priorities would still select the one source used by the dependency index.
export const hasUniqueSourceResolution = (
  from: string,
  source: string,
  selected: string,
): boolean => {
  const base = path.resolve(path.dirname(from), source);
  const candidateNames = [
    base,
    ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".css", ".json"].flatMap(
      (extension) => [`${base}${extension}`, path.join(base, `index${extension}`)],
    ),
  ];
  const packageManifest = path.join(base, "package.json");
  recordExistenceProbe(packageManifest);
  if (fs.existsSync(packageManifest)) return false;
  const existing = candidateNames.filter((candidate) => {
    recordExistenceProbe(candidate);
    try {
      return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
    } catch {
      return false;
    }
  });
  return existing.length === 1 && normalizeFilename(existing[0]!) === selected;
};

interface ClosedPackageRuntimeSource {
  readonly root: string;
  readonly entry: string;
  readonly currentFile: string;
  readonly index: SourceProjectIndex;
}

export const readClosedPackageRuntimeSource = (
  program: EsTreeNodeOfType<"Program">,
  filename: string,
  scopes: ScopeAnalysis,
): ClosedPackageRuntimeSource | null => {
  if (!path.isAbsolute(filename)) return null;
  const root = findNearestPackageDirectory(filename);
  if (!root) return null;
  const entry = readBuildEntry(root);
  if (!entry || !hasScopedPackageExports(root, entry)) return null;
  const currentFile = normalizeFilename(filename);
  const index = buildSourceProjectIndex({
    rootDirectory: root,
    currentFilePath: currentFile,
    currentProgramNode: program,
    currentScopes: scopes,
    includeTestlikeSources: true,
    javascriptAllowsJsx: true,
  });
  if (
    !index ||
    index.hasOpaqueMdxConsumerSurface ||
    index.hasOpaqueRuntimeConsumerSurface ||
    !index.modulesByFilePath.has(entry) ||
    [...index.unresolvedRuntimeSources].some(
      (source) =>
        source.startsWith(".") ||
        source.startsWith("#") ||
        source.startsWith("file:") ||
        path.isAbsolute(source),
    )
  )
    return null;
  return { root, entry, currentFile, index };
};

const stockCollectionConstructors = new Set(["Map", "Set"]);

export const hasUnmodifiedLocalCollections = (index: SourceProjectIndex): boolean => {
  for (const module of index.modulesByFilePath.values()) {
    let modified = false;
    walkAst(module.programNode, (node) => {
      if (modified) return false;
      if (reachesIteratorIntrinsics(node, module.scopes, stockCollectionConstructors))
        modified = true;
      return !modified;
    });
    if (modified) return false;
  }
  return true;
};

export const isPrivateImportedPrimitiveIterable = (
  reference: EsTreeNode,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  if (
    !context.filename ||
    !path.isAbsolute(context.filename) ||
    !isNodeOfType(reference, "Identifier")
  )
    return false;
  const binding = context.scopes.symbolFor(reference);
  if (
    !binding ||
    binding.kind !== "import" ||
    !isNodeOfType(binding.declarationNode, "ImportSpecifier")
  )
    return false;
  const imported = resolveImportedApiReference(reference, context.scopes);
  if (!imported?.source.startsWith(".") || !imported.importedName) return false;
  const program = findProgramRoot(reference);
  if (!program || !onlyIterates(binding, program, context.scopes)) return false;
  const graph = readClosedPackageRuntimeSource(program, context.filename, context.scopes);
  if (!graph) return false;
  const { root, entry, currentFile, index } = graph;
  const definitionFile =
    binding.declarationNode.parent &&
    index.resolvedSourcePathByNode.get(binding.declarationNode.parent);
  if (
    !definitionFile ||
    !isPathInside(definitionFile, path.join(root, "src")) ||
    definitionFile === entry
  )
    return false;
  const producer = index.modulesByFilePath.get(definitionFile);
  const array = producer?.scopes.rootScope.symbolsByName.get(imported.importedName);
  if (
    !producer ||
    !array ||
    !isDensePrimitiveList(array) ||
    !onlyIterates(array, producer.programNode, producer.scopes) ||
    !isNodeOfType(array.declarationNode.parent?.parent, "ExportNamedDeclaration")
  )
    return false;
  if (!hasUniqueSourceResolution(currentFile, imported.source, definitionFile)) return false;
  return [...index.modulesByFilePath.values()].every(
    (module) =>
      !hasUnsafeExportOrUse(
        module.programNode,
        module.scopes,
        module === producer,
        imported.importedName!,
        definitionFile,
        index.resolvedSourcePathByNode,
      ),
  );
};
