import { closureCaptures } from "../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";

const isUniqueReadOnlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.scope.symbols.every(
    (candidate) => candidate === symbol || candidate.name !== symbol.name,
  ) && symbol.references.every((reference) => reference.flag === "read");

const isDirectReactHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  hookName: "useCallback" | "useEffect",
  scopes: ScopeAnalysis,
): boolean => {
  if (call.optional || !isReactApiCall(call, hookName, scopes)) return false;
  const callee = call.callee;
  const binding = isNodeOfType(callee, "Identifier")
    ? scopes.symbolFor(callee)
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.optional &&
        !callee.computed &&
        isNodeOfType(callee.object, "Identifier")
      ? scopes.symbolFor(callee.object)
      : null;
  if (!binding || binding.kind !== "import") return false;
  const declaration = binding.declarationNode;
  const importStatement = declaration.parent;
  return (
    isNodeOfType(importStatement, "ImportDeclaration") &&
    importStatement.source.value === "react" &&
    importStatement.importKind !== "type" &&
    (isNodeOfType(declaration, "ImportNamespaceSpecifier") ||
      (isNodeOfType(declaration, "ImportSpecifier") && declaration.importKind !== "type")) &&
    isUniqueReadOnlyBinding(binding)
  );
};

const getOwnConstantStatement = (
  symbol: SymbolDescriptor,
  body: EsTreeNodeOfType<"BlockStatement">,
): EsTreeNodeOfType<"VariableDeclaration"> | null => {
  const declarator = symbol.declarationNode;
  const statement = declarator.parent;
  return symbol.kind === "const" &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.id === symbol.bindingIdentifier &&
    isNodeOfType(statement, "VariableDeclaration") &&
    statement.declarations.length === 1 &&
    statement.parent === body &&
    isUniqueReadOnlyBinding(symbol)
    ? statement
    : null;
};

export const collectMemoizedCallbackCoveredDependencies = (
  effect: EsTreeNodeOfType<"CallExpression">,
  dependencies: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): ReadonlySet<string> => {
  const coveredDependencies = new Set<string>();
  const [effectCallback] = effect.arguments;
  const effectStatement = effect.parent;
  const owner = findEnclosingFunction(effect);
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.expression !== effect ||
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    effectStatement.parent !== owner.body ||
    effect.arguments.length !== 2 ||
    effect.arguments[1] !== dependencies ||
    !isDirectReactHookCall(effect, "useEffect", scopes)
  ) {
    return coveredDependencies;
  }

  const declaredSymbols = new Set<SymbolDescriptor>();
  for (const dependency of dependencies.elements) {
    if (!isNodeOfType(dependency, "Identifier")) return coveredDependencies;
    const symbol = scopes.referenceFor(dependency)?.resolvedSymbol;
    if (!symbol || declaredSymbols.has(symbol)) return coveredDependencies;
    declaredSymbols.add(symbol);
  }
  const captures = closureCaptures(effectCallback, scopes);
  for (const declaredSymbol of declaredSymbols) {
    const initializer = declaredSymbol.initializer;
    if (
      !isNodeOfType(initializer, "CallExpression") ||
      initializer.arguments.length !== 2 ||
      !isDirectReactHookCall(initializer, "useCallback", scopes)
    ) {
      continue;
    }
    const declaration = getOwnConstantStatement(declaredSymbol, owner.body);
    if (
      !declaration ||
      declaration.range[0] >= effectStatement.range[0] ||
      !captures.some((reference) => reference.resolvedSymbol === declaredSymbol)
    ) {
      continue;
    }

    const [callback, callbackDependencies] = initializer.arguments;
    if (
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      !isNodeOfType(callbackDependencies, "ArrayExpression") ||
      callbackDependencies.elements.length !== 1
    ) {
      continue;
    }
    const [callbackDependency] = callbackDependencies.elements;
    if (!isNodeOfType(callbackDependency, "Identifier")) continue;
    const capturedSymbol = scopes.referenceFor(callbackDependency)?.resolvedSymbol;
    if (!capturedSymbol || declaredSymbols.has(capturedSymbol)) continue;
    const capturedDeclaration = getOwnConstantStatement(capturedSymbol, owner.body);
    if (
      !capturedDeclaration ||
      capturedDeclaration.range[0] >= declaration.range[0] ||
      !closureCaptures(callback, scopes).some(
        (reference) => reference.resolvedSymbol === capturedSymbol,
      )
    ) {
      continue;
    }
    const matchingCaptures = captures.filter(
      (reference) => reference.resolvedSymbol?.name === capturedSymbol.name,
    );
    if (
      matchingCaptures.length > 0 &&
      matchingCaptures.every(
        (reference) => reference.resolvedSymbol === capturedSymbol && reference.flag === "read",
      )
    ) {
      coveredDependencies.add(capturedSymbol.name);
    }
  }
  return coveredDependencies;
};
