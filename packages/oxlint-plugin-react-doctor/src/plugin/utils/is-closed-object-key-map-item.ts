import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface DirectMemberCall {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly receiver: EsTreeNode;
}

const readDirectMemberCall = (expression: EsTreeNode, method: string): DirectMemberCall | null => {
  const node = stripParenExpression(expression);
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== method
  )
    return null;
  return { node, receiver: stripParenExpression(node.callee.object) };
};

const isSingleItemArrow = (
  callback: EsTreeNode | null | undefined,
): callback is EsTreeNodeOfType<"ArrowFunctionExpression"> => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return false;
  let hasOpaqueScopeAccess = false;
  walkAst(callback.body, (node) => {
    if (hasOpaqueScopeAccess) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        (node.name === "arguments" || node.name === "eval" || node.name === "Function"))
    )
      hasOpaqueScopeAccess = true;
  });
  return !hasOpaqueScopeAccess;
};

const readObjectKeysArgument = (
  expression: EsTreeNode,
  module: SourceProjectModule,
): EsTreeNode | null => {
  let receiver = expression;
  const slice = readDirectMemberCall(receiver, "slice");
  if (slice) {
    if (
      slice.node.arguments.length > 2 ||
      !slice.node.arguments.every(
        (argument) =>
          isNodeOfType(argument, "Literal") &&
          typeof argument.value === "number" &&
          Number.isSafeInteger(argument.value),
      )
    )
      return null;
    receiver = slice.receiver;
  }
  const filter = readDirectMemberCall(receiver, "filter");
  if (filter) {
    if (filter.node.arguments.length !== 1 || !isSingleItemArrow(filter.node.arguments[0]))
      return null;
    receiver = filter.receiver;
  }
  const keys = readDirectMemberCall(receiver, "keys");
  if (
    !keys ||
    !isNodeOfType(keys.receiver, "Identifier") ||
    keys.receiver.name !== "Object" ||
    !module.scopes.isGlobalReference(keys.receiver) ||
    keys.node.arguments.length !== 1
  )
    return null;
  const argument = keys.node.arguments[0];
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  return stripParenExpression(argument);
};

const findMapGuardRead = (
  mapCall: EsTreeNode,
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): EsTreeNode | null => {
  let child = mapCall;
  for (let parent = child.parent; parent; parent = child.parent) {
    if (isFunctionLike(parent)) return null;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      parent.consequent === child &&
      isNodeOfType(parent.test, "Identifier") &&
      module.scopes.symbolFor(parent.test) === symbol
    )
      return parent.test;
    child = parent;
  }
  return null;
};

// The caller must establish ordinary Object and Array provider behavior.
export const isClosedObjectKeyMapItem = (
  item: EsTreeNode,
  module: SourceProjectModule,
): boolean => {
  if (!isNodeOfType(item, "Identifier")) return false;
  const itemSymbol = module.scopes.symbolFor(item);
  if (
    itemSymbol?.kind !== "parameter" ||
    module.scopes.referenceFor(item)?.flag !== "read" ||
    itemSymbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const callback = findEnclosingFunction(itemSymbol.bindingIdentifier);
  if (!isSingleItemArrow(callback) || callback.params[0] !== itemSymbol.bindingIdentifier)
    return false;
  if (!callback.parent) return false;
  const map = readDirectMemberCall(callback.parent, "map");
  if (!map || map.node.arguments.length !== 1 || map.node.arguments[0] !== callback) return false;
  if (!isNodeOfType(map.receiver, "Identifier"))
    return readObjectKeysArgument(map.receiver, module) !== null;

  const receiverSymbol = module.scopes.symbolFor(map.receiver);
  if (
    receiverSymbol?.kind !== "const" ||
    !receiverSymbol.initializer ||
    !isNodeOfType(receiverSymbol.declarationNode, "VariableDeclarator") ||
    receiverSymbol.declarationNode.id !== receiverSymbol.bindingIdentifier ||
    receiverSymbol.declarationNode.range[1] > map.node.range[0]
  )
    return false;
  const initializer = stripParenExpression(receiverSymbol.initializer);
  let guardRead: EsTreeNode | null = null;
  if (isNodeOfType(initializer, "LogicalExpression") && initializer.operator === "&&") {
    const condition = stripParenExpression(initializer.left);
    const keysArgument = readObjectKeysArgument(initializer.right, module);
    if (!isNodeOfType(condition, "Identifier") || !isNodeOfType(keysArgument, "Identifier"))
      return false;
    const conditionSymbol = module.scopes.symbolFor(condition);
    if (!conditionSymbol || module.scopes.symbolFor(keysArgument) !== conditionSymbol) return false;
    guardRead = findMapGuardRead(map.node, receiverSymbol, module);
    if (!guardRead) return false;
  } else if (!readObjectKeysArgument(initializer, module)) return false;

  return (
    receiverSymbol.references.length === (guardRead ? 2 : 1) &&
    receiverSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        (reference.identifier === map.receiver || reference.identifier === guardRead),
    )
  );
};
