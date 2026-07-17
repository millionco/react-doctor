import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getSymbolMutationInspector } from "./get-symbol-mutation-inspector.js";

const isExpectedModuleName = (actualModuleName: string, expectedModuleName: string): boolean =>
  expectedModuleName === "katex"
    ? actualModuleName === "katex" || actualModuleName.startsWith("katex/")
    : actualModuleName === expectedModuleName;

const isGlobalRequireCall = (
  node: EsTreeNode,
  moduleName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  const firstArgument = expression.arguments[0];
  return Boolean(
    isNodeOfType(callee, "Identifier") &&
    callee.name === "require" &&
    scopes.isGlobalReference(callee) &&
    firstArgument &&
    isNodeOfType(firstArgument, "Literal") &&
    typeof firstArgument.value === "string" &&
    isExpectedModuleName(firstArgument.value, moduleName),
  );
};

const isTypeScriptImportEqualsFromModule = (
  symbol: SymbolDescriptor,
  moduleName: string,
): boolean => {
  if (symbol.kind !== "ts-import-equals") return false;
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "TSImportEqualsDeclaration")) return false;
  const moduleReference = declaration.moduleReference;
  return Boolean(
    isNodeOfType(moduleReference, "TSExternalModuleReference") &&
    isNodeOfType(moduleReference.expression, "Literal") &&
    typeof moduleReference.expression.value === "string" &&
    isExpectedModuleName(moduleReference.expression.value, moduleName),
  );
};

const isAwaitedImportFromModule = (node: EsTreeNode, moduleName: string): boolean => {
  const expression = stripParenExpression(node);
  return Boolean(
    isNodeOfType(expression, "AwaitExpression") &&
    isNodeOfType(expression.argument, "ImportExpression") &&
    isNodeOfType(expression.argument.source, "Literal") &&
    typeof expression.argument.source.value === "string" &&
    isExpectedModuleName(expression.argument.source.value, moduleName),
  );
};

export const getModuleNamespaceSymbol = (
  node: EsTreeNode,
  moduleName: string,
  namespacePropertyName: string,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const symbol = resolveConstIdentifierAlias(stripParenExpression(node), scopes);
  const mutationInspector = getSymbolMutationInspector(scopes);
  if (
    !symbol ||
    mutationInspector.isExecutionOrderAmbiguous(usageNode) ||
    mutationInspector.isMutationOrderAmbiguous(symbol, usageNode, namespacePropertyName) ||
    mutationInspector.isMutatedBefore(symbol, usageNode, namespacePropertyName)
  ) {
    return null;
  }
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (
    typeof importDeclaration?.source.value === "string" &&
    isExpectedModuleName(importDeclaration.source.value, moduleName)
  ) {
    return isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
      getImportedName(symbol.declarationNode) === "default"
      ? symbol
      : null;
  }
  if (isTypeScriptImportEqualsFromModule(symbol, moduleName)) return symbol;
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (isGlobalRequireCall(initializer, moduleName, scopes)) return symbol;
  if (
    isNodeOfType(initializer, "MemberExpression") &&
    getStaticPropertyName(initializer) === "default" &&
    (isGlobalRequireCall(initializer.object, moduleName, scopes) ||
      isAwaitedImportFromModule(initializer.object, moduleName))
  ) {
    return symbol;
  }
  if (isAwaitedImportFromModule(initializer, moduleName)) return symbol;
  return null;
};

export const getNamedImportSymbol = (
  node: EsTreeNode,
  moduleName: string,
  importedName: string,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const symbol = resolveConstIdentifierAlias(stripParenExpression(node), scopes);
  if (!symbol) return null;
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  const mutationInspector = getSymbolMutationInspector(scopes);
  if (
    typeof importDeclaration?.source.value !== "string" ||
    !isExpectedModuleName(importDeclaration.source.value, moduleName) ||
    getImportedName(symbol.declarationNode) !== importedName ||
    mutationInspector.isExecutionOrderAmbiguous(usageNode) ||
    mutationInspector.isMutationOrderAmbiguous(symbol, usageNode, null) ||
    mutationInspector.isMutatedBefore(symbol, usageNode, null)
  ) {
    return null;
  }
  return symbol;
};

export const isKatexNamespace = (
  node: EsTreeNode,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  getModuleNamespaceSymbol(node, "katex", "renderToString", usageNode, scopes) !== null ||
  isGlobalRequireCall(node, "katex", scopes);

export const isKatexNamedRenderer = (
  node: EsTreeNode,
  usageNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (getNamedImportSymbol(node, "katex", "renderToString", usageNode, scopes)) return true;
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.referenceFor(expression)?.resolvedSymbol;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    getSymbolMutationInspector(scopes).isMutatedBefore(symbol, usageNode, null)
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  const bindingProperty = symbol.bindingIdentifier.parent;
  if (
    isNodeOfType(bindingProperty, "Property") &&
    getStaticPropertyKeyName(bindingProperty, { allowComputedString: true }) === "renderToString"
  ) {
    return isKatexNamespace(initializer, symbol.declarationNode, scopes);
  }
  if (
    isNodeOfType(initializer, "MemberExpression") &&
    getStaticPropertyName(initializer) === "renderToString" &&
    isKatexNamespace(initializer.object, symbol.declarationNode, scopes)
  ) {
    return true;
  }
  if (isNodeOfType(initializer, "Identifier")) {
    return isKatexNamedRenderer(initializer, symbol.declarationNode, scopes);
  }
  return false;
};

export const isUnprovenKatexShapedRenderer = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    if (!/katex/i.test(expression.name)) return false;
    const symbol = scopes.referenceFor(expression)?.resolvedSymbol;
    return Boolean(symbol && symbol.kind !== "parameter" && symbol.kind !== "let");
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  if (getStaticPropertyName(expression) !== "renderToString") return false;
  const receiver = stripParenExpression(expression.object);
  if (!isNodeOfType(receiver, "Identifier") || !/katex/i.test(receiver.name)) return false;
  const symbol = scopes.referenceFor(receiver)?.resolvedSymbol;
  if (!symbol) return false;
  if (symbol.kind === "import") {
    const isRealKatexImport = isExpectedModuleName(
      String(getImportDeclarationForSymbol(symbol)?.source.value ?? ""),
      "katex",
    );
    if (!isRealKatexImport) return true;
    const mutationInspector = getSymbolMutationInspector(scopes);
    if (
      mutationInspector.isExecutionOrderAmbiguous(expression) ||
      mutationInspector.isMutationOrderAmbiguous(symbol, expression, "renderToString")
    ) {
      return false;
    }
    return mutationInspector.isMutatedBefore(symbol, expression, "renderToString");
  }
  if (symbol.kind === "parameter" || symbol.kind === "let" || symbol.kind === "var") return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "ObjectExpression")) return true;
  if (isNodeOfType(initializer, "CallExpression")) {
    const callee = stripParenExpression(initializer.callee);
    return isNodeOfType(callee, "Identifier") && callee.name === "require";
  }
  return (
    isNodeOfType(initializer, "AwaitExpression") &&
    isNodeOfType(initializer.argument, "ImportExpression")
  );
};
