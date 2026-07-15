import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findExportedValue } from "./find-exported-value.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTestlikeFilename } from "./is-testlike-filename.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface GeneratedImageModule {
  readonly filePath: string;
  readonly programNode: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
}

interface GeneratedImageExportIdentity {
  readonly filePath: string;
  readonly exportedName: string;
}

interface GeneratedImageOwnershipState {
  readonly modules: ReadonlyArray<GeneratedImageModule>;
  readonly pendingExports: GeneratedImageExportIdentity[];
  readonly visitedExportKeys: Set<string>;
  currentExportWasUsed: boolean;
  didReachRenderer: boolean;
}

const GENERATED_IMAGE_SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const GENERATED_IMAGE_DECLARATION_FILE_PATTERN = /\.d\.[cm]?[jt]s$/i;
const GENERATED_IMAGE_RENDERER_MODULES: ReadonlySet<string> = new Set(["next/og", "@vercel/og"]);
const GENERATED_IMAGE_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
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
const generatedImageScopeCache = new WeakMap<EsTreeNodeOfType<"Program">, ScopeAnalysis>();

const getGeneratedImageModuleScopes = (programNode: EsTreeNodeOfType<"Program">): ScopeAnalysis => {
  const cachedScopes = generatedImageScopeCache.get(programNode);
  if (cachedScopes) return cachedScopes;
  const scopes = analyzeScopes(programNode);
  generatedImageScopeCache.set(programNode, scopes);
  return scopes;
};

const getImportDeclaration = (node: EsTreeNode): EsTreeNodeOfType<"ImportDeclaration"> | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "ImportDeclaration")) return cursor;
    if (isNodeOfType(cursor, "Program")) return null;
    cursor = cursor.parent;
  }
  return null;
};

const getExportedSpecifierName = (
  specifier: EsTreeNodeOfType<"ExportSpecifier">,
): string | null => {
  const exported = specifier.exported;
  if (isNodeOfType(exported, "Identifier")) return exported.name;
  return isNodeOfType(exported, "Literal") && typeof exported.value === "string"
    ? exported.value
    : null;
};

const getImportedSpecifierName = (
  specifier: EsTreeNodeOfType<"ExportSpecifier">,
): string | null => {
  const local = specifier.local;
  if (isNodeOfType(local, "Identifier")) return local.name;
  return isNodeOfType(local, "Literal") && typeof local.value === "string" ? local.value : null;
};

const getImportSpecifierName = (specifier: EsTreeNode): string | null => {
  if (isNodeOfType(specifier, "ImportDefaultSpecifier")) return "default";
  if (!isNodeOfType(specifier, "ImportSpecifier")) return null;
  const imported = specifier.imported;
  if (isNodeOfType(imported, "Identifier")) return imported.name;
  return isNodeOfType(imported, "Literal") && typeof imported.value === "string"
    ? imported.value
    : null;
};

const getExportNamesForFunction = (
  programNode: EsTreeNodeOfType<"Program">,
  functionNode: EsTreeNode,
): ReadonlyArray<string> => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  const bindingName = bindingIdentifier?.name ?? null;
  const exportedNames = new Set<string>();

  for (const statement of programNode.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (
        statement.declaration === functionNode ||
        (bindingName &&
          isNodeOfType(statement.declaration, "Identifier") &&
          statement.declaration.name === bindingName)
      ) {
        exportedNames.add("default");
      }
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    const declaration = statement.declaration;
    if (declaration === functionNode && bindingName) exportedNames.add(bindingName);
    if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations) {
        if (declarator.init === functionNode && isNodeOfType(declarator.id, "Identifier")) {
          exportedNames.add(declarator.id.name);
        }
      }
    }
    if (!bindingName || statement.source) continue;
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
      if (getImportedSpecifierName(specifier) !== bindingName) continue;
      const exportedName = getExportedSpecifierName(specifier);
      if (exportedName) exportedNames.add(exportedName);
    }
  }

  return [...exportedNames];
};

