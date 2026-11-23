import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
} from "./build-source-project-index.js";
import {
  recordContentProbe,
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasClosedStockReactObjectReferences } from "./has-closed-stock-react-object-references.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isTestlikeFilename } from "./is-testlike-filename.js";
import { modelLiteralTestIdTransform } from "./model-literal-testid-transform.js";
import { readLocalLiteralTestIdTransform } from "./read-local-literal-testid-transform.js";
import {
  readScanOwnedStockViteRoute,
  resolveOnlyLocalCompiler,
} from "./read-scan-owned-stock-vite-route.js";
import { readStockViteAssetRoute } from "./stock-vite-providers/read-stock-vite-asset-route.js";
import { resolveStockPhysicalEntry } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import {
  readSameStockReact18BrowserRenderer,
  STOCK_REACT18_BROWSER_JSX,
  STOCK_REACTDOM18_BROWSER_MODULE,
} from "./stock-vite-providers/stock-react18-browser-provider.js";
import { readStockReact18BrowserScheduler } from "./stock-vite-providers/stock-scheduler23-browser-provider.js";
import { createViteTypedRuntimeEdgeReader } from "./vite-typed-runtime-edges.js";
import { walkAst } from "./walk-ast.js";

export interface VerifiedStockViteBrowserProjectInput {
  readonly projectRoot: string;
  readonly filename: string;
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  readonly inspectProject?: (project: StockViteBrowserInspection) => readonly string[] | null;
}

export interface StockViteBrowserInspection {
  readonly index: NonNullable<ReturnType<typeof buildSourceProjectIndex>>;
  readonly closure: NonNullable<ReturnType<typeof readSelectedTypedSourceClosure>>;
  readonly appEntry: string;
  readonly readSource: (filename: string) => string | null;
  readonly readEmittedSource: (filename: string) => string | null | undefined;
}

export interface VerifiedStockViteBrowserProject {
  readonly index: StockViteBrowserInspection["index"];
  readonly closure: StockViteBrowserInspection["closure"];
  readonly appEntry: string;
  readonly browser: NonNullable<ReturnType<typeof readSameStockReact18BrowserRenderer>>;
}

const hasDefaultBuildEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  environment.NODE_OPTIONS === undefined &&
  environment.REACT_DOCTOR_OXLINT_NODE_OPTIONS_PRESENT !== "1" &&
  (environment.NODE_ENV === undefined || environment.NODE_ENV === "production") &&
  ["NODE_PATH", "ESBUILD_BINARY_PATH", "COVERAGE", "ANALYZE_MODE", "PORT"].every(
    (name) => environment[name] === undefined,
  ) &&
  !process.execArgv.some((argument) =>
    /^(?:-C|-r|--conditions|--(?:experimental-)?loader|--require|--import)(?:=|$)/u.test(argument),
  );

const isGlibcLinuxRuntime = (): boolean => {
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    Number(process.versions.node.split(".")[0]) < 24
  )
    return false;
  const report: unknown = process.report.getReport();
  return (
    typeof report === "object" &&
    report !== null &&
    "header" in report &&
    typeof report.header === "object" &&
    report.header !== null &&
    "glibcVersionRuntime" in report.header &&
    typeof report.header.glibcVersionRuntime === "string"
  );
};

const readRegularFile = (filename: string): Buffer | null => {
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 4_194_304 || fs.realpathSync(filename) !== filename)
    return null;
  recordContentProbe(filename);
  return fs.readFileSync(filename);
};

const hasOnlyBuildConfigReferences = (
  root: string,
  configuredFile: string,
  references: unknown,
): boolean =>
  Array.isArray(references) &&
  references.every((reference: unknown) => {
    if (
      typeof reference !== "object" ||
      reference === null ||
      !("path" in reference) ||
      typeof reference.path !== "string" ||
      !/^\.\/tsconfig\.[a-z0-9-]+\.json$/u.test(reference.path)
    )
      return false;
    const bytes = readRegularFile(path.join(root, reference.path));
    if (!bytes) return false;
    const config: unknown = JSON.parse(bytes.toString("utf8"));
    return (
      typeof config === "object" &&
      config !== null &&
      !("extends" in config) &&
      !("references" in config) &&
      !("files" in config) &&
      "include" in config &&
      Array.isArray(config.include) &&
      config.include.length === 1 &&
      config.include[0] === path.basename(configuredFile)
    );
  });

