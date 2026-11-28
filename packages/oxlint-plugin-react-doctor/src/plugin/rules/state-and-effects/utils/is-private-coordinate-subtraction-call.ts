import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const getLocalSubtractionFunction = (symbol: SymbolDescriptor): EsTreeNode | null => {
  const declaration = symbol.declarationNode;
  if (symbol.kind === "const" && isNodeOfType(declaration, "VariableDeclarator")) {
    const owner = declaration.parent?.parent;
    const initializer = getDirectConstInitializer(symbol);
    const object = initializer ? stripParenExpression(initializer) : null;
    if (
      (!isNodeOfType(owner, "BlockStatement") &&
        (!isNodeOfType(owner, "Program") || owner.sourceType !== "module")) ||
      !isNodeOfType(object, "ObjectExpression") ||
      object.properties.length !== 1
    ) {
      return null;
    }
    const [method] = object.properties;
    return isNodeOfType(method, "Property") &&
      method.kind === "init" &&
      getStaticPropertyKeyName(method) === "sub"
      ? stripParenExpression(method.value)
      : null;
  }
  if (
    symbol.kind !== "ts-module" ||
    !isNodeOfType(declaration, "TSModuleDeclaration") ||
    declaration.declare ||
    !isNodeOfType(declaration.parent, "Program") ||
    declaration.parent.sourceType !== "module" ||
    !isNodeOfType(declaration.body, "TSModuleBlock") ||
    declaration.body.body.length !== 1
  ) {
    return null;
  }
  const [exported] = declaration.body.body;
  const method = isNodeOfType(exported, "ExportNamedDeclaration") ? exported.declaration : null;
  return isNodeOfType(method, "FunctionDeclaration") && method.id?.name === "sub" ? method : null;
};

const isMatchingCoordinateRead = (
  expression: EsTreeNode,
  parameter: SymbolDescriptor,
  field: string,
  context: RuleContext,
): boolean => {
  const member = stripParenExpression(expression);
  return (
    isNodeOfType(member, "MemberExpression") &&
    !member.optional &&
    getStaticPropertyKeyName(member) === field &&
    context.scopes.symbolFor(stripParenExpression(member.object)) === parameter
  );
};

const returnsCoordinateDifferences = (method: EsTreeNode, context: RuleContext): boolean => {
  if (!isFunctionLike(method) || method.async || method.generator || method.params.length !== 2)
    return false;
  const [left, right] = method.params;
  if (!isNodeOfType(left, "Identifier") || !isNodeOfType(right, "Identifier")) return false;
  const leftParameter = context.scopes.symbolFor(left);
  const rightParameter = context.scopes.symbolFor(right);
  const result = getSingleReturnExpression(method);
  const object = result ? stripParenExpression(result) : null;
  if (
    !leftParameter ||
    !rightParameter ||
    leftParameter === rightParameter ||
    !isNodeOfType(object, "ObjectExpression") ||
    object.properties.length === 0
  ) {
    return false;
  }
  return object.properties.every((entry) => {
    if (!isNodeOfType(entry, "Property") || entry.kind !== "init" || entry.method) return false;
    const field = getStaticPropertyKeyName(entry);
    const value = stripParenExpression(entry.value);
    return (
      field !== null &&
      field !== "__proto__" &&
      isNodeOfType(value, "BinaryExpression") &&
      value.operator === "-" &&
      isMatchingCoordinateRead(value.left, leftParameter, field, context) &&
      isMatchingCoordinateRead(value.right, rightParameter, field, context)
    );
  });
};

export const isPrivateCoordinateSubtractionCall = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== 2 ||
    node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    return false;
  }
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyKeyName(callee) !== "sub"
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const owner = context.scopes.symbolFor(receiver);
  if (!owner) return false;
  const method = getLocalSubtractionFunction(owner);
  return Boolean(
    method &&
    returnsCoordinateDifferences(method, context) &&
    owner.scope.symbols.filter((symbol) => symbol.name === owner.name).length === 1 &&
    hasCompleteSymbolReferences(owner, context.scopes.rootScope.node, context.scopes) &&
    owner.references.every(({ identifier, flag }) => {
      const member = identifier.parent;
      return (
        flag === "read" &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === identifier &&
        !member.optional &&
        getStaticPropertyKeyName(member) === "sub" &&
        isNodeOfType(member.parent, "CallExpression") &&
        member.parent.callee === member &&
        !member.parent.optional
      );
    }),
  );
};
