import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isDirectJsxRenderChild } from "./is-direct-jsx-render-child.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

export interface ClosedJsxCallSite {
  readonly module: SourceProjectModule;
  readonly opening: EsTreeNodeOfType<"JSXOpeningElement">;
}

export const getClosedJsxCallSites = (
  owner: SourceProjectModule,
  functionNode: EsTreeNode,
  project: SourceProjectIndex,
): ReadonlyArray<ClosedJsxCallSite> | null => {
  if (!isFunctionLike(functionNode) || findProgramRoot(functionNode) !== owner.programNode) {
    return null;
  }

  const functionRoot = findTransparentExpressionRoot(functionNode);
  const bindingIdentifier = getDirectFunctionBindingIdentifier(functionNode);
  const bindingDeclaration = bindingIdentifier?.parent;
  const declaration = isNodeOfType(bindingDeclaration, "VariableDeclarator")
    ? bindingDeclaration.parent
    : functionRoot;
  const exportDeclaration = declaration?.parent;
  const exportedName =
    isNodeOfType(exportDeclaration, "ExportDefaultDeclaration") &&
    exportDeclaration.declaration === functionRoot
      ? "default"
      : isNodeOfType(exportDeclaration, "ExportNamedDeclaration") &&
          exportDeclaration.declaration === declaration
        ? (bindingIdentifier?.name ?? null)
        : null;
  if (!bindingIdentifier && exportedName !== "default") return null;

  const callSites = new Map<EsTreeNodeOfType<"JSXOpeningElement">, ClosedJsxCallSite>();
  const collectReferences = (module: SourceProjectModule, symbol: SymbolDescriptor): boolean => {
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      const tag = identifier.parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(tag, "JSXOpeningElement") && !isNodeOfType(tag, "JSXClosingElement")) ||
        tag.name !== identifier
      ) {
        return false;
      }
      const element = tag.parent;
      if (!isNodeOfType(element, "JSXElement")) return false;
      const opening = element.openingElement;
      if (
        module.scopes.referenceFor(opening.name)?.resolvedSymbol !== symbol ||
        !isDirectJsxRenderChild(opening, module.scopes)
      )
        return false;
      callSites.set(opening, { module, opening });
    }
    return true;
  };

  const collectBinding = (module: SourceProjectModule, binding: EsTreeNode): boolean => {
    const symbol = module.scopes.symbolFor(binding);
    return Boolean(
      symbol && symbol.bindingIdentifier === binding && collectReferences(module, symbol),
    );
  };

  if (bindingIdentifier && !collectBinding(owner, bindingIdentifier)) return null;
  if (bindingIdentifier && isNodeOfType(functionNode, "FunctionDeclaration")) {
    const outer = owner.scopes.scopeFor(functionNode).symbolsByName.get(bindingIdentifier.name);
    if (
      !outer ||
      outer.bindingIdentifier !== bindingIdentifier ||
      outer.declarationNode !== functionNode ||
      !collectReferences(owner, outer)
    )
      return null;
  }
  if (
    isNodeOfType(functionNode, "FunctionExpression") &&
    functionNode.id &&
    !collectBinding(owner, functionNode.id)
  ) {
    return null;
  }
  if (exportedName === null) return [...callSites.values()];

  for (const consumer of project.consumerModulesByFilePath.get(owner.filePath) ?? []) {
    let isClosed = true;
    walkAst(consumer.programNode, (node) => {
      if (!isClosed) return false;
      if (project.resolvedSourcePathByNode.get(node) !== owner.filePath) return;
      if (!isNodeOfType(node, "ImportDeclaration")) {
        isClosed = false;
        return false;
      }
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          isClosed = false;
          return false;
        }
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const importedName = isNodeOfType(specifier, "ImportSpecifier")
          ? getModuleSpecifierName(specifier.imported)
          : "default";
        if (importedName === exportedName && !collectBinding(consumer, specifier.local)) {
          isClosed = false;
          return false;
        }
      }
    });
    if (!isClosed) return null;
  }
  return [...callSites.values()];
};
