import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { recordContentProbe, recordDirectoryProbe } from "./cross-file-probe-recorder.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "./is-type-only-import.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTestlikeFilename } from "./is-testlike-filename.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile, parseSourceText } from "./parse-source-file.js";
import { readProjectHtmlScripts } from "./read-project-html-scripts.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface SourceProjectModule {
  readonly filePath: string;
  readonly programNode: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
}

export type TypedRuntimeEdge =
  | { readonly kind: "file"; readonly filename: string }
  | { readonly kind: "data"; readonly filenames: readonly string[] }
  | { readonly kind: "external" | "erased" | "opaque" };

export type SourceProjectTypedEdgeReader = (
  module: SourceProjectModule,
  node: EsTreeNode,
  source: string | null,
) => TypedRuntimeEdge | null;

interface SourceProjectTypedEdges {
  readonly read: SourceProjectTypedEdgeReader;
  readonly outgoingByIssuer: Map<string, Set<string>>;
  readonly externalByIssuer: Map<string, Set<string>>;
  readonly opaqueIssuers: Set<string>;
}

export interface SourceProjectIndex {
  readonly modulesByFilePath: ReadonlyMap<string, SourceProjectModule>;
  readonly htmlFilePaths: ReadonlyArray<string>;
  readonly consumerModulesByFilePath: ReadonlyMap<string, ReadonlySet<SourceProjectModule>>;
  readonly resolvedSourcePathByNode: WeakMap<EsTreeNode, string>;
  readonly unresolvedRuntimeSources: ReadonlySet<string>;
  readonly hasOpaqueMdxConsumerSurface: boolean;
  readonly hasOpaqueRuntimeConsumerSurface: boolean;
  readonly typedEdges?: Omit<SourceProjectTypedEdges, "read">;
}

export interface SourceProjectIndexInput {
  readonly rootDirectory: string;
  readonly currentFilePath: string;
  readonly currentProgramNode: EsTreeNodeOfType<"Program">;
  readonly currentScopes: ScopeAnalysis;
  readonly requiredModuleSources?: ReadonlyArray<string>;
  readonly knownModuleSources?: ReadonlyArray<string>;
  readonly includeTestlikeSources?: boolean;
  readonly javascriptAllowsJsx?: boolean;
  readonly includeGeneratedSourcesUnder?: string;
  readonly resolveModuleSource?: (module: SourceProjectModule, source: string) => string | null;
  readonly readTypedRuntimeEdge?: SourceProjectTypedEdgeReader;
  // undefined selects the existing source parser; null declines the graph.
  // The caller must track all inputs and emitted artifact probes.
  readonly readEmittedSource?: (filePath: string) => string | null | undefined;
}

const SOURCE_PROJECT_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const SOURCE_PROJECT_DECLARATION_FILE_PATTERN = /\.d\.[cm]?[jt]s$/i;
const SOURCE_PROJECT_MDX_FILE_PATTERN = /\.mdx$/i;
const SOURCE_PROJECT_HTML_FILE_PATTERN = /\.html?$/i;
const SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".angular",
  ".astro",
  ".cache",
  ".contentlayer",
  ".docusaurus",
  ".expo",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);
const sourceProjectScopeCache = new WeakMap<EsTreeNodeOfType<"Program">, ScopeAnalysis>();

const getSourceProjectModuleScopes = (programNode: EsTreeNodeOfType<"Program">): ScopeAnalysis => {
  const cachedScopes = sourceProjectScopeCache.get(programNode);
  if (cachedScopes) return cachedScopes;
  const scopes = analyzeScopes(programNode);
  sourceProjectScopeCache.set(programNode, scopes);
  return scopes;
};

