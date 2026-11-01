import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const UNSUPPORTED_PROVIDER_GLOBAL_NAMES = new Set([
  "React",
  "require",
  "module",
  "eval",
  "Function",
]);
const closedProviderPrograms = new WeakMap<ScopeAnalysis, boolean>();

const isReadonlyDirectCallBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (identifier === symbol.bindingIdentifier || isTypeScriptTypePosition(identifier))
      return true;
    const expression = findTransparentExpressionRoot(identifier);
    const parent = expression.parent;
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(identifier) &&
      Boolean(
        parent &&
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === expression &&
        !parent.optional,
      )
    );
  });

const hasRuntimeNamespaceReference = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) =>
      reference.identifier !== symbol.bindingIdentifier &&
      !isTypeScriptTypePosition(reference.identifier),
  );

const hasClosedProviderProgram = (scopes: ScopeAnalysis): boolean => {
  const cachedResult = closedProviderPrograms.get(scopes);
  if (cachedResult !== undefined) return cachedResult;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed || isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const binding = scopes.symbolFor(node);
      if (
        binding &&
        binding.bindingIdentifier !== node &&
        [...UNSUPPORTED_PROVIDER_GLOBAL_NAMES, "globalThis", "window", "self", "global"].includes(
          node.name,
        ) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      const source = node.source.value;
      if (source === "module" || source === "node:module") {
        isClosed =
          isTypeOnlyImport(node) &&
          node.specifiers.every((specifier) => {
            const symbol = scopes.symbolFor(specifier.local);
            return symbol && !hasRuntimeNamespaceReference(symbol);
          });
        return false;
      }
      if (source !== "react") return false;
      for (const specifier of node.specifiers) {
        if (
          !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
          !isNodeOfType(specifier, "ImportNamespaceSpecifier") &&
          getImportedName(specifier) !== "default"
        ) {
          continue;
        }
        const symbol = scopes.symbolFor(specifier.local);
        if (!symbol || hasRuntimeNamespaceReference(symbol)) {
          isClosed = false;
          return false;
        }
      }
      return false;
    }
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "WithStatement")) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "Property") &&
      node.parent &&
      isNodeOfType(node.parent, "ObjectPattern") &&
      getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor"
    ) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (propertyName === "constructor" || propertyName === "__proto__") {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "Identifier") && UNSUPPORTED_PROVIDER_GLOBAL_NAMES.has(node.name)) {
      const symbol = scopes.symbolFor(node);
      if (symbol?.kind === "import" && getValueImportSource(symbol) === null) {
        isClosed = false;
        return false;
      }
    }
    for (const name of UNSUPPORTED_PROVIDER_GLOBAL_NAMES) {
      if (isProvenGlobalNamespaceReference(node, name, scopes)) {
        isClosed = false;
        return false;
      }
    }
    return undefined;
  });
  closedProviderPrograms.set(scopes, isClosed);
  return isClosed;
};

const isNamedNativeRefCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  if (node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === "useRef" &&
    isReadonlyDirectCallBinding(symbol),
  );
};

const hasDirectNativeRefConstituent = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const pendingExpressions = [expression];
  while (pendingExpressions.length > 0) {
    const currentExpression = pendingExpressions.pop();
    if (!currentExpression) continue;
    const candidate = stripParenExpression(currentExpression);
    if (isNamedNativeRefCall(candidate, scopes)) return true;
    if (isNodeOfType(candidate, "ArrayExpression")) {
      for (const element of candidate.elements) {
        if (element) pendingExpressions.push(element);
      }
    } else if (isNodeOfType(candidate, "ObjectExpression")) {
      for (const property of candidate.properties) {
        if (
          isNodeOfType(property, "Property") &&
          !property.computed &&
          !property.method &&
          property.kind === "init"
        ) {
          pendingExpressions.push(property.value);
        }
      }
    }
  }
  return false;
};

export const containsNativeRefInitializer = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => hasDirectNativeRefConstituent(expression, scopes) && hasClosedProviderProgram(scopes);