const listProductionSourceFilePaths = (rootDirectory: string): ReadonlyArray<string> | null => {
  const sourceFilePaths: string[] = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const isIgnoredDirectoryName =
        GENERATED_IMAGE_IGNORED_DIRECTORY_NAMES.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".dumi" && entry.name !== ".storybook");
      if (entry.isSymbolicLink() && isIgnoredDirectoryName) continue;
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName) continue;
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!GENERATED_IMAGE_SOURCE_FILE_PATTERN.test(entry.name)) continue;
      if (GENERATED_IMAGE_DECLARATION_FILE_PATTERN.test(entry.name)) continue;
      if (isTestlikeFilename(absolutePath)) continue;
      sourceFilePaths.push(normalizeFilename(absolutePath));
    }
  }

  return sourceFilePaths;
};

const buildGeneratedImageModules = (
  rootDirectory: string,
  currentFilePath: string,
  currentProgramNode: EsTreeNodeOfType<"Program">,
  currentScopes: ScopeAnalysis,
): ReadonlyArray<GeneratedImageModule> | null => {
  const sourceFilePaths = listProductionSourceFilePaths(rootDirectory);
  if (!sourceFilePaths) return null;
  const modules: GeneratedImageModule[] = [];
  for (const filePath of sourceFilePaths) {
    if (filePath === currentFilePath) {
      modules.push({ filePath, programNode: currentProgramNode, scopes: currentScopes });
      continue;
    }
    const parsedProgram = parseSourceFile(filePath);
    if (!parsedProgram || !isNodeOfType(parsedProgram, "Program")) return null;
    modules.push({
      filePath,
      programNode: parsedProgram,
      scopes: getGeneratedImageModuleScopes(parsedProgram),
    });
  }
  return modules;
};

const getImportSource = (declaration: EsTreeNodeOfType<"ImportDeclaration">): string | null =>
  typeof declaration.source.value === "string" ? declaration.source.value : null;

const isImportFromModule = (
  declaration: EsTreeNodeOfType<"ImportDeclaration">,
  moduleSource: string,
): boolean => getImportSource(declaration) === moduleSource;

const isNamedRendererImport = (
  symbol: SymbolDescriptor,
  importedName: string,
  moduleSources: ReadonlySet<string>,
): boolean => {
  if (symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "ImportSpecifier")) return false;
  const importDeclaration = getImportDeclaration(declaration);
  if (!importDeclaration) return false;
  const source = getImportSource(importDeclaration);
  if (!source || !moduleSources.has(source)) return false;
  const imported = declaration.imported;
  return (
    (isNodeOfType(imported, "Identifier") && imported.name === importedName) ||
    (isNodeOfType(imported, "Literal") && imported.value === importedName)
  );
};

const isSatoriImport = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  const importDeclaration = getImportDeclaration(declaration);
  if (!importDeclaration || !isImportFromModule(importDeclaration, "satori")) return false;
  if (isNodeOfType(declaration, "ImportDefaultSpecifier")) return true;
  if (!isNodeOfType(declaration, "ImportSpecifier")) return false;
  const imported = declaration.imported;
  return (
    (isNodeOfType(imported, "Identifier") && imported.name === "satori") ||
    (isNodeOfType(imported, "Literal") && imported.value === "satori")
  );
};

const isGeneratedImageRendererCallee = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isNodeOfType(unwrappedCallee, "Identifier")) {
    const symbol = scopes.referenceFor(unwrappedCallee)?.resolvedSymbol ?? null;
    return Boolean(
      symbol &&
      (isNamedRendererImport(symbol, "ImageResponse", GENERATED_IMAGE_RENDERER_MODULES) ||
        isSatoriImport(symbol)),
    );
  }
  if (!isNodeOfType(unwrappedCallee, "MemberExpression")) return false;
  if (getStaticPropertyName(unwrappedCallee) !== "ImageResponse") return false;
  if (!isNodeOfType(unwrappedCallee.object, "Identifier")) return false;
  const symbol = scopes.referenceFor(unwrappedCallee.object)?.resolvedSymbol ?? null;
  if (!symbol || symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "ImportNamespaceSpecifier")) return false;
  const importDeclaration = getImportDeclaration(declaration);
  const source = importDeclaration ? getImportSource(importDeclaration) : null;
  return Boolean(source && GENERATED_IMAGE_RENDERER_MODULES.has(source));
};

