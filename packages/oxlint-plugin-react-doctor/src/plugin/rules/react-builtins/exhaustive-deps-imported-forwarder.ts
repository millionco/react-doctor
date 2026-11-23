import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// Direct calls to a render-local forwarder observe the captured value and the
// ESM binding at call time. Its freshly allocated function identity is unused.
export const resolveImportedForwarderSourceKeys = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  declaredDeps: ReadonlyMap<string, EsTreeNode>,
): Set<string> | null => {
  if (symbol.kind !== "const" || declaredDeps.size === 0) return null;
  const isDirectCall = (usage: ReferenceDescriptor): boolean => {
    const root = findTransparentExpressionRoot(usage.identifier);
    return (
      usage.flag === "read" &&
      isNodeOfType(root.parent, "CallExpression") &&
      !root.parent.optional &&
      root.parent.callee === root
    );
  };
  if (!isDirectCall(reference)) return null;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return null;
  const forwarder = stripParenExpression(initializer);
  if (!isNodeOfType(forwarder, "ArrowFunctionExpression") || forwarder.async) return null;
  const [parameter] = forwarder.params;
  const call = stripParenExpression(forwarder.body);
  if (
    forwarder.params.length !== 1 ||
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 2
  ) {
    return null;
  }
  const parameterSymbol = scopes.symbolFor(parameter);
  const [capturedArgument, forwardedArgument] = call.arguments;
  if (
    !isNodeOfType(capturedArgument, "Identifier") ||
    !isNodeOfType(forwardedArgument, "Identifier") ||
    !parameterSymbol ||
    scopes.symbolFor(forwardedArgument) !== parameterSymbol
  ) {
    return null;
  }
  const imported = scopes.symbolFor(call.callee);
  const specifier = imported?.declarationNode;
  const declaration = specifier?.parent;
  if (
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.parent !== scopes.rootScope.node
  ) {
    return null;
  }
  const captured = scopes.symbolFor(capturedArgument);
  const dependency = declaredDeps.get(capturedArgument.name);
  if (
    !captured ||
    (captured.kind !== "const" && captured.kind !== "parameter") ||
    captured.scope !== symbol.scope ||
    !dependency ||
    scopes.symbolFor(stripParenExpression(dependency)) !== captured ||
    captured.references.some(
      (usage) => usage.flag !== "read" || isWithinAssignmentTarget(usage.identifier),
    ) ||
    !symbol.references.every(isDirectCall) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) ||
    !hasCompleteSymbolReferences(captured, scopes.rootScope.node, scopes)
  ) {
    return null;
  }
  const owner = findEnclosingFunction(forwarder);
  if (!owner) return null;
  let hasEval = false;
  walkAst(owner, (node) => {
    if (hasEval) return false;
    if (!isNodeOfType(node, "CallExpression") || node.optional) return;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") hasEval = true;
  });
  return hasEval ? null : new Set([captured.name]);
};
