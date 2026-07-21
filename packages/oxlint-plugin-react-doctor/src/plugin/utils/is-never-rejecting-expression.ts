import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isInsideTryStatement } from "./is-inside-try-statement.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { subtreeCanThrowSynchronously } from "./subtree-can-throw-synchronously.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";

export const subtreeContainsThrow = (root: EsTreeNode, includeNestedFunctions = true): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (!includeNestedFunctions && child !== root && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ThrowStatement")) {
      found = true;
      return false;
    }
  });
  return found;
};
export const isInsideNonRethrowingTry = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== functionBoundary) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.block === child &&
      ancestor.handler &&
      !subtreeContainsThrow(ancestor.handler as EsTreeNode, false)
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
export const isDefinitelyNonThenableValue = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Literal")) return true;
  if (isNodeOfType(inner, "TemplateLiteral")) return true;
  if (isNodeOfType(inner, "ArrayExpression")) {
    return inner.elements.every(
      (element) => element === null || !isNodeOfType(element, "SpreadElement"),
    );
  }
  if (isNodeOfType(inner, "ObjectExpression")) {
    return inner.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        isDefinitelyNonThenableValue(property.value as EsTreeNode),
    );
  }
  return false;
};

export const isNonRejectingPromiseConstruction = (
  root: EsTreeNode,
  scopes?: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(root);
  if (!isNodeOfType(inner, "NewExpression")) return false;
  if (!isNodeOfType(inner.callee, "Identifier") || inner.callee.name !== "Promise") return false;
  if (scopes && !scopes.isGlobalReference(inner.callee)) return false;
  const executor = inner.arguments?.[0]
    ? stripParenExpression(inner.arguments[0] as EsTreeNode)
    : null;
  if (
    !executor ||
    (!isNodeOfType(executor, "ArrowFunctionExpression") &&
      !isNodeOfType(executor, "FunctionExpression"))
  ) {
    return false;
  }
  if ((executor.params?.length ?? 0) >= 2) return false;
  const resolveParameter = executor.params[0];
  const resolveName = isNodeOfType(resolveParameter, "Identifier") ? resolveParameter.name : null;
  let canReject = scopes
    ? subtreeCanThrowSynchronously(executor, executor, scopes)
    : subtreeContainsThrow(executor, false);
  if (!canReject && resolveName) {
    walkAst(executor, (child: EsTreeNode) => {
      if (canReject) return false;
      if (
        !isNodeOfType(child, "CallExpression") ||
        !isNodeOfType(child.callee, "Identifier") ||
        child.callee.name !== resolveName
      ) {
        return;
      }
      const resolvedValue = child.arguments[0];
      if (resolvedValue && !isDefinitelyNonThenableValue(resolvedValue)) {
        canReject = true;
        return false;
      }
    });
  }
  return !canReject;
};

