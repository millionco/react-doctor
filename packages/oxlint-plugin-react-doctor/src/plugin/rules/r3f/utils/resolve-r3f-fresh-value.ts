import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveFreshRenderValue } from "../../../utils/resolve-fresh-render-value.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const FRESH_RECEIVER_METHOD_NAMES = new Set(["add"]);

export const resolveR3fFreshValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  acceptedKinds?: ReadonlySet<string>,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  const resolved = resolveFreshRenderValue(expression, scopes);
  if (resolved && (!acceptedKinds || acceptedKinds.has(resolved.kind))) return resolved.kind;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind === "const" &&
      symbol.scope.kind !== "module" &&
      symbol.initializer &&
      !visitedSymbolIds.has(symbol.id) &&
      symbol.references.every((reference) => reference.flag === "read") &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier
    ) {
      visitedSymbolIds.add(symbol.id);
      return resolveR3fFreshValue(symbol.initializer, scopes, acceptedKinds, visitedSymbolIds);
    }
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      resolveR3fFreshValue(
        candidate.consequent,
        scopes,
        acceptedKinds,
        new Set(visitedSymbolIds),
      ) ??
      resolveR3fFreshValue(candidate.alternate, scopes, acceptedKinds, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      resolveR3fFreshValue(candidate.left, scopes, acceptedKinds, new Set(visitedSymbolIds)) ??
      resolveR3fFreshValue(candidate.right, scopes, acceptedKinds, new Set(visitedSymbolIds))
    );
  }
  if (
    isNodeOfType(candidate, "CallExpression") &&
    isNodeOfType(candidate.callee, "MemberExpression")
  ) {
    const methodName = getStaticPropertyName(candidate.callee);
    const receiver = stripParenExpression(candidate.callee.object);
    if (
      methodName === "create" &&
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "Object" &&
      scopes.isGlobalReference(receiver) &&
      candidate.arguments.length > 0 &&
      (!acceptedKinds || acceptedKinds.has("object"))
    ) {
      return "object";
    }
    if (methodName === "clone" && (!acceptedKinds || acceptedKinds.has("clone"))) return "clone";
    if (methodName && FRESH_RECEIVER_METHOD_NAMES.has(methodName)) {
      return resolveR3fFreshValue(receiver, scopes, acceptedKinds, visitedSymbolIds);
    }
  }
  return null;
};
