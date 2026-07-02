import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getCallMethodName } from "./get-call-method-name.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const CONTEXT_MODULES: ReadonlyArray<string> = ["react", "use-context-selector", "react-tracked"];

const getSupportedContextImportSource = (symbol: SymbolDescriptor | null): string | null => {
  if (symbol?.kind !== "import") return null;
  const importDeclaration = symbol.declarationNode.parent;
  if (
    !importDeclaration ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    typeof importDeclaration.source.value !== "string" ||
    !CONTEXT_MODULES.includes(importDeclaration.source.value)
  ) {
    return null;
  }
  return importDeclaration.source.value;
};

const isSupportedNamespaceSymbol = (symbol: SymbolDescriptor | null): boolean =>
  getSupportedContextImportSource(symbol) !== null &&
  Boolean(
    symbol &&
    (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")),
  );

const isDestructuredCreateContextBinding = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "ObjectPattern")
  ) {
    return false;
  }
  const property = symbol.bindingIdentifier.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    getStaticPropertyKeyName(property, { allowComputedString: true }) !== "createContext"
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "Identifier") &&
    isSupportedNamespaceSymbol(resolveConstIdentifierAlias(initializer, scopes))
  );
};

const isCreateContextCallee = (calleeNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callee = stripParenExpression(calleeNode);
  if (isNodeOfType(callee, "Identifier")) {
    if (isDestructuredCreateContextBinding(callee, scopes)) return true;
    const symbol = resolveConstIdentifierAlias(callee, scopes);
    return (
      getSupportedContextImportSource(symbol) !== null &&
      Boolean(symbol && getImportedName(symbol.declarationNode) === "createContext")
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName =
    getCallMethodName(callee) ??
    (callee.computed &&
    isNodeOfType(callee.property, "Literal") &&
    typeof callee.property.value === "string"
      ? callee.property.value
      : null);
  if (methodName !== "createContext") return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (receiver.name === "React" && scopes.isGlobalReference(receiver)) return true;
  return isSupportedNamespaceSymbol(resolveConstIdentifierAlias(receiver, scopes));
};

export const isCreateContextCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "CallExpression") && isCreateContextCallee(stripped.callee, scopes);
};