const listProductionSourceFiles = (
  rootDirectory: string,
  includeTestlikeSources: boolean,
  includeGeneratedSourcesUnder: string | undefined,
): {
  sourceFilePaths: ReadonlyArray<string>;
  htmlFilePaths: ReadonlyArray<string>;
  hasOpaqueMdxConsumerSurface: boolean;
} | null => {
  const sourceFilePaths: string[] = [];
  const htmlFilePaths: string[] = [];
  const pendingDirectories = [rootDirectory];
  let hasOpaqueMdxConsumerSurface = false;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    if (includeTestlikeSources) recordDirectoryProbe(currentDirectory);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      return null;
    }
    const generatedSourceRelativePath =
      includeGeneratedSourcesUnder === undefined
        ? null
        : path.relative(includeGeneratedSourcesUnder, currentDirectory);
    const shouldIncludeGeneratedSources =
      generatedSourceRelativePath !== null &&
      generatedSourceRelativePath !== ".." &&
      !generatedSourceRelativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(generatedSourceRelativePath);
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const isIgnoredDirectoryName =
        (SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES.has(entry.name) &&
          (!shouldIncludeGeneratedSources ||
            entry.name === ".git" ||
            entry.name === "node_modules")) ||
        (!includeTestlikeSources &&
          entry.name.startsWith(".") &&
          entry.name !== ".dumi" &&
          entry.name !== ".storybook");
      if (entry.isSymbolicLink() && isIgnoredDirectoryName) continue;
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName) continue;
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || (!includeTestlikeSources && isTestlikeFilename(absolutePath)))
        continue;
      if (SOURCE_PROJECT_MDX_FILE_PATTERN.test(entry.name)) {
        hasOpaqueMdxConsumerSurface = true;
        continue;
      }
      if (SOURCE_PROJECT_HTML_FILE_PATTERN.test(entry.name)) {
        htmlFilePaths.push(normalizeFilename(absolutePath));
        continue;
      }
      if (!SOURCE_PROJECT_FILE_PATTERN.test(entry.name)) continue;
      if (SOURCE_PROJECT_DECLARATION_FILE_PATTERN.test(entry.name)) continue;
      if (includeTestlikeSources) recordContentProbe(absolutePath);
      sourceFilePaths.push(normalizeFilename(absolutePath));
    }
  }

  return { sourceFilePaths, htmlFilePaths, hasOpaqueMdxConsumerSurface };
};

const sourceFilesMayImportRequiredModule = (
  sourceFilePaths: ReadonlyArray<string>,
  requiredModuleSources: ReadonlyArray<string>,
): boolean => {
  for (const sourceFilePath of sourceFilePaths) {
    let sourceText: string;
    try {
      sourceText = fs.readFileSync(sourceFilePath, "utf8");
    } catch {
      return true;
    }
    for (const moduleSource of requiredModuleSources) {
      if (sourceText.includes(`"${moduleSource}"`) || sourceText.includes(`'${moduleSource}'`)) {
        return true;
      }
    }
  }
  return false;
};

const readLiteralModuleSource = (node: EsTreeNode | undefined): string | null => {
  let value = node && stripParenExpression(node);
  while (
    isNodeOfType(value, "TSAsExpression") ||
    isNodeOfType(value, "TSTypeAssertion") ||
    isNodeOfType(value, "TSSatisfiesExpression") ||
    isNodeOfType(value, "TSNonNullExpression")
  )
    value = stripParenExpression(value.expression);
  return isNodeOfType(value, "Literal") && typeof value.value === "string" ? value.value : null;
};

const isRuntimeRequire = (node: EsTreeNode): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  ((isNodeOfType(node.callee, "Identifier") && node.callee.name === "require") ||
    (isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "require"));

const isGlobImport = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.object, "MetaProperty") &&
  node.callee.object.meta.name === "import" &&
  (node.callee.computed ||
    (isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name.startsWith("glob")));

const getRuntimeModuleSource = (
  node: EsTreeNode,
  includeTestlikeSources: boolean,
): string | null => {
  if (isNodeOfType(node, "ImportDeclaration")) {
    if (isTypeOnlyImport(node)) return null;
    return typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ExportNamedDeclaration")) {
    if (
      node.exportKind === "type" ||
      isEverySpecifierInlineType(node.specifiers, "ExportSpecifier", "exportKind")
    ) {
      return null;
    }
    return node.source && typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ExportAllDeclaration")) {
    if (node.exportKind === "type") return null;
    return typeof node.source.value === "string" ? node.source.value : null;
  }
  if (isNodeOfType(node, "ImportExpression")) {
    if (includeTestlikeSources) return readLiteralModuleSource(node.source);
    return isNodeOfType(node.source, "Literal") && typeof node.source.value === "string"
      ? node.source.value
      : null;
  }
  if (includeTestlikeSources && isRuntimeRequire(node)) {
    return isNodeOfType(node.callee, "Identifier") && node.arguments.length === 1
      ? readLiteralModuleSource(node.arguments[0])
      : null;
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  ) {
    const source = node.arguments[0];
    return source && isNodeOfType(source, "Literal") && typeof source.value === "string"
      ? source.value
      : null;
  }
  return null;
};

