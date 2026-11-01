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
  const isRecordReset =
    isNodeOfType(emptyState, "ObjectExpression") && emptyState.properties.length === 0;
  if (
    !isRecordReset &&
    (!isNodeOfType(emptyState, "NewExpression") ||
      emptyState.arguments.length !== 0 ||
      !isNodeOfType(emptyState.callee, "Identifier") ||
      emptyState.callee.name !== "Set" ||
      !context.scopes.isGlobalReference(emptyState.callee))
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
    const receiver = node.callee.object;
    const valuesCall = isNodeOfType(receiver, "CallExpression") ? receiver : null;
    if (
      isRecordReset &&
      (!valuesCall ||
        !isNodeOfType(valuesCall.callee, "MemberExpression") ||
        getStaticPropertyName(valuesCall.callee) !== "values" ||
        !isNodeOfType(valuesCall.callee.object, "Identifier") ||
        valuesCall.callee.object.name !== "Object" ||
        !context.scopes.isGlobalReference(valuesCall.callee.object) ||
        valuesCall.arguments.length !== 1)
    )
      return;
    const collectionExpression = isRecordReset ? valuesCall?.arguments[0] : receiver;
    if (!collectionExpression) return;
    const collection = resolveReactRefCurrentOriginSymbol(collectionExpression, context.scopes);
    const initializer = collection?.initializer;
    const initialCollection = isNodeOfType(initializer, "CallExpression")
      ? initializer.arguments[0]
      : null;
    if (!collection) return;
    if (
      isRecordReset
        ? !isNodeOfType(initialCollection, "ObjectExpression") ||
          initialCollection.properties.length !== 0
        : !isNodeOfType(initialCollection, "NewExpression") ||
          initialCollection.arguments.length !== 0 ||
          !isNodeOfType(initialCollection.callee, "Identifier") ||
          initialCollection.callee.name !== "Map" ||
          !context.scopes.isGlobalReference(initialCollection.callee)
    )
      return;
    const callback = node.arguments[0];
    if (!callback || !isFunctionLike(callback) || callback.async || callback.generator) return;
    const callbackBody = stripParenExpression(callback.body);
    const statement =
      isNodeOfType(callbackBody, "BlockStatement") && callbackBody.body.length === 1
        ? callbackBody.body[0]
        : null;
    const release = isNodeOfType(statement, "ExpressionStatement")
      ? statement.expression
      : callbackBody;
    if (
      !isNodeOfType(release, "CallExpression") ||
      !isNodeOfType(release.callee, "MemberExpression") ||
      getStaticPropertyName(release.callee) !== "abort"
    )
      return;
    const handle = release.callee.object;
    const field = isNodeOfType(handle, "MemberExpression") ? getStaticPropertyName(handle) : null;
    const parameter = callback.params[0];
    if (
      (!isRecordReset && !field) ||
      !isNodeOfType(parameter, "Identifier") ||
      !(isRecordReset
        ? isNodeOfType(handle, "Identifier")
        : isNodeOfType(handle, "MemberExpression")) ||
      context.scopes.symbolFor(parameter) !==
        context.scopes.symbolFor(isNodeOfType(handle, "MemberExpression") ? handle.object : handle)
    )
      return;
    let didClear = false;
    let hasTrackedRequest = false;
    walkAst(component, (candidate) => {
      let key: EsTreeNode | undefined;
      let value: EsTreeNode | undefined;
      if (isRecordReset) {
        if (!isNodeOfType(candidate, "AssignmentExpression") || candidate.operator !== "=") return;
        if (resolveReactRefCurrentOriginSymbol(candidate.left, context.scopes) === collection) {
          if (
            isNodeOfType(candidate.right, "ObjectExpression") &&
            candidate.right.properties.length === 0 &&
            nodeDominatesNode(node, candidate, context) &&
            nodeDominatesNode(candidate, write, context)
          )
            didClear = true;
          return;
        }
        if (
          !isNodeOfType(candidate.left, "MemberExpression") ||
          !candidate.left.computed ||
          resolveReactRefCurrentOriginSymbol(candidate.left.object, context.scopes) !== collection
        )
          return;
        key = candidate.left.property;
        value = candidate.right;
      } else {
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
        )
          didClear = true;
        if (method !== "set") return;
        key = candidate.arguments[0];
        value = candidate.arguments[1];
      }
      if (!key || !value) return;
      if (isRecordReset) {
        if (!isNodeOfType(key, "Identifier")) return;
        const requestKeySymbol = context.scopes.symbolFor(key);
        if (
          !requestKeySymbol ||
          requestKeySymbol.references.some((reference) => reference.flag !== "read")
        )
          return;
      }
      const record = isNodeOfType(value, "Identifier")
        ? resolveConstIdentifierAlias(value, context.scopes)?.initializer
        : value;
      let controller = record;
      if (!isRecordReset) {
        controller = record && field ? getStaticObjectPropertyValue(record, field) : null;
      }
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
        if (isRecordReset && (updater.async || updater.generator)) return;
        const updatedCollection = stripParenExpression(updater.body);
        if (isRecordReset) {
          if (
            !isNodeOfType(updatedCollection, "ObjectExpression") ||
            updatedCollection.properties.length !== 2
          )
            return;
          const [spread, entry] = updatedCollection.properties;
          const previous = updater.params[0];
          if (
            !isNodeOfType(spread, "SpreadElement") ||
            !isNodeOfType(previous, "Identifier") ||
            !isNodeOfType(spread.argument, "Identifier") ||
            context.scopes.symbolFor(spread.argument) !== context.scopes.symbolFor(previous) ||
            !isNodeOfType(entry, "Property") ||
            !entry.computed ||
            !isNodeOfType(entry.value, "Literal") ||
            entry.value.value !== true
          )
            return;
          if (
            areExpressionsStructurallyEqual(key, entry.key, {
              areIdentifiersEqual: (first, second) =>
                context.scopes.symbolFor(first) === context.scopes.symbolFor(second),
            })
          )
            hasTrackedRequest = true;
          return;
        }
        if (
          !isNodeOfType(updatedCollection, "CallExpression") ||
          !isNodeOfType(updatedCollection.callee, "MemberExpression") ||
          getStaticPropertyName(updatedCollection.callee) !== "add"
        )
          return;
        const updatedSet = updatedCollection.callee.object;
        if (
          !isNodeOfType(updatedSet, "NewExpression") ||
          !isNodeOfType(updatedSet.callee, "Identifier") ||
          updatedSet.callee.name !== "Set" ||
          !context.scopes.isGlobalReference(updatedSet.callee)
        )
          return;
        if (
          areExpressionsStructurallyEqual(key, updatedCollection.arguments[0], {
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
