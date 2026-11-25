import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { hasClosedStockReactObjectReferences } from "../../utils/has-closed-stock-react-object-references.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isDirectNamedReactHookCall } from "../../utils/is-direct-named-react-hook-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const isBoundReactMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  method: "useCallback" | "useEffect",
  scopes: ScopeAnalysis,
): boolean => {
  if (isDirectNamedReactHookCall(call, method, scopes)) return true;
  const callee = call.callee;
  if (
    call.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier") ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== method
  ) {
    return false;
  }
  const importSpecifier = scopes.symbolFor(callee.object)?.declarationNode;
  const declaration = importSpecifier?.parent;
  return (
    (isNodeOfType(importSpecifier, "ImportDefaultSpecifier") ||
      isNodeOfType(importSpecifier, "ImportNamespaceSpecifier")) &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    declaration.parent === scopes.rootScope.node
  );
};

const isPrivateTopLevelConst = (
  symbol: SymbolDescriptor,
  renderBody: EsTreeNode,
  use: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declarator = symbol.declarationNode;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  const declaredAt = getNodeStartIndex(declarator);
  const usedAt = getNodeStartIndex(use);
  return (
    symbol.kind === "const" &&
    declarator.id === symbol.bindingIdentifier &&
    isNodeOfType(declarator.parent, "VariableDeclaration") &&
    declarator.parent.parent === renderBody &&
    declaredAt !== -1 &&
    usedAt !== -1 &&
    declaredAt < usedAt &&
    symbol.references.every((reference) => reference.flag === "read") &&
    hasCompleteSymbolReferences(symbol, program, scopes)
  );
};

export const getFreshCallbackCoveredBindings = (
  hook: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  verifyStockUseCallbackAndCompiler: () => boolean,
): ReadonlySet<string> => {
  const covered = new Set<string>();
  const [callback, dependencies] = hook.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !dependencies.elements.every((element) => isNodeOfType(element, "Identifier")) ||
    !isBoundReactMethodCall(hook, "useEffect", scopes)
  ) {
    return covered;
  }
  const owner = findEnclosingFunction(hook);
  const program = findProgramRoot(hook);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isNodeOfType(hook.parent, "ExpressionStatement") ||
    hook.parent.parent !== owner.body ||
    !program
  ) {
    return covered;
  }

  const captures = closureCaptures(callback, scopes);
  const symbolsWithMemberOrPatternReads = new Set<SymbolDescriptor>();
  for (const reference of captures) {
    const expression = findTransparentExpressionRoot(reference.identifier);
    const parent = expression.parent;
    if (
      reference.resolvedSymbol &&
      ((isNodeOfType(parent, "MemberExpression") && parent.object === expression) ||
        (isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === expression &&
          !isNodeOfType(parent.id, "Identifier")))
    ) {
      symbolsWithMemberOrPatternReads.add(reference.resolvedSymbol);
    }
  }

  for (const carrierEntry of dependencies.elements) {
    if (!isNodeOfType(carrierEntry, "Identifier")) continue;
    const carrierSymbol = scopes.symbolFor(carrierEntry);
    if (!carrierSymbol || !isPrivateTopLevelConst(carrierSymbol, owner.body, hook, program, scopes))
      continue;
    const carrier = carrierSymbol.initializer;
    if (
      !isNodeOfType(carrier, "CallExpression") ||
      carrier.arguments.length !== 2 ||
      !isBoundReactMethodCall(carrier, "useCallback", scopes)
    ) {
      continue;
    }
    const [freshCallback, carrierDependencies] = carrier.arguments;
    if (
      !isNodeOfType(freshCallback, "ArrowFunctionExpression") ||
      freshCallback.async ||
      freshCallback.params.length !== 0 ||
      !isNodeOfType(carrierDependencies, "ArrayExpression") ||
      !carrierDependencies.elements.every((entry) => isNodeOfType(entry, "Identifier"))
    ) {
      continue;
    }
    const carrierCaptures = closureCaptures(freshCallback, scopes);
    for (const entry of carrierDependencies.elements) {
      if (!isNodeOfType(entry, "Identifier")) continue;
      const binding = scopes.symbolFor(entry);
      if (
        binding &&
        !symbolsWithMemberOrPatternReads.has(binding) &&
        isPrivateTopLevelConst(binding, owner.body, carrier, program, scopes) &&
        captures.some((reference) => reference.resolvedSymbol === binding) &&
        carrierCaptures.some((reference) => reference.resolvedSymbol === binding)
      ) {
        covered.add(binding.name);
      }
    }
  }
  if (
    covered.size > 0 &&
    (!hasClosedStockReactObjectReferences(program, scopes) || !verifyStockUseCallbackAndCompiler())
  )
    covered.clear();
  return covered;
};