const isUnresolvedDeclarationOnlyImport = (
  node: EsTreeNode,
  module: SourceProjectModule,
  source: string,
): boolean => {
  if (
    !isNodeOfType(node, "ImportDeclaration") ||
    node.specifiers.length === 0 ||
    !node.specifiers.every(
      (specifier) => module.scopes.symbolFor(specifier.local)?.references.length === 0,
    )
  ) {
    return false;
  }
  const declaration = resolveModulePath(module.filePath, `${source}.d.ts`);
  return Boolean(declaration && SOURCE_PROJECT_DECLARATION_FILE_PATTERN.test(declaration));
};

const isUntrackedRequireReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "Identifier") ||
    node.name !== "require" ||
    !scopes.isGlobalReference(node)
  )
    return false;
  const use = node.parent;
  if (isNodeOfType(use, "CallExpression") && use.callee === node) return false;
  // A CommonJS entry-point identity test does not call or expose a loader.
  if (
    isNodeOfType(use, "MemberExpression") &&
    use.object === node &&
    !use.computed &&
    isNodeOfType(use.property, "Identifier") &&
    use.property.name === "main" &&
    isNodeOfType(use.parent, "BinaryExpression") &&
    (use.parent.operator === "===" || use.parent.operator === "!==")
  ) {
    const other = use.parent.left === use ? use.parent.right : use.parent.left;
    if (
      isNodeOfType(other, "Identifier") &&
      other.name === "module" &&
      scopes.isGlobalReference(other)
    )
      return false;
  }
  return true;
};

const isRuntimeModuleFile = (filename: string): boolean =>
  SOURCE_PROJECT_FILE_PATTERN.test(filename) || /\.(?:vue|svelte|astro|mdx)$/iu.test(filename);

const HTML_GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "self"]);
const HTML_LOADER_NAMES = new Set([
  "eval",
  "Function",
  "System",
  "SystemJS",
  "require",
  "importScripts",
]);

const getHtmlGlobalObject = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): "global" | "document" | null => {
  if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
    if (node.name === "document") return "document";
    return HTML_GLOBAL_OBJECT_NAMES.has(node.name) ? "global" : null;
  }
  if (
    !isNodeOfType(node, "MemberExpression") ||
    getHtmlGlobalObject(node.object, scopes) !== "global"
  )
    return null;
  const name = getResolvedStaticPropertyName(node, scopes);
  if (name === "document") return "document";
  return name && HTML_GLOBAL_OBJECT_NAMES.has(name) ? "global" : null;
};

const callsOnlyNonScriptElementFactory = (member: EsTreeNode, argumentIndex: number): boolean => {
  const call = member.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== member) return false;
  const tag = call.arguments[argumentIndex];
  return (
    isNodeOfType(tag, "Literal") &&
    typeof tag.value === "string" &&
    tag.value.toLowerCase() !== "script"
  );
};

const hasOpaqueHtmlExecution = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let opaque = false;
  walkAst(program, (node) => {
    if (opaque) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      HTML_LOADER_NAMES.has(node.name) &&
      scopes.isGlobalReference(node)
    ) {
      opaque = true;
      return false;
    }
    const owner = getHtmlGlobalObject(node, scopes);
    if (!owner) return;
    const access = node.parent;
    if (isNodeOfType(access, "UnaryExpression") && access.operator === "typeof") return;
    if (!isNodeOfType(access, "MemberExpression") || access.object !== node) {
      opaque = true;
      return false;
    }
    const property = getResolvedStaticPropertyName(access, scopes);
    if (!property || (owner === "global" && HTML_LOADER_NAMES.has(property))) opaque = true;
    if (owner === "document") {
      if (property === "write" || property === "writeln") opaque = true;
      if (property === "createElement" && !callsOnlyNonScriptElementFactory(access, 0))
        opaque = true;
      if (property === "createElementNS" && !callsOnlyNonScriptElementFactory(access, 1))
        opaque = true;
    }
    return !opaque;
  });
  return opaque;
};

const addTypedProjectTargets = <Value>(
  edges: Map<string, Set<Value>>,
  issuer: string,
  targets: readonly Value[],
): void => {
  const attached = edges.get(issuer) ?? new Set<Value>();
  for (const target of targets) attached.add(target);
  edges.set(issuer, attached);
};

