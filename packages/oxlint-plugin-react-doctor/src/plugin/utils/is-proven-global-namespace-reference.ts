import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const GLOBAL_SELF_PROPERTY_NAMES = new Set(["global", "globalThis", "self", "window"]);

interface RuntimeNamespaceScopeFrame {
  readonly scope: ScopeDescriptor;
  readonly previousSymbols: ReadonlyMap<string, SymbolDescriptor | null> | null;
}

const runtimeNamespaceSymbolsByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, SymbolDescriptor | null>
>();
const valueImportsByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, Map<boolean, boolean>>
>();

const hasRuntimeNamespaceValue = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  if (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") return false;
  if (symbol.kind !== "import") return true;
  const declaration = symbol.declarationNode.parent;
  if (!declaration || !isNodeOfType(declaration, "ImportDeclaration")) return true;
  let valueImportsByDeclaration = valueImportsByAnalysis.get(scopes);
  if (!valueImportsByDeclaration) {
    valueImportsByDeclaration = new WeakMap();
    valueImportsByAnalysis.set(scopes, valueImportsByDeclaration);
  }
  let valueImports = valueImportsByDeclaration.get(declaration);
  if (!valueImports) {
    valueImports = new Map();
    valueImportsByDeclaration.set(declaration, valueImports);
  }
  const isInlineType =
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind === "type";
  let hasValue = valueImports.get(isInlineType);
  if (hasValue === undefined) {
    hasValue = getValueImportDeclaration(symbol) !== null;
    valueImports.set(isInlineType, hasValue);
  }
  return hasValue;
};

const getRuntimeNamespaceSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const resolvedSymbol = scopes.symbolFor(identifier);
  if (!resolvedSymbol || hasRuntimeNamespaceValue(resolvedSymbol, scopes)) {
    return resolvedSymbol;
  }
  let runtimeSymbols = runtimeNamespaceSymbolsByAnalysis.get(scopes);
  if (!runtimeSymbols) {
    runtimeSymbols = new WeakMap();
    const activeSymbols = new Map<string, SymbolDescriptor>();
    const pendingScopes: RuntimeNamespaceScopeFrame[] = [
      { scope: scopes.rootScope, previousSymbols: null },
    ];
    while (pendingScopes.length > 0) {
      const frame = pendingScopes.pop();
      if (!frame) break;
      if (frame.previousSymbols !== null) {
        for (const [name, previousSymbol] of frame.previousSymbols) {
          if (previousSymbol) activeSymbols.set(name, previousSymbol);
          else activeSymbols.delete(name);
        }
        continue;
      }
      const previousSymbols = new Map<string, SymbolDescriptor | null>();
      for (const symbol of frame.scope.symbols) {
        if (!hasRuntimeNamespaceValue(symbol, scopes)) continue;
        if (!previousSymbols.has(symbol.name)) {
          previousSymbols.set(symbol.name, activeSymbols.get(symbol.name) ?? null);
        }
        activeSymbols.set(symbol.name, symbol);
      }
      for (const reference of frame.scope.references) {
        if (
          !isNodeOfType(reference.identifier, "Identifier") &&
          !isNodeOfType(reference.identifier, "JSXIdentifier")
        ) {
          continue;
        }
        runtimeSymbols.set(
          reference.identifier,
          activeSymbols.get(reference.identifier.name) ?? null,
        );
      }
      pendingScopes.push({ scope: frame.scope, previousSymbols });
      for (const childScope of frame.scope.children) {
        pendingScopes.push({ scope: childScope, previousSymbols: null });
      }
    }
    runtimeNamespaceSymbolsByAnalysis.set(scopes, runtimeSymbols);
  }
  return runtimeSymbols.has(identifier) ? (runtimeSymbols.get(identifier) ?? null) : resolvedSymbol;
};

export const isProvenGlobalObjectReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  let currentExpression = expression;
  while (true) {
    const strippedExpression = stripParenExpression(currentExpression);
    if (!isNodeOfType(strippedExpression, "Identifier")) return false;
    if (
      (strippedExpression.name === "globalThis" ||
        strippedExpression.name === "window" ||
        strippedExpression.name === "self" ||
        strippedExpression.name === "global") &&
      scopes.referenceFor(strippedExpression) !== null &&
      getRuntimeNamespaceSymbol(strippedExpression, scopes) === null
    ) {
      return true;
    }
    const symbol = getRuntimeNamespaceSymbol(strippedExpression, scopes);
    if (
      !symbol?.initializer ||
      symbol.kind !== "const" ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
    ) {
      return false;
    }
    const declaration = symbol.declarationNode;
    const initializer = declaration.init;
    if (!initializer) return false;
    const isDirectIdentifierAlias =
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id === symbol.bindingIdentifier &&
      initializer === symbol.initializer;
    const bindingProperty = symbol.bindingIdentifier.parent;
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    const isDirectGlobalSelfAlias =
      isNodeOfType(declaration.id, "ObjectPattern") &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingProperty.value === symbol.bindingIdentifier &&
      bindingProperty.parent === declaration.id &&
      destructuredPropertyName !== null &&
      GLOBAL_SELF_PROPERTY_NAMES.has(destructuredPropertyName);
    if (!isDirectIdentifierAlias && !isDirectGlobalSelfAlias) return false;
    visitedSymbolIds.add(symbol.id);
    currentExpression = initializer;
  }
};

export const isProvenGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  let currentExpression = expression;
  while (true) {
    const strippedExpression = stripParenExpression(currentExpression);
    if (!isNodeOfType(strippedExpression, "Identifier")) {
      return (
        isNodeOfType(strippedExpression, "MemberExpression") &&
        getStaticPropertyName(strippedExpression) === namespaceName &&
        isProvenGlobalObjectReference(strippedExpression.object, scopes)
      );
    }
    if (
      strippedExpression.name === namespaceName &&
      scopes.referenceFor(strippedExpression) !== null &&
      getRuntimeNamespaceSymbol(strippedExpression, scopes) === null
    ) {
      return true;
    }
    const symbol = getRuntimeNamespaceSymbol(strippedExpression, scopes);
    if (!symbol || symbol.kind !== "const" || visitedSymbolIds.has(symbol.id)) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    const declaration = symbol.declarationNode;
    const bindingIdentifier = symbol.bindingIdentifier;
    const bindingProperty = bindingIdentifier.parent;
    if (
      getDestructuredBindingPropertyName(bindingIdentifier) === namespaceName &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.id, "ObjectPattern") &&
      isNodeOfType(bindingProperty, "Property") &&
      bindingProperty.value === bindingIdentifier &&
      bindingProperty.parent === declaration.id &&
      declaration.init
    ) {
      return isProvenGlobalObjectReference(declaration.init, scopes);
    }
    const directInitializer = getDirectConstInitializer(symbol);
    if (!directInitializer) return false;
    currentExpression = directInitializer;
  }
};
