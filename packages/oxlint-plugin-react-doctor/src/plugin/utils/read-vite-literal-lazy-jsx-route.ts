import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveImportedJsxComponentName } from "./resolve-imported-jsx-component-name.js";
import {
  DEFAULT_VITE_EXTENSIONS,
  resolveViteSource,
  type EntryKind,
  type StaticAlias,
} from "./resolve-vite-source.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { readProjectHtmlScripts } from "./read-project-html-scripts.js";

export interface ViteLiteralLazyJsxRouteInput {
  readonly projectDirectory: string;
  readonly htmlFile: string;
  readonly focalFile: string;
  readonly aliases: readonly StaticAlias[];
}

export interface ViteLiteralLazyJsxRoute {
  readonly entryFile: string;
  readonly appFile: string;
  readonly lazyFile: string;
  readonly focalFile: string;
}

type Program = EsTreeNodeOfType<"Program">;
type JsxElement = EsTreeNodeOfType<"JSXElement">;
type Opening = EsTreeNodeOfType<"JSXOpeningElement">;

const jsxFilename = /\.[jt]sx$/u;
const literalRootPath = /^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u;
const literalRelativePath = /^\.{1,2}\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u;

const probeEntry = (filename: string): EntryKind => {
  recordExistenceProbe(filename);
  const metadata = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!metadata) return "missing";
  recordRealpathProbe(filename);
  if ((!metadata.isDirectory() && !metadata.isFile()) || fs.realpathSync(filename) !== filename)
    return "unknown";
  if (metadata.isFile()) return "file";
  recordDirectoryProbe(filename);
  return "directory";
};

const readSource = (filename: string): string | null => {
  const bytes = readProviderMember(filename);
  return bytes && bytes.length <= 256 * 1024 ? bytes.toString("utf8") : null;
};

const parseModule = (filename: string): Program | null => {
  const sourceText = readSource(filename);
  const program = sourceText && parseSourceText({ filename, sourceText });
  return isNodeOfType(program, "Program") ? program : null;
};

const directMemberCall = (
  node: EsTreeNode | null | undefined,
  member: string,
): node is EsTreeNodeOfType<"CallExpression"> & { callee: EsTreeNodeOfType<"MemberExpression"> } =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === 1 &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === member;

const renderedRoot = (program: Program, scopes: ScopeAnalysis): JsxElement | null => {
  const statement = program.body.at(-1);
  if (
    !program.body.slice(0, -1).every((node) => isNodeOfType(node, "ImportDeclaration")) ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !directMemberCall(statement.expression, "render")
  )
    return null;
  const render = statement.expression;
  const rootCall = render.callee.object;
  if (
    !isNodeOfType(rootCall, "CallExpression") ||
    rootCall.optional ||
    rootCall.arguments.length !== 1
  )
    return null;
  const api = resolveImportedApiReference(rootCall.callee, scopes);
  if (api?.source !== "react-dom/client" || api.importedName !== "createRoot") return null;
  const container = rootCall.arguments[0];
  if (
    !directMemberCall(container, "getElementById") ||
    !isNodeOfType(container.callee.object, "Identifier") ||
    container.callee.object.name !== "document" ||
    !scopes.isGlobalReference(container.callee.object) ||
    !isNodeOfType(container.arguments[0], "Literal") ||
    typeof container.arguments[0].value !== "string"
  )
    return null;
  const element = render.arguments[0];
  return isNodeOfType(element, "JSXElement") ? element : null;
};

const selectedAppElement = (root: JsxElement, scopes: ScopeAnalysis): Opening | null => {
  const opening = root.openingElement;
  if (opening.selfClosing && opening.attributes.length === 0) return opening;
  const name = opening.name;
  if (
    opening.attributes.length ||
    !isNodeOfType(name, "JSXMemberExpression") ||
    !isNodeOfType(name.object, "JSXIdentifier") ||
    name.property.name !== "StrictMode"
  )
    return null;
  const symbol = scopes.symbolFor(name.object);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !declaration ||
    declaration.source.value !== "react" ||
    declaration.importKind === "type" ||
    (!isNodeOfType(symbol?.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol?.declarationNode, "ImportNamespaceSpecifier"))
  )
    return null;
  const children = root.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim(),
  );
  if (children.length !== 1 || !isNodeOfType(children[0], "JSXElement")) return null;
  const app = children[0].openingElement;
  return app.selfClosing && app.attributes.length === 0 ? app : null;
};