const indexModuleSources = (
  module: SourceProjectModule,
  consumerModulesByFilePath: Map<string, Set<SourceProjectModule>>,
  resolvedSourcePathByNode: WeakMap<EsTreeNode, string>,
  unresolvedRuntimeSources: Set<string>,
  includeTestlikeSources: boolean,
  indexedModules: ReadonlyMap<string, SourceProjectModule>,
  resolveModuleSource: SourceProjectIndexInput["resolveModuleSource"],
  typedEdges: SourceProjectTypedEdges | undefined,
): boolean => {
  let opaque = false;
  const addFile = (node: EsTreeNode, filename: string): void => {
    const normalizedSourcePath = normalizeFilename(filename);
    if (
      includeTestlikeSources &&
      isRuntimeModuleFile(normalizedSourcePath) &&
      !indexedModules.has(normalizedSourcePath)
    )
      opaque = true;
    resolvedSourcePathByNode.set(node, normalizedSourcePath);
    addTypedProjectTargets(consumerModulesByFilePath, normalizedSourcePath, [module]);
    if (typedEdges)
      addTypedProjectTargets(typedEdges.outgoingByIssuer, module.filePath, [normalizedSourcePath]);
  };
  walkAst(module.programNode, (node) => {
    if (
      includeTestlikeSources &&
      (isUntrackedRequireReference(node, module.scopes) ||
        (isNodeOfType(node, "Identifier") &&
          (node.name === "System" || node.name === "SystemJS") &&
          module.scopes.isGlobalReference(node)))
    )
      opaque = true;
    const source = getRuntimeModuleSource(node, includeTestlikeSources);
    const typed = typedEdges?.read(module, node, source);
    if (typedEdges && typed) {
      switch (typed.kind) {
        case "file":
          addFile(node, typed.filename);
          break;
        case "data":
          addTypedProjectTargets(
            typedEdges.outgoingByIssuer,
            module.filePath,
            typed.filenames.map(normalizeFilename),
          );
          break;
        case "external":
          if (source)
            addTypedProjectTargets(typedEdges.externalByIssuer, module.filePath, [source]);
          break;
        case "opaque":
          opaque = true;
          if (source) unresolvedRuntimeSources.add(source);
          break;
      }
      return;
    }
    if (!source) {
      if (
        includeTestlikeSources &&
        (isNodeOfType(node, "ImportExpression") || isRuntimeRequire(node) || isGlobImport(node))
      )
        opaque = true;
      return;
    }
    if (
      includeTestlikeSources &&
      (source === "node:module" ||
        source === "module" ||
        source === "systemjs" ||
        source.startsWith("systemjs/"))
    )
      opaque = true;
    const resolvedSourcePath = resolveModuleSource
      ? resolveModuleSource(module, source)
      : resolveModulePath(module.filePath, source);
    if (!resolvedSourcePath) {
      if (
        !resolveModuleSource &&
        includeTestlikeSources &&
        isUnresolvedDeclarationOnlyImport(node, module, source)
      )
        return;
      unresolvedRuntimeSources.add(source);
      return;
    }
    addFile(node, resolvedSourcePath);
  });
  if (opaque) typedEdges?.opaqueIssuers.add(module.filePath);
  return opaque;
};

