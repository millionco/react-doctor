import { TANSTACK_FORM_OPTIONS_ARGUMENT_COUNT } from "../constants/tanstack.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const readonlyFormBindingReferences = new WeakMap<SymbolDescriptor, boolean>();

const hasReadonlyFormBindingReferences = (symbol: SymbolDescriptor): boolean => {
  let hasReadonlyReferences = readonlyFormBindingReferences.get(symbol);
  if (hasReadonlyReferences === undefined) {
    hasReadonlyReferences = symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
    readonlyFormBindingReferences.set(symbol, hasReadonlyReferences);
  }
  return hasReadonlyReferences;
};

const isReadonlyFormFactory = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !hasReadonlyFormBindingReferences(symbol) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !declaration.init
  )
    return false;

  const propertyNames = new Set<string>();
  let hasSelectedProperty = false;
  for (const property of declaration.id.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      propertyNames.has(property.key.name)
    )
      return false;
    propertyNames.add(property.key.name);
    if (property.key.name === "withForm" && property.value === symbol.bindingIdentifier)
      hasSelectedProperty = true;
  }
  if (!hasSelectedProperty) return false;

  const initializer = stripParenExpression(declaration.init);
  if (!isNodeOfType(initializer, "CallExpression") || initializer.optional) return false;
  const callee = stripParenExpression(initializer.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const factorySymbol = scopes.symbolFor(callee);
  if (factorySymbol?.kind !== "import" || !hasReadonlyFormBindingReferences(factorySymbol))
    return false;
  const imported = resolveImportedApiReference(callee, scopes);
  return imported?.source === "@tanstack/react-form" && imported.importedName === "createFormHook";
};

const isImportedFormFactory = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  filename: string,
): boolean => {
  if (symbol.kind !== "import" || !hasReadonlyFormBindingReferences(symbol)) return false;
  const imported = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
  if (!imported?.importedName || imported.isNamespace) return false;
  const providerFilename = resolveModulePath(filename, imported.source);
  if (!providerFilename) return false;
  const provider = parseSourceFile(providerFilename);
  if (!isNodeOfType(provider, "Program")) return false;
  const providerScopes = analyzeScopes(provider);
  let selectedSymbol: SymbolDescriptor | null = null;
  for (const statement of provider.body) {
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      statement.exportKind === "type" ||
      !isNodeOfType(statement.declaration, "VariableDeclaration") ||
      statement.declaration.kind !== "const"
    )
      continue;
    for (const declaration of statement.declaration.declarations) {
      if (!isNodeOfType(declaration.id, "ObjectPattern")) continue;
      for (const property of declaration.id.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          !isNodeOfType(property.value, "Identifier") ||
          property.value.name !== imported.importedName
        )
          continue;
        const candidate = providerScopes.symbolFor(property.value);
        if (!candidate || selectedSymbol) return false;
        selectedSymbol = candidate;
      }
    }
  }
  return selectedSymbol !== null && isReadonlyFormFactory(selectedSymbol, providerScopes);
};

const isReadonlyJsxMountedResult = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callRoot = findTransparentExpressionRoot(call);
  const declaration = callRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== callRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const statementParent = declaration.parent.parent;
  if (
    !isNodeOfType(statementParent, "Program") &&
    !(
      isNodeOfType(statementParent, "ExportNamedDeclaration") &&
      isNodeOfType(statementParent.parent, "Program")
    )
  )
    return false;
  const symbol = scopes.symbolFor(declaration.id);
  if (symbol?.kind !== "const" || !hasReadonlyFormBindingReferences(symbol)) return false;
  let hasJsxOpening = false;
  const hasOnlyJsxReferences = symbol.references.every((reference) => {
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (
      !isNodeOfType(identifier, "JSXIdentifier") ||
      !(isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) ||
      parent.name !== identifier
    )
      return false;
    if (parent.type === "JSXOpeningElement") hasJsxOpening = true;
    return true;
  });
  return hasOnlyJsxReferences && hasJsxOpening;
};

export const collectTanstackFormRenderFunctions = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): ReadonlySet<EsTreeNode> => {
  const renderFunctions = new Set<EsTreeNode>();
  const factoryOrigins = new Map<SymbolDescriptor, boolean>();
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.arguments.length !== TANSTACK_FORM_OPTIONS_ARGUMENT_COUNT ||
      !isReadonlyJsxMountedResult(node, scopes)
    )
      return;
    const options = stripParenExpression(node.arguments[0]);
    if (!isNodeOfType(options, "ObjectExpression")) return;
    let renderFunction: EsTreeNode | null = null;
    const propertyNames = new Set<string>();
    for (const property of options.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.kind !== "init" ||
        property.method ||
        !isNodeOfType(property.key, "Identifier") ||
        propertyNames.has(property.key.name)
      )
        return;
      propertyNames.add(property.key.name);
      if (property.key.name !== "render") continue;
      const value = stripParenExpression(property.value);
      if (!isFunctionLike(value) || value.async || value.generator) return;
      if (
        isNodeOfType(value, "FunctionExpression") &&
        value.id &&
        scopes.symbolFor(value.id)?.references.length !== 0
      )
        return;
      renderFunction = value;
    }
    if (!renderFunction) return;
    const callee = stripParenExpression(node.callee);
    if (!isNodeOfType(callee, "Identifier")) return;
    const symbol = scopes.symbolFor(callee);
    if (!symbol) return;
    let hasFormFactoryOrigin = factoryOrigins.get(symbol);
    if (hasFormFactoryOrigin === undefined) {
      hasFormFactoryOrigin =
        isReadonlyFormFactory(symbol, scopes) ||
        (filename !== undefined && isImportedFormFactory(symbol, scopes, filename));
      factoryOrigins.set(symbol, hasFormFactoryOrigin);
    }
    if (hasFormFactoryOrigin) renderFunctions.add(renderFunction);
  });
  return renderFunctions;
};