const defaultJsxImport = (opening: Opening, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return null;
  const symbol = scopes.symbolFor(opening.name);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  const source = declaration?.source.value;
  return typeof source === "string" &&
    resolveImportedJsxComponentName(opening, source, scopes) === "default"
    ? source
    : null;
};

const defaultJsxRoot = (module: Program): JsxElement | null => {
  const fn = findExportedValue(module, "default");
  if (
    !isNodeOfType(fn, "FunctionDeclaration") ||
    fn.async ||
    fn.generator ||
    !isNodeOfType(fn.parent, "ExportDefaultDeclaration")
  )
    return null;
  const statements = fn.body.body;
  if (
    !statements
      .slice(0, -1)
      .every(
        (statement) =>
          isNodeOfType(statement, "ExpressionStatement") ||
          isNodeOfType(statement, "VariableDeclaration"),
      )
  )
    return null;
  const ret = statements.at(-1);
  const result =
    isNodeOfType(ret, "ReturnStatement") && ret.argument && stripParenExpression(ret.argument);
  return isNodeOfType(result, "JSXElement") ? result : null;
};

const visitPlainJsx = (
  root: JsxElement,
  visit: (opening: Opening, parent?: Opening) => void,
): void => {
  const pending: Array<{ node: JsxElement; parent?: Opening }> = [{ node: root }];
  while (pending.length > 0) {
    const { node, parent } = pending.pop()!;
    const opening = node.openingElement;
    visit(opening, parent);
    for (const child of node.children) {
      if (isNodeOfType(child, "JSXElement")) pending.push({ node: child, parent: opening });
    }
  }
};

const readLazyImport = (
  opening: Opening,
  parent: Opening,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ImportExpression"> | null => {
  if (
    !opening.selfClosing ||
    opening.attributes.length ||
    resolveImportedJsxComponentName(parent, "react", scopes) !== "Suspense"
  )
    return null;
  const binding = scopes.symbolFor(opening.name);
  if (
    !binding ||
    binding.kind !== "const" ||
    binding.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(binding.declarationNode.parent?.parent, "Program")
  )
    return null;
  const initializer = binding.initializer;
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    scopes.symbolFor(initializer.callee)?.kind !== "import"
  )
    return null;
  const api = resolveImportedApiReference(initializer.callee, scopes);
  const callback = initializer.arguments[0];
  if (
    api?.source !== "react" ||
    api.importedName !== "lazy" ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "ImportExpression") ||
    callback.body.options ||
    !isNodeOfType(callback.body.source, "Literal") ||
    typeof callback.body.source.value !== "string"
  )
    return null;
  return callback.body;
};

const dynamicImports = (module: Program): Array<EsTreeNodeOfType<"ImportExpression">> => {
  const imports: Array<EsTreeNodeOfType<"ImportExpression">> = [];
  walkAst(module, (node) => {
    if (isNodeOfType(node, "ImportExpression")) imports.push(node);
  });
  return imports;
};

const resolveDirectJsx = (
  input: ViteLiteralLazyJsxRouteInput,
  issuer: string,
  specifier: string,
  allowRootRelative = false,
): string | null => {
  const rootRelative = allowRootRelative && literalRootPath.test(specifier);
  if (!rootRelative && !literalRelativePath.test(specifier)) return null;
  const resolved = resolveViteSource({
    fromFilename: issuer,
    specifier,
    projectDirectory: input.projectDirectory,
    aliases: input.aliases,
    probe: probeEntry,
  });
  if (resolved.kind !== "file" || !jsxFilename.test(resolved.filename)) return null;
  const location = rootRelative
    ? path.resolve(input.projectDirectory, "." + specifier)
    : path.resolve(path.dirname(issuer), specifier);
  if (path.extname(location)) return location === resolved.filename ? location : null;
  if (!DEFAULT_VITE_EXTENSIONS.some((extension) => location + extension === resolved.filename))
    return null;
  const candidates = [
    location,
    ...DEFAULT_VITE_EXTENSIONS.map((extension) => location + extension),
  ];
  return candidates.some(
    (candidate) => candidate !== resolved.filename && probeEntry(candidate) !== "missing",
  )
    ? null
    : resolved.filename;
};

