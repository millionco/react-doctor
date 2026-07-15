import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  buildGeneratedImageProjectIndex,
  type GeneratedImageModule,
  type GeneratedImageProjectIndex,
} from "./build-generated-image-project-index.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findExportedValue } from "./find-exported-value.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGeneratedImageRendererCall } from "./is-generated-image-renderer-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

interface GeneratedImageExportIdentity {
  readonly filePath: string;
  readonly exportedName: string;
}

interface GeneratedImageOwnershipState {
  readonly projectIndex: GeneratedImageProjectIndex;
  readonly pendingExports: GeneratedImageExportIdentity[];
  readonly visitedExportKeys: Set<string>;
  currentExportWasUsed: boolean;
  didReachRenderer: boolean;
}

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

const getDirectFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id;
  }
  const functionValueRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionValueRoot.parent;
  return isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionValueRoot &&
    isNodeOfType(parent.id, "Identifier")
    ? parent.id
    : null;
};

const getExportNamesForFunction = (
  programNode: EsTreeNodeOfType<"Program">,
  functionNode: EsTreeNode,
): ReadonlyArray<string> => {
  const functionValueRoot = findTransparentExpressionRoot(functionNode);
  const bindingIdentifier = getDirectFunctionBindingIdentifier(functionNode);
  const bindingName = bindingIdentifier?.name ?? null;
  const exportedNames = new Set<string>();

  for (const statement of programNode.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (
        statement.declaration === functionValueRoot ||
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
    if (declaration === functionValueRoot && bindingName) exportedNames.add(bindingName);
    if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations) {
        if (declarator.init === functionValueRoot && isNodeOfType(declarator.id, "Identifier")) {
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
      (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === current) ||
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
        isGeneratedImageRendererCall(parent, scopes)
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

const classifyImportsFromExport = (
  module: GeneratedImageModule,
  exportIdentity: GeneratedImageExportIdentity,
  state: GeneratedImageOwnershipState,
): boolean => {
  for (const statement of module.programNode.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (state.projectIndex.resolvedSourcePathByNode.get(statement) !== exportIdentity.filePath) {
        continue;
      }
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
      state.projectIndex.resolvedSourcePathByNode.get(statement) === exportIdentity.filePath
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
  projectIndex: GeneratedImageProjectIndex,
): boolean => {
  let isOpaque = false;
  walkAst(module.programNode, (node) => {
    if (isOpaque) return false;
    if (isNodeOfType(node, "ImportExpression")) {
      if (projectIndex.resolvedSourcePathByNode.get(node) === exportIdentity.filePath) {
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
      if (projectIndex.resolvedSourcePathByNode.get(node) === exportIdentity.filePath) {
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
  const bindingIdentifier = getDirectFunctionBindingIdentifier(exportedValue);
  if (!bindingIdentifier) return true;
  const symbol = module.scopes.symbolFor(bindingIdentifier);
  return symbol ? classifySymbolReferences(module, symbol, state, new Set()) : false;
};

const hasOpaqueWorkspacePackageConsumer = (
  projectIndex: GeneratedImageProjectIndex,
  exportIdentity: GeneratedImageExportIdentity,
): boolean => {
  const packageName = readNearestPackageManifest(exportIdentity.filePath)?.name;
  if (typeof packageName !== "string" || packageName.length === 0) return false;
  for (const unresolvedSource of projectIndex.unresolvedRuntimeSources) {
    if (unresolvedSource === packageName || unresolvedSource.startsWith(`${packageName}/`)) {
      return true;
    }
  }
  return false;
};

export const createExportedJsxGeneratedImageOwnershipAnalyzer = (context: RuleContext) => {
  const filename = context.filename ? normalizeFilename(context.filename) : "";
  const rootDirectorySetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const rootDirectory = rootDirectorySetting
    ? normalizeFilename(rootDirectorySetting).replace(/\/$/, "")
    : "";
  const isFileInsideRoot =
    Boolean(filename && rootDirectory) &&
    (filename === rootDirectory || filename.startsWith(`${rootDirectory}/`));
  let projectIndex: GeneratedImageProjectIndex | null | undefined;

  return (jsxNode: EsTreeNode): boolean => {
    if (!isFileInsideRoot) return false;
    const programNode = findProgramRoot(jsxNode);
    const enclosingFunction = findEnclosingFunction(jsxNode);
    if (!programNode || !enclosingFunction) return false;
    const initialExportNames = getExportNamesForFunction(programNode, enclosingFunction);
    if (initialExportNames.length === 0) return false;

    if (projectIndex === undefined) {
      projectIndex = buildGeneratedImageProjectIndex(
        rootDirectory,
        filename,
        programNode,
        context.scopes,
      );
    }
    if (!projectIndex || projectIndex.hasOpaqueMdxConsumerSurface) return false;
    const state: GeneratedImageOwnershipState = {
      projectIndex,
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
      if (hasOpaqueWorkspacePackageConsumer(projectIndex, exportIdentity)) return false;

      const ownerModule = projectIndex.modulesByFilePath.get(exportIdentity.filePath);
      if (!ownerModule || !classifyLocalExportReferences(ownerModule, exportIdentity, state)) {
        return false;
      }
      const consumerModules =
        projectIndex.consumerModulesByFilePath.get(exportIdentity.filePath) ?? [];
      for (const module of consumerModules) {
        if (module.filePath === exportIdentity.filePath) continue;
        if (hasOpaqueDynamicImportOfExport(module, exportIdentity, projectIndex)) return false;
        if (!classifyImportsFromExport(module, exportIdentity, state)) return false;
      }
      if (!state.currentExportWasUsed) return false;
    }

    return state.didReachRenderer;
  };
};