const readJsxOptions = (projectRoot: string, configuredFile: string) => {
  const file = readRegularFile(path.join(projectRoot, "tsconfig.json"));
  if (!file) return null;
  const config: unknown = JSON.parse(file.toString("utf8"));
  if (
    typeof config !== "object" ||
    config === null ||
    "extends" in config ||
    ("references" in config &&
      !hasOnlyBuildConfigReferences(projectRoot, configuredFile, config.references)) ||
    !("compilerOptions" in config)
  )
    return null;
  const options = config.compilerOptions;
  if (
    typeof options !== "object" ||
    options === null ||
    !("jsx" in options) ||
    options.jsx !== "react-jsx" ||
    "jsxImportSource" in options ||
    "jsxFactory" in options ||
    "jsxFragmentFactory" in options ||
    ("preserveValueImports" in options && options.preserveValueImports !== false) ||
    ("verbatimModuleSyntax" in options && options.verbatimModuleSyntax !== false) ||
    ("importsNotUsedAsValues" in options && options.importsNotUsedAsValues !== "remove")
  )
    return null;
  return {
    preserveValueImports: false,
    verbatimModuleSyntax: false,
    importsNotUsedAsValues: "remove",
  };
};

const hasNestedCompilerOptions = (projectRoot: string, filename: string): boolean => {
  for (
    let directory = path.dirname(filename);
    directory !== projectRoot;
    directory = path.dirname(directory)
  ) {
    if (directory === path.dirname(directory)) return true;
    const candidate = path.join(directory, "tsconfig.json");
    recordExistenceProbe(candidate);
    recordDirectoryProbe(directory);
    if (fs.lstatSync(candidate, { throwIfNoEntry: false })) return true;
  }
  return false;
};

const readRootRenderer = (program: EsTreeNodeOfType<"Program">, scopes: ScopeAnalysis): boolean => {
  const imports = program.body.flatMap((statement) => {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      statement.source.value !== "react-dom/client"
    )
      return [];
    return statement.specifiers.filter((specifier) =>
      isNodeOfType(specifier, "ImportDefaultSpecifier"),
    );
  });
  if (imports.length !== 1) return false;
  const binding = scopes.symbolFor(imports[0].local);
  if (
    !binding ||
    !hasCompleteSymbolReferences(binding, program, scopes) ||
    binding.references.length !== 1 ||
    binding.references[0].flag !== "read"
  )
    return false;
  let render = false;
  walkAst(program, (node) => {
    if (
      node.parent?.parent !== program ||
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      node.callee.computed ||
      node.callee.optional ||
      !isNodeOfType(node.callee.property, "Identifier") ||
      node.callee.property.name !== "render" ||
      node.arguments.length !== 1 ||
      !isNodeOfType(node.arguments[0], "JSXElement")
    )
      return;
    const createRoot = node.callee.object;
    if (
      !isNodeOfType(createRoot, "CallExpression") ||
      createRoot.optional ||
      !isNodeOfType(createRoot.callee, "MemberExpression") ||
      createRoot.callee.computed ||
      createRoot.callee.optional ||
      !isNodeOfType(createRoot.callee.property, "Identifier") ||
      createRoot.callee.property.name !== "createRoot" ||
      !isNodeOfType(createRoot.callee.object, "Identifier") ||
      scopes.symbolFor(createRoot.callee.object) !== binding
    )
      return;
    render = true;
  });
  return render;
};

const assetExtension = /\.(?:css|scss|svg|png|json)$/iu;
const jsxPragma = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;

