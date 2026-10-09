import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { areExpressionsStructurallyEqual } from "../../../utils/are-expressions-structurally-equal.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveReactRefCurrentOriginSymbol } from "../../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isOwnedRequestMapReset = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression")) return false;
  const emptyState = write.arguments[0];
  if (
    !isNodeOfType(emptyState, "NewExpression") ||
    emptyState.arguments.length !== 0 ||
    !isNodeOfType(emptyState.callee, "Identifier") ||
    emptyState.callee.name !== "Set" ||
    !context.scopes.isGlobalReference(emptyState.callee)
  )
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const owner = findEnclosingFunction(write);
  const component = pair ? findEnclosingFunction(pair.declarator) : null;
  if (!pair || !owner || !component) return false;
  let isOwnedReset = false;
  walkAst(owner, (node) => {
    if (isOwnedReset || (node !== owner && isFunctionLike(node))) return false;
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      getStaticPropertyName(node.callee) !== "forEach" ||
      !nodeDominatesNode(node, write, context)
    )
      return;
    const collection = resolveReactRefCurrentOriginSymbol(node.callee.object, context.scopes);
    const initializer = collection?.initializer;
    const initialMap = isNodeOfType(initializer, "CallExpression")
      ? initializer.arguments[0]
      : null;
    if (
      !collection ||
      !isNodeOfType(initialMap, "NewExpression") ||
      initialMap.arguments.length !== 0 ||
      !isNodeOfType(initialMap.callee, "Identifier") ||
      initialMap.callee.name !== "Map" ||
      !context.scopes.isGlobalReference(initialMap.callee)
    )
      return;
    const callback = node.arguments[0];
    if (!callback || !isFunctionLike(callback) || callback.async || callback.generator) return;
    const release = stripParenExpression(callback.body);
    if (
      !isNodeOfType(release, "CallExpression") ||
      !isNodeOfType(release.callee, "MemberExpression") ||
      getStaticPropertyName(release.callee) !== "abort" ||
      !isNodeOfType(release.callee.object, "MemberExpression")
    )
      return;
    const handle = release.callee.object;
    const field = getStaticPropertyName(handle);
    const parameter = callback.params[0];
    if (
      !field ||
      !isNodeOfType(parameter, "Identifier") ||
      !isNodeOfType(handle.object, "Identifier") ||
      context.scopes.symbolFor(parameter) !== context.scopes.symbolFor(handle.object)
    )
      return;
    let didClear = false;
    let hasTrackedRequest = false;
    walkAst(component, (candidate) => {
      if (
        !isNodeOfType(candidate, "CallExpression") ||
        !isNodeOfType(candidate.callee, "MemberExpression") ||
        resolveReactRefCurrentOriginSymbol(candidate.callee.object, context.scopes) !== collection
      )
        return;
      const method = getStaticPropertyName(candidate.callee);
      if (
        method === "clear" &&
        nodeDominatesNode(node, candidate, context) &&
        nodeDominatesNode(candidate, write, context)
      ) {
        didClear = true;
      }
      if (method !== "set") return;
      const key = candidate.arguments[0];
      const value = candidate.arguments[1];
      if (!key || !value) return;
      const record = isNodeOfType(value, "Identifier")
        ? resolveConstIdentifierAlias(value, context.scopes)?.initializer
        : value;
      const controller = record ? getStaticObjectPropertyValue(record, field) : null;
      if (
        !isNodeOfType(controller, "NewExpression") ||
        !isNodeOfType(controller.callee, "Identifier") ||
        controller.callee.name !== "AbortController" ||
        !context.scopes.isGlobalReference(controller.callee)
      )
        return;
      const requestOwner = findEnclosingFunction(candidate);
      if (!requestOwner) return;
      walkAst(requestOwner, (stateWrite) => {
        if (stateWrite !== requestOwner && isFunctionLike(stateWrite)) return false;
        if (
          !isNodeOfType(stateWrite, "CallExpression") ||
          context.scopes.symbolFor(stateWrite.callee) !== pair.setterSymbol ||
          !nodeDominatesNode(candidate, stateWrite, context)
        )
          return;
        const updater = stateWrite.arguments[0];
        if (!updater || !isFunctionLike(updater)) return;
        const add = stripParenExpression(updater.body);
        if (
          !isNodeOfType(add, "CallExpression") ||
          !isNodeOfType(add.callee, "MemberExpression") ||
          getStaticPropertyName(add.callee) !== "add"
        )
          return;
        const updatedSet = add.callee.object;
        if (
          !isNodeOfType(updatedSet, "NewExpression") ||
          !isNodeOfType(updatedSet.callee, "Identifier") ||
          updatedSet.callee.name !== "Set" ||
          !context.scopes.isGlobalReference(updatedSet.callee)
        )
          return;
        if (
          areExpressionsStructurallyEqual(key, add.arguments[0], {
            areIdentifiersEqual: (first, second) =>
              context.scopes.symbolFor(first) === context.scopes.symbolFor(second),
          })
        )
          hasTrackedRequest = true;
      });
    });
    isOwnedReset = didClear && hasTrackedRequest;
  });
  return isOwnedReset;
};
