import { hasClosedValidatorEnvironment } from "./has-closed-validator-environment.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import { OWN_HOOK_SINGLE_COUNT, OWN_HOOK_FIRST_INDEX } from "./constants.js";

export interface ClosedDataValidatorInput {
  readonly functionNode: EsTreeNode;
  readonly module: AsyncEventSourceModule;
  readonly modules: ReadonlyArray<AsyncEventSourceModule>;
}

export const isClosedDataValidator = ({
  functionNode,
  module,
  modules,
}: ClosedDataValidatorInput): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length !== OWN_HOOK_SINGLE_COUNT ||
    !isNodeOfType(functionNode.params[OWN_HOOK_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(functionNode.body, "BlockStatement") ||
    !hasClosedValidatorEnvironment(modules)
  )
    return false;
  const parameter = module.scopes.symbolFor(functionNode.params[OWN_HOOK_FIRST_INDEX]);
  const statements = functionNode.body.body;
  const declaration = statements.at(OWN_HOOK_FIRST_INDEX);
  const returned = statements.at(-OWN_HOOK_SINGLE_COUNT);
  if (
    !parameter ||
    !hasReadonlyAsyncEventBinding(parameter, module) ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    !["const", "let"].includes(declaration.kind) ||
    declaration.declarations.length !== OWN_HOOK_SINGLE_COUNT ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  )
    return false;
  const record = declaration.declarations[OWN_HOOK_FIRST_INDEX];
  if (
    !isNodeOfType(record.id, "Identifier") ||
    !record.init ||
    !isNodeOfType(stripParenExpression(record.init), "ObjectExpression")
  )
    return false;
  const initial = stripParenExpression(record.init);
  if (
    !isNodeOfType(initial, "ObjectExpression") ||
    initial.properties.length !== OWN_HOOK_FIRST_INDEX
  )
    return false;
  const recordSymbol = module.scopes.symbolFor(record.id);
  const returnValue = stripParenExpression(returned.argument);
  if (
    !recordSymbol ||
    !hasReadonlyAsyncEventBinding(recordSymbol, module) ||
    !isNodeOfType(returnValue, "Identifier") ||
    module.scopes.symbolFor(returnValue) !== recordSymbol
  )
    return false;
  const parameterReads = new Set<EsTreeNode>();
  const recordReads = new Set<EsTreeNode>([returnValue]);
  const isParameterField = (raw: EsTreeNode): boolean => {
    const value = stripParenExpression(raw);
    if (!isNodeOfType(value, "MemberExpression") || value.optional || value.computed) return false;
    const receiver = stripParenExpression(value.object);
    if (!isNodeOfType(receiver, "Identifier") || module.scopes.symbolFor(receiver) !== parameter)
      return false;
    const name = getStaticPropertyName(value);
    if (!name || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) return false;
    parameterReads.add(receiver);
    return true;
  };
  const isCondition = (raw: EsTreeNode): boolean => {
    const value = stripParenExpression(raw);
    if (isParameterField(value)) return true;
    if (isNodeOfType(value, "UnaryExpression") && value.operator === "!")
      return isCondition(value.argument);
    if (
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      value.arguments.length !== OWN_HOOK_SINGLE_COUNT ||
      !isNodeOfType(value.callee, "MemberExpression") ||
      value.callee.optional ||
      value.callee.computed ||
      getStaticPropertyName(value.callee) !== "test"
    )
      return false;
    const pattern = stripParenExpression(value.callee.object);
    return (
      isNodeOfType(pattern, "Literal") &&
      "regex" in pattern &&
      Boolean(pattern.regex) &&
      isParameterField(value.arguments[OWN_HOOK_FIRST_INDEX])
    );
  };
  const isStatement = (statement: EsTreeNode): boolean => {
    if (isNodeOfType(statement, "BlockStatement")) return statement.body.every(isStatement);
    if (isNodeOfType(statement, "IfStatement"))
      return (
        isCondition(statement.test) &&
        isStatement(statement.consequent) &&
        (!statement.alternate || isStatement(statement.alternate))
      );
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "AssignmentExpression") ||
      statement.expression.operator !== "="
    )
      return false;
    const target = stripParenExpression(statement.expression.left);
    const value = stripParenExpression(statement.expression.right);
    if (
      !isNodeOfType(target, "MemberExpression") ||
      target.computed ||
      target.optional ||
      !isNodeOfType(value, "Literal") ||
      typeof value.value !== "string"
    )
      return false;
    const receiver = stripParenExpression(target.object);
    if (!isNodeOfType(receiver, "Identifier") || module.scopes.symbolFor(receiver) !== recordSymbol)
      return false;
    const name = getStaticPropertyName(target);
    if (!name || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) return false;
    recordReads.add(receiver);
    return true;
  };
  if (!statements.slice(OWN_HOOK_SINGLE_COUNT, -OWN_HOOK_SINGLE_COUNT).every(isStatement))
    return false;
  return (
    hasOnlyAllowedSymbolReads({
      symbol: parameter,
      allowedIdentifiers: parameterReads,
      program: module.program,
      scopes: module.scopes,
    }) &&
    hasOnlyAllowedSymbolReads({
      symbol: recordSymbol,
      allowedIdentifiers: recordReads,
      program: module.program,
      scopes: module.scopes,
    })
  );
};
