import { GLOBAL_RELEASE_METHOD_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { collectReturnedCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
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
  /(?:(?:^(?:abort|activation|attempt|controller|epoch|gen|generation|localization|pending|request|session|token|version)|(?:Abort|Activation|Attempt|Controller|Epoch|Gen|Generation|Localization|Pending|Request|Session|Token|Version))[A-Za-z0-9]*|(?:^work|Work)(?:Refs?)?)$/;
const RESOURCE_INVALIDATION_MARKER_NAMES: ReadonlySet<string> = new Set(["superseded"]);
const RESOURCE_COLLECTION_CLEAR_METHOD_NAMES: ReadonlySet<string> = new Set(["clear"]);

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

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const expressionContainsResourceIdentityRef = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindResourceIdentityRef = false;
  walkAst(expression, (child) => {
    if (didFindResourceIdentityRef) return false;
    if (isResourceIdentityRefCurrent(child, scopes)) {
      didFindResourceIdentityRef = true;
      return false;
    }
  });
  return didFindResourceIdentityRef;
};

const isOwnedResourceExpression = (
  expression: EsTreeNode,
  rootFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isResourceIdentityRefCurrent(candidate, scopes)) return true;
  if (isNodeOfType(candidate, "CallExpression")) {
    return expressionContainsResourceIdentityRef(candidate, scopes);
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    return isOwnedResourceExpression(candidate.object, rootFunction, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.referenceFor(candidate)?.resolvedSymbol ?? scopes.symbolFor(candidate);
  if (!symbol?.declarationNode || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds).add(symbol.id);
  if (symbol.initializer) {
    const initializer = stripParenExpression(symbol.initializer);
    if (
      isNodeOfType(initializer, "NewExpression") &&
      isDescendantOf(symbol.declarationNode, rootFunction)
    ) {
      return true;
    }
    if (isOwnedResourceExpression(initializer, rootFunction, scopes, nextVisitedSymbolIds)) {
      return true;
    }
  }
  let declarationAncestor: EsTreeNode | null | undefined = symbol.bindingIdentifier.parent;
  while (declarationAncestor && declarationAncestor !== rootFunction) {
    if (
      isNodeOfType(declarationAncestor, "ForOfStatement") &&
      expressionContainsResourceIdentityRef(declarationAncestor.right, scopes)
    ) {
      return true;
    }
    if (isFunctionLike(declarationAncestor)) break;
    declarationAncestor = declarationAncestor.parent;
  }
  const declaringFunction = findEnclosingFunction(symbol.bindingIdentifier);
  const iteratorCall = declaringFunction?.parent;
  if (
    declaringFunction &&
    isNodeOfType(iteratorCall, "CallExpression") &&
    isSynchronousIteratorCallbackCall(iteratorCall, declaringFunction) &&
    expressionContainsResourceIdentityRef(iteratorCall.callee, scopes)
  ) {
    return true;
  }
  let didFindResourceAcquisition = false;
  walkAst(rootFunction, (child) => {
    if (didFindResourceAcquisition) return false;
    if (child !== rootFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    const assignmentTarget = stripParenExpression(child.left);
    if (!isNodeOfType(assignmentTarget, "Identifier")) return;
    const targetSymbol =
      scopes.referenceFor(assignmentTarget)?.resolvedSymbol ?? scopes.symbolFor(assignmentTarget);
    if (targetSymbol?.id !== symbol.id) return;
    if (isNodeOfType(stripParenExpression(child.right), "NewExpression")) {
      didFindResourceAcquisition = true;
      return false;
    }
  });
  return didFindResourceAcquisition;
};

const isSynchronousResourceInvalidation = (
  node: EsTreeNode,
  rootFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "UpdateExpression")) {
    return isOwnedResourceExpression(node.argument, rootFunction, scopes);
  }
  if (!isNodeOfType(node, "AssignmentExpression")) return false;
  if (isResourceIdentityRefCurrent(node.left, scopes)) return true;
  const target = stripParenExpression(node.left);
  const assignedValue = stripParenExpression(node.right);
  return Boolean(
    node.operator === "=" &&
    isNodeOfType(target, "MemberExpression") &&
    RESOURCE_INVALIDATION_MARKER_NAMES.has(getStaticPropertyName(target) ?? "") &&
    isOwnedResourceExpression(target.object, rootFunction, scopes) &&
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
      if (isSynchronousResourceInvalidation(child, rootFunction, scopes)) {
        didFindLifecycleTransition = true;
        return false;
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      const memberName = isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
      const releaseReceiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : null;
      if (
        memberName &&
        releaseReceiver &&
        ((GLOBAL_RELEASE_METHOD_NAMES.has(memberName) &&
          isOwnedResourceExpression(releaseReceiver, rootFunction, scopes)) ||
          (RESOURCE_COLLECTION_CLEAR_METHOD_NAMES.has(memberName) &&
            isResourceIdentityRefCurrent(releaseReceiver, scopes)))
      ) {
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