export const buildSourceProjectIndex = ({
  rootDirectory,
  currentFilePath,
  currentProgramNode,
  currentScopes,
  requiredModuleSources = [],
  knownModuleSources,
  includeTestlikeSources = false,
  javascriptAllowsJsx = false,
  includeGeneratedSourcesUnder,
  resolveModuleSource,
  readTypedRuntimeEdge,
  readEmittedSource,
}: SourceProjectIndexInput): SourceProjectIndex | null => {
  if (
    readEmittedSource === undefined &&
    requiredModuleSources.length > 0 &&
    knownModuleSources !== undefined &&
    !requiredModuleSources.some((moduleSource) => knownModuleSources.includes(moduleSource))
  ) {
    return null;
  }
  const productionSourceFiles = listProductionSourceFiles(
    rootDirectory,
    includeTestlikeSources,
    includeGeneratedSourcesUnder,
  );
  if (!productionSourceFiles) return null;
  if (
    readEmittedSource === undefined &&
    requiredModuleSources.length > 0 &&
    knownModuleSources === undefined &&
    !sourceFilesMayImportRequiredModule(
      productionSourceFiles.sourceFilePaths,
      requiredModuleSources,
    )
  ) {
    return null;
  }
  const modulesByFilePath = new Map<string, SourceProjectModule>();
  for (const filePath of productionSourceFiles.sourceFilePaths) {
    const emitted = readEmittedSource?.(filePath);
    if (emitted === null) return null;
    if (emitted === undefined && filePath === currentFilePath) {
      modulesByFilePath.set(filePath, {
        filePath,
        programNode: currentProgramNode,
        scopes: currentScopes,
      });
      continue;
    }
    const language =
      javascriptAllowsJsx && path.extname(filePath).toLowerCase() === ".js" ? "jsx" : undefined;
    const parsedProgram =
      emitted === undefined
        ? parseSourceFile(filePath, language)
        : parseSourceText({ filename: filePath, sourceText: emitted, language });
    if (!parsedProgram || !isNodeOfType(parsedProgram, "Program")) return null;
    modulesByFilePath.set(filePath, {
      filePath,
      programNode: parsedProgram,
      scopes: getSourceProjectModuleScopes(parsedProgram),
    });
  }

  const consumerModulesByFilePath = new Map<string, Set<SourceProjectModule>>();
  const resolvedSourcePathByNode = new WeakMap<EsTreeNode, string>();
  const unresolvedRuntimeSources = new Set<string>();
  const typedEdges: SourceProjectTypedEdges | undefined = readTypedRuntimeEdge
    ? {
        read: readTypedRuntimeEdge,
        outgoingByIssuer: new Map(),
        externalByIssuer: new Map(),
        opaqueIssuers: new Set(),
      }
    : undefined;
  let hasOpaqueRuntimeConsumerSurface = false;
  for (const module of modulesByFilePath.values()) {
    const opaque = indexModuleSources(
      module,
      consumerModulesByFilePath,
      resolvedSourcePathByNode,
      unresolvedRuntimeSources,
      includeTestlikeSources,
      modulesByFilePath,
      resolveModuleSource,
      typedEdges,
    );
    hasOpaqueRuntimeConsumerSurface ||= opaque;
  }

  if (includeTestlikeSources) {
    for (const filePath of productionSourceFiles.htmlFilePaths) {
      const scripts = readProjectHtmlScripts(rootDirectory, filePath);
      if (!scripts || scripts.localEntrypoints.some((entry) => !modulesByFilePath.has(entry))) {
        hasOpaqueRuntimeConsumerSurface = true;
        typedEdges?.opaqueIssuers.add(filePath);
        continue;
      }
      if (typedEdges)
        addTypedProjectTargets(typedEdges.outgoingByIssuer, filePath, scripts.localEntrypoints);
      for (const sourceText of scripts.inlinePrograms) {
        const programNode = parseSourceText({ filename: filePath + ".mjs", sourceText });
        if (!isNodeOfType(programNode, "Program")) {
          hasOpaqueRuntimeConsumerSurface = true;
          typedEdges?.opaqueIssuers.add(filePath);
          continue;
        }
        const scopes = getSourceProjectModuleScopes(programNode);
        if (hasOpaqueHtmlExecution(programNode, scopes)) {
          hasOpaqueRuntimeConsumerSurface = true;
          typedEdges?.opaqueIssuers.add(filePath);
        }
        const opaque = indexModuleSources(
          { filePath, programNode, scopes },
          consumerModulesByFilePath,
          resolvedSourcePathByNode,
          unresolvedRuntimeSources,
          true,
          modulesByFilePath,
          resolveModuleSource,
          typedEdges,
        );
        hasOpaqueRuntimeConsumerSurface ||= opaque;
      }
    }
  }

  return {
    modulesByFilePath,
    htmlFilePaths: productionSourceFiles.htmlFilePaths,
    consumerModulesByFilePath,
    resolvedSourcePathByNode,
    unresolvedRuntimeSources,
    hasOpaqueMdxConsumerSurface: productionSourceFiles.hasOpaqueMdxConsumerSurface,
    hasOpaqueRuntimeConsumerSurface,
    ...(typedEdges
      ? {
          typedEdges: {
            outgoingByIssuer: typedEdges.outgoingByIssuer,
            externalByIssuer: typedEdges.externalByIssuer,
            opaqueIssuers: typedEdges.opaqueIssuers,
          },
        }
      : {}),
  };
};

export const readSelectedTypedSourceClosure = (
  index: SourceProjectIndex,
  selectedRoots: readonly string[],
) => {
  const graph = index.typedEdges;
  if (!graph || !selectedRoots.length) return null;
  const knownHtml = new Set(index.htmlFilePaths);
  const roots = selectedRoots.map(normalizeFilename);
  if (roots.some((root) => !index.modulesByFilePath.has(root) && !knownHtml.has(root))) return null;
  const reachable = new Set<string>();
  const opaqueIssuers = new Set<string>();
  const externalRuntimeSources = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    if (graph.opaqueIssuers.has(current)) opaqueIssuers.add(current);
    for (const source of graph.externalByIssuer.get(current) ?? [])
      externalRuntimeSources.add(source);
    for (const target of graph.outgoingByIssuer.get(current) ?? []) pending.push(target);
  }
  return { reachable, opaqueIssuers, externalRuntimeSources };
};