// The caller supplies a separately verified default local Vite resolution
// profile. This proves one source path through JSX; it does not model the
// effects of imported ancestors, compiler transforms or application startup.
export const readViteLiteralLazyJsxRoute = (
  input: ViteLiteralLazyJsxRouteInput,
): ViteLiteralLazyJsxRoute | null => {
  try {
    const { projectDirectory, htmlFile, focalFile } = input;
    if (
      !path.isAbsolute(projectDirectory) ||
      !path.isAbsolute(htmlFile) ||
      !path.isAbsolute(focalFile) ||
      !isPathInside(htmlFile, projectDirectory) ||
      !isPathInside(focalFile, projectDirectory) ||
      probeEntry(projectDirectory) !== "directory"
    )
      return null;
    const html = readProjectHtmlScripts(projectDirectory, htmlFile, {
      onlyLocalModuleScripts: true,
      rejectHtmlTemplates: true,
      readSource,
      resolveLocalEntrypoint: (issuer, request) => resolveDirectJsx(input, issuer, request, true),
    });
    if (!html || html.inlinePrograms.length || html.localEntrypoints.length !== 1) return null;
    const entryFile = html.localEntrypoints[0];
    const entry = parseModule(entryFile);
    if (!entry) return null;
    const entryScopes = analyzeScopes(entry);
    const htmlRoot = renderedRoot(entry, entryScopes);
    const appOpening = htmlRoot && selectedAppElement(htmlRoot, entryScopes);
    const appImport = appOpening && defaultJsxImport(appOpening, entryScopes);
    const appFile = appImport && resolveDirectJsx(input, entryFile, appImport);
    const app = appFile && parseModule(appFile);
    if (!app || !appFile) return null;

    const appRoot = defaultJsxRoot(app);
    if (!appRoot) return null;
    const appScopes = analyzeScopes(app);
    const possibleLazy = new Set<EsTreeNodeOfType<"ImportExpression">>();
    visitPlainJsx(appRoot, (opening, parent) => {
      const imported = parent && readLazyImport(opening, parent, appScopes);
      if (imported) possibleLazy.add(imported);
    });
    const [selectedLazy, extra] = dynamicImports(app);
    if (
      !selectedLazy ||
      extra ||
      !possibleLazy.has(selectedLazy) ||
      !isNodeOfType(selectedLazy.source, "Literal") ||
      typeof selectedLazy.source.value !== "string"
    )
      return null;
    const lazyFile = resolveDirectJsx(input, appFile, selectedLazy.source.value);
    const lazy = lazyFile && parseModule(lazyFile);
    if (!lazy || !lazyFile || dynamicImports(lazy).length > 0) return null;
    const lazyRoot = defaultJsxRoot(lazy);
    if (!lazyRoot) return null;
    const lazyScopes = analyzeScopes(lazy);
    let matchingUses = 0;
    visitPlainJsx(lazyRoot, (opening) => {
      if (!opening.selfClosing || opening.attributes.length) return;
      const imported = defaultJsxImport(opening, lazyScopes);
      if (imported && resolveDirectJsx(input, lazyFile, imported) === focalFile) matchingUses += 1;
    });
    if (matchingUses !== 1) return null;
    const focal = parseModule(focalFile);
    const exported = focal && findExportedValue(focal, "default");
    return isNodeOfType(exported, "FunctionDeclaration") && !exported.async && !exported.generator
      ? { entryFile, appFile, lazyFile, focalFile }
      : null;
  } catch {
    return null;
  }
};