const isTransparentGeneratedImageValueFlow = (
  expression: EsTreeNode,
  target: EsTreeNode,
): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (current !== target) {
    const parent = current.parent;
    if (!parent) return false;
    const isTransparentParent =
      ((isNodeOfType(parent, "JSXExpressionContainer") || isNodeOfType(parent, "JSXSpreadChild")) &&
        parent.expression === current) ||
      ((isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
        parent.children.some((child) => child === current)) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === current || parent.right === current)) ||
      (isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === current)) ||
      (isNodeOfType(parent, "SequenceExpression") &&
        parent.expressions.some((sequenceExpression) => sequenceExpression === current)) ||
      (isNodeOfType(parent, "AwaitExpression") && parent.argument === current);
    if (!isTransparentParent) return false;
    current = findTransparentExpressionRoot(parent);
  }
  return true;
};

const isInsideGeneratedImageRendererArgument = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let cursor: EsTreeNode | null | undefined = expression;
  while (cursor?.parent) {
    const parent: EsTreeNode = cursor.parent;
    if (isFunctionLike(parent)) return false;
    if (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) {
      if (
        parent.arguments[0] &&
        isTransparentGeneratedImageValueFlow(expression, parent.arguments[0]) &&
        isGeneratedImageRendererCallee(parent.callee, scopes)
      ) {
        return true;
      }
    }
    cursor = parent;
  }
  return false;
};

const getInvokedExpression = (identifier: EsTreeNode): EsTreeNode | null => {
  const referenceExpression = findTransparentExpressionRoot(identifier);
  const parent = referenceExpression.parent;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === referenceExpression)
    return parent;
  if (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === referenceExpression) {
    return parent;
  }
  if (
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === identifier
  ) {
    const element = parent.parent;
    return isNodeOfType(element, "JSXElement") ? element : null;
  }
  return null;
};

const getForwardingFunction = (expression: EsTreeNode): EsTreeNode | null => {
  const enclosingFunction = findEnclosingFunction(expression);
  if (!enclosingFunction) return null;
  if (
    isNodeOfType(enclosingFunction, "ArrowFunctionExpression") &&
    !isNodeOfType(enclosingFunction.body, "BlockStatement") &&
    isTransparentGeneratedImageValueFlow(expression, enclosingFunction.body)
  ) {
    return enclosingFunction;
  }
  let cursor: EsTreeNode | null | undefined = expression.parent;
  while (cursor && cursor !== enclosingFunction) {
    if (isFunctionLike(cursor)) return null;
    if (
      isNodeOfType(cursor, "ReturnStatement") &&
      cursor.argument &&
      isTransparentGeneratedImageValueFlow(expression, cursor.argument)
    ) {
      return enclosingFunction;
    }
    cursor = cursor.parent;
  }
  return null;
};

const enqueueExport = (
  state: GeneratedImageOwnershipState,
  filePath: string,
  exportedName: string,
): void => {
  state.pendingExports.push({ filePath: normalizeFilename(filePath), exportedName });
};

const classifyInvokedExpression = (
  module: GeneratedImageModule,
  expression: EsTreeNode,
  state: GeneratedImageOwnershipState,
): boolean => {
  if (isInsideGeneratedImageRendererArgument(expression, module.scopes)) {
    state.didReachRenderer = true;
    return true;
  }
  const forwardingFunction = getForwardingFunction(expression);
  if (!forwardingFunction) return false;
  const exportedNames = getExportNamesForFunction(module.programNode, forwardingFunction);
  if (exportedNames.length === 0) return false;
  for (const exportedName of exportedNames) enqueueExport(state, module.filePath, exportedName);
  return true;
};

