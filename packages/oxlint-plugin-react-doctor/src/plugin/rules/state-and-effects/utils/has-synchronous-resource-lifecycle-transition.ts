import { GLOBAL_RELEASE_METHOD_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { collectReturnedCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../../utils/get-transparent-react-callback-wrapper-argument.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSynchronousIteratorCallbackCall } from "../../../utils/is-synchronous-iterator-callback.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const RESOURCE_IDENTITY_REF_NAME_PATTERN =
  /(?:abort|activation|attempt|controller|epoch|gen|generation|pending|request|session|token|version)s?(?:Ref)?$/i;
const RESOURCE_INVALIDATION_MARKER_NAMES: ReadonlySet<string> = new Set(["superseded"]);

const resolveSynchronousFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const directFunction = resolveExactLocalFunction(expression, scopes);
  if (directFunction) return directFunction;
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.referenceFor(candidate)?.resolvedSymbol ?? scopes.symbolFor(candidate);
  if (!symbol?.initializer) return null;
  const wrappedFunction = getTransparentReactCallbackWrapperArgument(
    symbol.initializer,
    symbol,
    scopes,
  );
  return wrappedFunction && isFunctionLike(wrappedFunction) ? wrappedFunction : null;
};

const isResourceIdentityRefCurrent = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(node);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(candidate.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol =
    scopes.referenceFor(receiver)?.resolvedSymbol ?? scopes.symbolFor(receiver);
  return Boolean(
    receiverSymbol?.initializer &&
    RESOURCE_IDENTITY_REF_NAME_PATTERN.test(receiverSymbol.name) &&
    isReactApiCall(receiverSymbol.initializer, "useRef", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }),
  );
};

const isSynchronousResourceInvalidation = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "UpdateExpression")) {
    return isResourceIdentityRefCurrent(node.argument, scopes);
  }
  if (!isNodeOfType(node, "AssignmentExpression")) return false;
  if (isResourceIdentityRefCurrent(node.left, scopes)) return true;
  const target = stripParenExpression(node.left);
  const assignedValue = stripParenExpression(node.right);
  return Boolean(
    node.operator === "=" &&
    isNodeOfType(target, "MemberExpression") &&
    RESOURCE_INVALIDATION_MARKER_NAMES.has(getStaticPropertyName(target) ?? "") &&
    isNodeOfType(assignedValue, "Literal") &&
    assignedValue.value === true,
  );
};

export const hasSynchronousResourceLifecycleTransition = (
  rootFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const pendingFunctions = [rootFunction, ...collectReturnedCleanupFunctions(rootFunction, scopes)];
  const visitedFunctions = new Set<EsTreeNode>();
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction || visitedFunctions.has(currentFunction)) continue;
    visitedFunctions.add(currentFunction);
    let didFindLifecycleTransition = false;
    walkAst(currentFunction, (child) => {
      if (didFindLifecycleTransition) return false;
      if (child !== currentFunction && isFunctionLike(child)) return false;
      if (isSynchronousResourceInvalidation(child, scopes)) {
        didFindLifecycleTransition = true;
        return false;
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      const memberName = isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
      if (memberName && GLOBAL_RELEASE_METHOD_NAMES.has(memberName)) {
        didFindLifecycleTransition = true;
        return false;
      }
      const invokedFunction = resolveSynchronousFunction(child.callee, scopes);
      if (invokedFunction) pendingFunctions.push(invokedFunction);
      for (const argument of child.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        if (!isSynchronousIteratorCallbackCall(child, argument)) continue;
        const iteratorFunction = resolveSynchronousFunction(argument, scopes);
        if (iteratorFunction) pendingFunctions.push(iteratorFunction);
      }
    });
    if (didFindLifecycleTransition) return true;
  }
  return false;
};
