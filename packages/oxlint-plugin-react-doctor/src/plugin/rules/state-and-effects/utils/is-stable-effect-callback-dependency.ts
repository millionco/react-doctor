import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getReactUseCallbackCall } from "../../../utils/get-react-use-callback-call.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isStableEffectCallbackDependency = (
  dependency: unknown,
  effect: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(dependency, "Identifier")) return false;
  const list = effect.arguments[1];
  if (
    !isNodeOfType(list, "ArrayExpression") ||
    findTransparentExpressionRoot(dependency).parent !== list
  )
    return false;
  const symbol = scopes.symbolFor(dependency);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !isSymbolReadOnly(symbol)
  )
    return false;

  const callback = getReactUseCallbackCall(dependency, scopes);
  if (
    !callback ||
    callback !== stripParenExpression(symbol.initializer) ||
    callback.optional ||
    callback.arguments.length !== 2 ||
    !isNodeOfType(callback.callee, "Identifier") ||
    scopes.symbolFor(callback.callee)?.kind !== "import"
  )
    return false;
  const api = resolveImportedApiReference(callback.callee, scopes);
  if (api?.source !== "react" || api.importedName !== "useCallback") return false;
  const implementation = stripParenExpression(callback.arguments[0]);
  const dependencies = stripParenExpression(callback.arguments[1]);
  const owner = findEnclosingFunction(effect);
  return Boolean(
    owner &&
    findEnclosingFunction(callback) === owner &&
    isFunctionLike(implementation) &&
    isNodeOfType(dependencies, "ArrayExpression") &&
    dependencies.elements.length === 0,
  );
};