const classifySymbolReferences = (
  module: GeneratedImageModule,
  symbol: SymbolDescriptor,
  state: GeneratedImageOwnershipState,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return true;
  visitedSymbolIds.add(symbol.id);

  for (const reference of symbol.references) {
    if (reference.flag !== "read") return false;
    state.currentExportWasUsed = true;
    const identifier = reference.identifier;
    const invokedExpression = getInvokedExpression(identifier);
    if (invokedExpression) {
      if (!classifyInvokedExpression(module, invokedExpression, state)) return false;
      continue;
    }
    const parent = identifier.parent;
    if (isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier) {
      const exportedName = getExportedSpecifierName(parent);
      if (!exportedName) return false;
      enqueueExport(state, module.filePath, exportedName);
      continue;
    }
    if (isNodeOfType(parent, "ExportDefaultDeclaration")) {
      enqueueExport(state, module.filePath, "default");
      continue;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === identifier &&
      isNodeOfType(parent.id, "Identifier") &&
      isNodeOfType(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    ) {
      const aliasSymbol = module.scopes.symbolFor(parent.id);
      if (!aliasSymbol || !classifySymbolReferences(module, aliasSymbol, state, visitedSymbolIds)) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
};

const classifyNamespaceImportReferences = (
  module: GeneratedImageModule,
  symbol: SymbolDescriptor,
  exportedName: string,
  state: GeneratedImageOwnershipState,
): boolean => {
  for (const reference of symbol.references) {
    if (reference.flag !== "read") return false;
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== identifier) return false;
    const propertyName = getStaticPropertyName(parent);
    if (propertyName === null) return false;
    if (propertyName !== exportedName) continue;
    state.currentExportWasUsed = true;
    const invokedExpression = getInvokedExpression(parent);
    if (!invokedExpression || !classifyInvokedExpression(module, invokedExpression, state)) {
      return false;
    }
  }
  return true;
};

const resolveSourceMatchesExport = (
  moduleFilePath: string,
  source: string,
  exportIdentity: GeneratedImageExportIdentity,
): boolean =>
  normalizeFilename(resolveModulePath(moduleFilePath, source) ?? "") === exportIdentity.filePath;

const classifyImportsFromExport = (
  module: GeneratedImageModule,
  exportIdentity: GeneratedImageExportIdentity,
  state: GeneratedImageOwnershipState,
): boolean => {
  for (const statement of module.programNode.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      const source = getImportSource(statement);
      if (!source || !resolveSourceMatchesExport(module.filePath, source, exportIdentity)) continue;
      if (statement.importKind === "type") continue;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          const namespaceSymbol = module.scopes.symbolFor(specifier.local);
          if (
            !namespaceSymbol ||
            !classifyNamespaceImportReferences(
              module,
              namespaceSymbol,
              exportIdentity.exportedName,
              state,
            )
          ) {
            return false;
          }
          continue;
        }
        const importedName = getImportSpecifierName(specifier);
        if (importedName !== exportIdentity.exportedName) continue;
        const symbol = module.scopes.symbolFor(specifier.local);
        if (!symbol || !classifySymbolReferences(module, symbol, state, new Set())) return false;
      }
      continue;
    }
    if (
      (isNodeOfType(statement, "ExportNamedDeclaration") ||
        isNodeOfType(statement, "ExportAllDeclaration")) &&
      statement.source &&
      typeof statement.source.value === "string" &&
      resolveSourceMatchesExport(module.filePath, statement.source.value, exportIdentity)
    ) {
      if (isNodeOfType(statement, "ExportAllDeclaration")) {
        if (statement.exported) return false;
        state.currentExportWasUsed = true;
        enqueueExport(state, module.filePath, exportIdentity.exportedName);
        continue;
      }
      for (const specifier of statement.specifiers) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        if (getImportedSpecifierName(specifier) !== exportIdentity.exportedName) continue;
        const exportedName = getExportedSpecifierName(specifier);
        if (!exportedName) return false;
        state.currentExportWasUsed = true;
        enqueueExport(state, module.filePath, exportedName);
      }
    }
  }
  return true;
};

