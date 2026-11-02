import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

import { OWNED_NATIVE_REF_SINGLE_VALUE_COUNT } from "./constants.js";

const isActiveElement = (raw: EsTreeNode, module: SourceProjectModule): boolean => {
  const node = stripParenExpression(raw);
  if (!isNodeOfType(node, "MemberExpression") || getStaticPropertyName(node) !== "activeElement")
    return false;
  const receiver = stripParenExpression(node.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "document" &&
    module.scopes.isGlobalReference(receiver)
  );
};

const isPureIdentitySearch = (raw: EsTreeNode, module: SourceProjectModule): boolean => {
  const callback = stripParenExpression(raw);
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
  const [parameter, ...remaining] = callback.params;
  if (!isNodeOfType(parameter, "Identifier") || remaining.length) return false;
  const symbol = module.scopes.symbolFor(parameter);
  const result = getSingleReturnExpression(callback);
  const predicate = result ? stripParenExpression(result) : null;
  if (
    !symbol ||
    !predicate ||
    !isNodeOfType(predicate, "BinaryExpression") ||
    (predicate.operator !== "===" && predicate.operator !== "!==") ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes)
  )
    return false;
  const isParameter = (rawOperand: EsTreeNode): boolean => {
    const operand = stripParenExpression(rawOperand);
    return isNodeOfType(operand, "Identifier") && module.scopes.symbolFor(operand) === symbol;
  };
  const isNodeName = (rawOperand: EsTreeNode): boolean => {
    const operand = stripParenExpression(rawOperand);
    return (
      isNodeOfType(operand, "MemberExpression") &&
      getStaticPropertyName(operand) === "nodeName" &&
      isParameter(operand.object)
    );
  };
  const left = stripParenExpression(predicate.left);
  const right = stripParenExpression(predicate.right);
  const hasIdentity =
    (isParameter(left) && isActiveElement(right, module)) ||
    (isParameter(right) && isActiveElement(left, module));
  const hasNodeName =
    (isNodeName(left) && isNodeOfType(right, "Literal") && typeof right.value === "string") ||
    (isNodeName(right) && isNodeOfType(left, "Literal") && typeof left.value === "string");
  if (!hasIdentity && !hasNodeName) return false;
  return (
    symbol.references.length > 0 &&
    symbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      return (
        root === left ||
        root === right ||
        (isNodeOfType(root.parent, "MemberExpression") &&
          (root.parent === left || root.parent === right) &&
          root.parent.object === root)
      );
    })
  );
};

const isFindIndexReceiver = (raw: EsTreeNode, module: SourceProjectModule): boolean => {
  const receiver = findTransparentExpressionRoot(raw);
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    getStaticPropertyName(member) !== "findIndex"
  )
    return false;
  const method = findTransparentExpressionRoot(member);
  const call = method.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== method) return false;
  const [callback, ...remaining] = call.arguments;
  return Boolean(callback && !remaining.length && isPureIdentitySearch(callback, module));
};

export const isReadonlyNativeSnapshot = (
  rawCollection: EsTreeNode,
  module: SourceProjectModule,
): boolean => {
  const collection = findTransparentExpressionRoot(rawCollection);
  const spread = collection.parent;
  if (!isNodeOfType(spread, "SpreadElement") || spread.argument !== collection) return false;
  const array = spread.parent;
  if (
    !isNodeOfType(array, "ArrayExpression") ||
    array.elements.length !== OWNED_NATIVE_REF_SINGLE_VALUE_COUNT ||
    array.elements[0] !== spread
  )
    return false;
  if (isFindIndexReceiver(array, module)) return true;
  const root = findTransparentExpressionRoot(array);
  const declaration = root.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== root ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const symbol = module.scopes.symbolFor(declaration.id);
  if (
    !symbol ||
    getDirectConstInitializer(symbol) !== root ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) ||
    !symbol.references.length
  )
    return false;
  return symbol.references.every((reference) => isFindIndexReceiver(reference.identifier, module));
};
