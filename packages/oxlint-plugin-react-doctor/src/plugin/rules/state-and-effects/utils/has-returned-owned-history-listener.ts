import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasUnsupportedLexicalRuntime } from "../../../utils/has-unsupported-lexical-runtime.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const HISTORY_FACTORIES = new Set([
  "createBrowserHistory",
  "createHashHistory",
  "createMemoryHistory",
]);

const HISTORY_NAVIGATION_METHODS = new Set([
  "back",
  "createHref",
  "forward",
  "go",
  "goBack",
  "goForward",
  "push",
  "replace",
]);

export const hasReturnedOwnedHistoryListener = (
  callback: EsTreeNode,
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const result = findTransparentExpressionRoot(call);
  const returnStatement = result.parent;
  if (
    callback.body !== result &&
    (!isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== result ||
      returnStatement.parent !== callback.body)
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  const listener = call.arguments[0];
  if (
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(listener, "Identifier") ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "listen"
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const { scopes } = context;
  const effectCallback = findTransparentExpressionRoot(callback);
  const effect = effectCallback.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== effectCallback ||
    !isNodeOfType(effect.callee, "Identifier") ||
    scopes.symbolFor(effect.callee)?.kind !== "import"
  ) {
    return false;
  }
  const effectApi = resolveImportedApiReference(effect.callee, scopes);
  if (
    effectApi?.source !== "react" ||
    !effectApi.importedName ||
    !EFFECT_HOOK_NAMES.has(effectApi.importedName)
  ) {
    return false;
  }
  // Older History versions can call the listener before returning the disposer.
  const state = resolveReactUseStatePair(listener, scopes);
  const stateInitializer = state?.declarator.init;
  if (
    !state ||
    scopes.symbolFor(listener) !== state.setterSymbol ||
    !isSymbolReadOnly(state.setterSymbol) ||
    !isNodeOfType(stateInitializer, "CallExpression") ||
    !isNodeOfType(stateInitializer.callee, "Identifier") ||
    scopes.symbolFor(stateInitializer.callee)?.kind !== "import"
  ) {
    return false;
  }
  const stateApi = resolveImportedApiReference(stateInitializer.callee, scopes);
  if (stateApi?.source !== "react" || stateApi.importedName !== "useState") return false;
  const history = scopes.symbolFor(receiver);
  const initializer = history && getDirectConstInitializer(history);
  if (
    !history ||
    isNodeOfType(history.declarationNode.parent?.parent, "ExportNamedDeclaration") ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    scopes.symbolFor(initializer.callee)?.kind !== "import"
  ) {
    return false;
  }
  const imported = resolveImportedApiReference(initializer.callee, scopes);
  if (
    imported?.source !== "history" ||
    !imported.importedName ||
    !HISTORY_FACTORIES.has(imported.importedName) ||
    hasUnsupportedLexicalRuntime(scopes) ||
    !hasCompleteSymbolReferences(history, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  return history.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    const reference = findTransparentExpressionRoot(identifier);
    const parent = reference.parent;
    const invocation = parent?.parent;
    if (
      isNodeOfType(parent, "ArrayExpression") &&
      invocation === effect &&
      effect.arguments[1] === parent
    ) {
      return true;
    }
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== reference) return false;
    const member = getStaticPropertyName(parent);
    if (member === "action" || member === "location" || member === "index" || member === "length") {
      return !isWithinAssignmentTarget(parent);
    }
    return (
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === parent &&
      (invocation === call || (member !== null && HISTORY_NAVIGATION_METHODS.has(member)))
    );
  });
};