export const readVerifiedStockViteBrowserProject = (
  input: VerifiedStockViteBrowserProjectInput,
): VerifiedStockViteBrowserProject | null => {
  try {
    const { projectRoot, filename, program, scopes } = input;
    recordRealpathProbe(projectRoot);
    if (
      fs.realpathSync(projectRoot) !== projectRoot ||
      !isGlibcLinuxRuntime() ||
      !hasDefaultBuildEnvironment(process.env)
    )
      return null;
    const build = readScanOwnedStockViteRoute({
      filename,
      targetDirectory: projectRoot,
      relevantSources: [filename],
      runtime: {
        platform: "linux",
        architecture: "x64",
        libc: "glibc",
        esbuildBinaryOverride: process.env.ESBUILD_BINARY_PATH !== undefined,
      },
    });
    if (!build) return null;
    const viteEntry = build.modules.get("vite");
    const options = readJsxOptions(projectRoot, build.selected.configFile);
    if (!viteEntry || !options) return null;

    const rawByFilename = new Map<string, string>();
    const readSource = (sourceFile: string): string | null => {
      const stored = rawByFilename.get(sourceFile);
      if (stored !== undefined) return stored;
      const data = readRegularFile(sourceFile);
      if (!data) return null;
      const text = data.toString("utf8");
      rawByFilename.set(sourceFile, text);
      return text;
    };
    const readEmittedSource = (sourceFile: string): string | null | undefined => {
      if (!build.transform || isTestlikeFilename(sourceFile) || !/\.[jt]sx$/iu.test(sourceFile))
        return undefined;
      const text = readSource(sourceFile);
      return text === null ? null : modelLiteralTestIdTransform(text, sourceFile);
    };
    const readAsset = (file: string): boolean => {
      const data = readRegularFile(file);
      if (!data) return false;
      if (!file.toLowerCase().endsWith(".json")) return true;
      try {
        JSON.parse(data.toString("utf8"));
        return true;
      } catch {
        return false;
      }
    };
    const assetIssuers = new Map<string, Set<string>>();
    const observeAsset = (file: string, issuer: string): void => {
      let issuers = assetIssuers.get(file);
      if (!issuers) {
        issuers = new Set<string>();
        assetIssuers.set(file, issuers);
      }
      issuers.add(issuer);
    };
    const compilerOptionsByDirectory = new Map<string, boolean>();
    const usesRootJsxOptions = (sourceFile: string): boolean => {
      const directory = path.dirname(sourceFile);
      const cached = compilerOptionsByDirectory.get(directory);
      if (cached !== undefined) return cached;
      const selected = !hasNestedCompilerOptions(projectRoot, sourceFile);
      compilerOptionsByDirectory.set(directory, selected);
      return selected;
    };
    const readRuntimeEdge = createViteTypedRuntimeEdgeReader({
      projectDirectory: projectRoot,
      aliases: build.profile.aliases,
      defaultJsonModuleEmitter: true,
      assertionImportOptions: (sourceFile) =>
        usesRootJsxOptions(sourceFile) ? options : undefined,
    });
    const provenDataImports = new WeakSet<EsTreeNode>();
    const index = buildSourceProjectIndex({
      rootDirectory: projectRoot,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: scopes,
      includeTestlikeSources: true,
      readEmittedSource,
      readTypedRuntimeEdge: (module, node, source) => {
        const edge = readRuntimeEdge(module, node, source);
        const assets =
          edge?.kind === "data"
            ? edge.filenames
            : edge?.kind === "file" && assetExtension.test(edge.filename)
              ? [edge.filename]
              : [];
        if (!assets.every(readAsset)) return { kind: "opaque" };
        if (edge?.kind === "data") provenDataImports.add(node);
        for (const asset of assets) observeAsset(asset, module.filePath);
        return edge;
      },
    });
    if (!index || index.hasOpaqueMdxConsumerSurface || !index.typedEdges) return null;
    const appEntry = build.selected.moduleEntry;
    const closure = readSelectedTypedSourceClosure(index, [appEntry]);
    if (!closure || closure.opaqueIssuers.size > 0) return null;
    const rootModule = index.modulesByFilePath.get(appEntry);
    if (!rootModule || !readRootRenderer(rootModule.programNode, rootModule.scopes)) return null;
    if (!closure.reachable.has(filename)) return null;
    const critical = input.inspectProject
      ? input.inspectProject({ index, closure, appEntry, readSource, readEmittedSource })
      : [filename, appEntry];
    if (!critical) return null;
    if (build.transform) {
      const sources = critical.flatMap((sourceFile) => {
        const sourceText = readSource(sourceFile);
        return sourceText === null ? [] : [{ filename: sourceFile, sourceText }];
      });
      if (
        sources.length !== critical.length ||
        !readLocalLiteralTestIdTransform({
          projectRoot,
          configFilename: build.selected.configFile,
          sources,
          projectionInputs: build.projectionInput,
          resolveLocalPlugin: resolveOnlyLocalCompiler,
        })
      )
        return null;
    }
    const jsxFiles = [...closure.reachable].filter((file) => /\.[jt]sx$/iu.test(file));
    for (const jsxFile of jsxFiles) {
      const text = readSource(jsxFile);
      if (text === null || jsxPragma.test(text) || !usesRootJsxOptions(jsxFile)) return null;
    }

    const activeAssets = [...assetIssuers]
      .filter(([, issuers]) => [...issuers].some((issuer) => closure.reachable.has(issuer)))
      .map(([asset]) => asset);
    const stylesheetImports = [...index.typedEdges.externalByIssuer].flatMap(
      ([issuer, specifiers]) =>
        closure.reachable.has(issuer)
          ? [...specifiers]
              .filter((source) => /\.(?:css|scss)$/iu.test(source))
              .map((source) => ({ importerFile: issuer, specifier: source }))
          : [],
    );
    if (
      !readStockViteAssetRoute({
        projectRoot,
        viteEntry,
        sourceAliases: new Map(
          build.profile.aliases.flatMap(({ find, replacement }) =>
            replacement.startsWith(projectRoot + path.sep) && !path.extname(replacement)
              ? [[find, path.relative(projectRoot, replacement)]]
              : [],
          ),
        ),
        localStylesheetFiles: activeAssets.filter((asset) => /\.(?:css|scss)$/iu.test(asset)),
        moduleStylesheetImports: stylesheetImports,
        svgAssets: activeAssets
          .filter((asset) => asset.toLowerCase().endsWith(".svg"))
          .map((asset) => ({
            filename: asset,
            kind: build.profile.effects.includes("svg-components") ? "component" : "url",
          })),
        svgTransform: build.profile.effects.includes("svg-components")
          ? { kind: "stock-svgr", implicitConfigHome: homedir() }
          : { kind: "none" },
      })
    )
      return null;

    const reactIssuerDirectories = new Set(critical.map((file) => path.dirname(file)));
    const domImporters = new Map<string, Set<string>>();
    const runtimeImporters = new Map<string, Set<string>>();
    const recordImporter = (record: Map<string, Set<string>>, specifier: string, file: string) => {
      let directories = record.get(specifier);
      if (!directories) {
        directories = new Set();
        record.set(specifier, directories);
      }
      directories.add(path.dirname(file));
    };
    for (const file of closure.reachable) {
      const module = index.modulesByFilePath.get(file);
      if (!module) continue;
      if (
        !hasClosedStockReactObjectReferences(module.programNode, module.scopes, (node) =>
          provenDataImports.has(node),
        )
      )
        return null;
      for (const statement of module.programNode.body) {
        if (
          !isNodeOfType(statement, "ImportDeclaration") ||
          isTypeOnlyImport(statement) ||
          typeof statement.source.value !== "string"
        )
          continue;
        const source = statement.source.value;
        if (source === "react") reactIssuerDirectories.add(path.dirname(file));
        else if (source === "react-dom" || source === "react-dom/client")
          recordImporter(domImporters, source, file);
        else if (source === "react/jsx-runtime") recordImporter(runtimeImporters, source, file);
        else if (/^(?:react|react-dom)\//u.test(source)) return null;
      }
    }
    const browser = readSameStockReact18BrowserRenderer({
      projectRoot,
      reactImporterDirectories: [...reactIssuerDirectories],
      jsxImporterDirectories: [...new Set(jsxFiles.map((file) => path.dirname(file)))],
      rendererImporterDirectory: path.dirname(appEntry),
    });
    if (!browser || !readStockReact18BrowserScheduler(projectRoot, browser.renderer)) return null;
    for (const [imports, expected, contract] of [
      [domImporters, browser.renderer, STOCK_REACTDOM18_BROWSER_MODULE],
      [runtimeImporters, browser.react, STOCK_REACT18_BROWSER_JSX],
    ] as const) {
      for (const [specifier, directories] of imports) {
        for (const importerDirectory of directories) {
          const provider = resolveStockPhysicalEntry({
            projectRoot,
            importerDirectory,
            specifier,
            contract,
            profile: "vite-production-import",
          });
          if (provider?.packageDirectory !== expected.packageDirectory) return null;
        }
      }
    }
    return { index, closure, appEntry, browser };
  } catch {
    return null;
  }
};