const hasOpaqueDynamicImportOfExport = (
  module: GeneratedImageModule,
  exportIdentity: GeneratedImageExportIdentity,
): boolean => {
  let isOpaque = false;
  walkAst(module.programNode, (node) => {
    if (isOpaque) return false;
    if (isNodeOfType(node, "ImportExpression")) {
      const source = node.source;
      if (
        isNodeOfType(source, "Literal") &&
        typeof source.value === "string" &&
        resolveSourceMatchesExport(module.filePath, source.value, exportIdentity)
      ) {
        isOpaque = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    ) {
      const source = node.arguments[0];
      if (
        source &&
        isNodeOfType(source, "Literal") &&
        typeof source.value === "string" &&
        resolveSourceMatchesExport(module.filePath, source.value, exportIdentity)
      ) {
        isOpaque = true;
        return false;
      }
    }
  });
  return isOpaque;
};

const classifyLocalExportReferences = (
  module: GeneratedImageModule,
  exportIdentity: GeneratedImageExportIdentity,
  state: GeneratedImageOwnershipState,
): boolean => {
  const exportedValue = findExportedValue(module.programNode, exportIdentity.exportedName);
  if (!exportedValue || !isFunctionLike(exportedValue)) return true;
  const bindingIdentifier = getFunctionBindingIdentifier(exportedValue);
  if (!bindingIdentifier) return true;
  const symbol = module.scopes.symbolFor(bindingIdentifier);
  return symbol ? classifySymbolReferences(module, symbol, state, new Set()) : false;
};

export const isExportedJsxOwnedByGeneratedImageRenderers = (
  context: RuleContext,
  jsxNode: EsTreeNode,
): boolean => {
  const filename = context.filename ? normalizeFilename(context.filename) : "";
  const rootDirectorySetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!filename || !rootDirectorySetting) return false;
  const rootDirectory = normalizeFilename(rootDirectorySetting).replace(/\/$/, "");
  if (filename !== rootDirectory && !filename.startsWith(`${rootDirectory}/`)) return false;

  const programNode = findProgramRoot(jsxNode);
  const enclosingFunction = findEnclosingFunction(jsxNode);
  if (!programNode || !enclosingFunction) return false;
  const initialExportNames = getExportNamesForFunction(programNode, enclosingFunction);
  if (initialExportNames.length === 0) return false;

  const modules = buildGeneratedImageModules(rootDirectory, filename, programNode, context.scopes);
  if (!modules) return false;
  const state: GeneratedImageOwnershipState = {
    modules,
    pendingExports: initialExportNames.map((exportedName) => ({
      filePath: filename,
      exportedName,
    })),
    visitedExportKeys: new Set(),
    currentExportWasUsed: false,
    didReachRenderer: false,
  };

  while (state.pendingExports.length > 0) {
    const exportIdentity = state.pendingExports.pop();
    if (!exportIdentity) continue;
    const exportKey = `${exportIdentity.filePath}\0${exportIdentity.exportedName}`;
    if (state.visitedExportKeys.has(exportKey)) continue;
    state.visitedExportKeys.add(exportKey);
    state.currentExportWasUsed = false;

    const ownerModule = modules.find((module) => module.filePath === exportIdentity.filePath);
    if (!ownerModule || !classifyLocalExportReferences(ownerModule, exportIdentity, state)) {
      return false;
    }
    for (const module of modules) {
      if (module.filePath === exportIdentity.filePath) continue;
      if (hasOpaqueDynamicImportOfExport(module, exportIdentity)) return false;
      if (!classifyImportsFromExport(module, exportIdentity, state)) return false;
    }
    if (!state.currentExportWasUsed) return false;
  }

  return state.didReachRenderer;
};