export const isPromiseResolveCall = (node: EsTreeNode, scopes?: ScopeAnalysis): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (!isNodeOfType(inner.callee, "MemberExpression") || inner.callee.computed) return false;
  if (!isNodeOfType(inner.callee.object, "Identifier")) return false;
  if (inner.callee.object.name !== "Promise") return false;
  if (scopes && !scopes.isGlobalReference(inner.callee.object)) return false;
  if (!isNodeOfType(inner.callee.property, "Identifier")) return false;
  if (inner.callee.property.name !== "resolve") return false;
  const argument = inner.arguments[0];
  return !argument || isDefinitelyNonThenableValue(argument);
};
export const chainCarriesRejectionHandler = (node: EsTreeNode, scopes?: ScopeAnalysis): boolean => {
  const isAbsorbingHandler = (candidate: EsTreeNode | null | undefined): boolean => {
    if (!candidate) return false;
    const strippedCandidate = stripParenExpression(candidate);
    const resolvedCandidate = isNodeOfType(strippedCandidate, "Identifier")
      ? scopes
        ? resolveExactLocalFunction(strippedCandidate, scopes)
        : findVariableInitializer(strippedCandidate, strippedCandidate.name)?.initializer
      : strippedCandidate;
    if (!resolvedCandidate || !isFunctionLike(resolvedCandidate)) return false;
    const resultCanReject = (result: EsTreeNode): boolean =>
      !isDefinitelyNonThenableValue(result) &&
      !isPromiseResolveCall(result, scopes) &&
      !isNonRejectingPromiseConstruction(result, scopes) &&
      !chainCarriesRejectionHandler(result, scopes);
    let canReject = false;
    if (scopes && subtreeCanThrowSynchronously(resolvedCandidate, resolvedCandidate, scopes)) {
      return false;
    }
    walkOwnFunctionScope(resolvedCandidate, (child: EsTreeNode) => {
      if (canReject) return false;
      if (isNodeOfType(child, "ThrowStatement") || isNodeOfType(child, "AwaitExpression")) {
        canReject = true;
        return false;
      }
      if (isNodeOfType(child, "CallExpression")) {
        const callee = stripParenExpression(child.callee);
        const receiver = isNodeOfType(callee, "MemberExpression")
          ? stripParenExpression(callee.object)
          : null;
        const isConsoleCall =
          isNodeOfType(receiver, "Identifier") &&
          receiver.name === "console" &&
          (!scopes || scopes.isGlobalReference(receiver));
        const localFunction =
          scopes && isNodeOfType(callee, "Identifier")
            ? resolveExactLocalFunction(callee, scopes)
            : null;
        if (
          !isConsoleCall &&
          !isPromiseResolveCall(child, scopes) &&
          !chainCarriesRejectionHandler(child, scopes) &&
          (!localFunction ||
            !scopes ||
            subtreeCanThrowSynchronously(localFunction, localFunction, scopes))
        ) {
          canReject = true;
          return false;
        }
      }
      if (
        isNodeOfType(child, "ReturnStatement") &&
        child.argument &&
        resultCanReject(child.argument)
      ) {
        canReject = true;
        return false;
      }
    });
    if (
      isNodeOfType(resolvedCandidate, "ArrowFunctionExpression") &&
      !isNodeOfType(resolvedCandidate.body, "BlockStatement") &&
      resultCanReject(resolvedCandidate.body)
    ) {
      canReject = true;
    }
    return !canReject;
  };
  let cursor: EsTreeNode | null | undefined = stripParenExpression(node);
  const hasPromiseLikeReceiver = (
    candidate: EsTreeNode,
    visitedBindingIdentifiers = new Set<EsTreeNode>(),
  ): boolean => {
    const strippedCandidate = stripParenExpression(candidate);
    if (
      isNodeOfType(strippedCandidate, "CallExpression") ||
      isNodeOfType(strippedCandidate, "NewExpression")
    ) {
      return true;
    }
    if (!isNodeOfType(strippedCandidate, "Identifier")) return false;
    const symbol = scopes?.symbolFor(strippedCandidate);
    if (symbol && visitedBindingIdentifiers.has(symbol.bindingIdentifier)) return false;
    if (symbol) visitedBindingIdentifiers.add(symbol.bindingIdentifier);
    const initializer = symbol
      ? getDirectUnreassignedInitializer(symbol)
      : findVariableInitializer(strippedCandidate, strippedCandidate.name)?.initializer;
    return Boolean(initializer && hasPromiseLikeReceiver(initializer, visitedBindingIdentifiers));
  };
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      const callee: EsTreeNode = cursor.callee as EsTreeNode;
      if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee)) {
        const methodName = getStaticPropertyName(callee);
        if (
          methodName === "catch" &&
          hasPromiseLikeReceiver(callee.object) &&
          isAbsorbingHandler(cursor.arguments?.[0] as EsTreeNode)
        ) {
          return true;
        }
        if (methodName === "then" && isAbsorbingHandler(cursor.arguments?.[1] as EsTreeNode)) {
          return true;
        }
      }
      cursor = isNodeOfType(callee, "MemberExpression") ? (callee.object as EsTreeNode) : null;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object as EsTreeNode;
      continue;
    }
    return false;
  }
  return false;
};
export const isNeverRejectingHelperCall = (root: EsTreeNode, scopes?: ScopeAnalysis): boolean => {
  const inner = stripParenExpression(root);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  let helper: EsTreeNode | null = null;
  if (scopes) {
    helper = resolveExactLocalFunction(callee, scopes);
  } else {
    const binding = findVariableInitializer(callee, callee.name);
    const declaration = binding?.bindingIdentifier.parent;
    if (
      isNodeOfType(declaration, "FunctionDeclaration") ||
      (isNodeOfType(declaration, "VariableDeclarator") &&
        isNodeOfType(declaration.parent, "VariableDeclaration") &&
        declaration.parent.kind === "const")
    ) {
      helper = binding?.initializer ?? null;
    }
  }
  if (!helper || !isFunctionLike(helper)) return false;

  if (helper.async) {
    let isRejectionProof = true;
    let sawSuspension = false;
    walkOwnFunctionScope(helper, (child: EsTreeNode) => {
      if (!isRejectionProof) return false;
      if (isNodeOfType(child, "AwaitExpression")) {
        sawSuspension = true;
        if (!isInsideNonRethrowingTry(child, helper)) isRejectionProof = false;
      }
      if (
        isNodeOfType(child, "ThrowStatement") &&
        !isInsideTryStatement(child, { region: "block", boundary: helper })
      ) {
        isRejectionProof = false;
      }
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        const returned = stripParenExpression(child.argument);
        if (
          !isNodeOfType(returned, "AwaitExpression") &&
          !isDefinitelyNonThenableValue(returned) &&
          !isPromiseResolveCall(returned, scopes) &&
          !isNonRejectingPromiseConstruction(returned, scopes) &&
          !chainCarriesRejectionHandler(returned, scopes)
        ) {
          isRejectionProof = false;
        }
      }
    });
    return isRejectionProof && sawSuspension;
  }

  const returnedExpressions: EsTreeNode[] = [];
  if (
    isNodeOfType(helper, "ArrowFunctionExpression") &&
    !isNodeOfType(helper.body, "BlockStatement")
  ) {
    returnedExpressions.push(stripParenExpression(helper.body as EsTreeNode));
  } else {
    walkOwnFunctionScope(helper, (child: EsTreeNode) => {
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        returnedExpressions.push(stripParenExpression(child.argument as EsTreeNode));
      }
    });
  }
  return (
    returnedExpressions.length > 0 &&
    returnedExpressions.every(
      (returned) =>
        chainCarriesRejectionHandler(returned, scopes) ||
        isPromiseResolveCall(returned, scopes) ||
        isNonRejectingPromiseConstruction(returned, scopes),
    )
  );
};
