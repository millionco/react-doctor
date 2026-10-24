import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import {
  NEXT_QUERY_SINGLE_VALUE_COUNT,
  NEXT_QUERY_SET_ARGUMENT_COUNT,
} from "../constants/nextjs.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactFunctionCall } from "./is-react-function-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface NativeQueryStateRead {
  readonly call: EsTreeNode;
  readonly component: EsTreeNode;
  readonly constructor: EsTreeNode;
  readonly member: EsTreeNode;
  readonly record: SymbolDescriptor;
  readonly propName: string;
}

export const findNativeQueryStateRead = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
): NativeQueryStateRead | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isReactFunctionCall(call, "useState") ||
    call.arguments.length !== NEXT_QUERY_SINGLE_VALUE_COUNT
  )
    return null;
  const builder = stripParenExpression(call.arguments[0]);
  const component = findEnclosingFunction(call);
  if (
    !isFunctionLike(builder) ||
    builder.async ||
    (builder.type !== "ArrowFunctionExpression" && builder.generator) ||
    builder.params.length ||
    !isNodeOfType(builder.body, "BlockStatement") ||
    !isFunctionLike(component) ||
    component.async ||
    (component.type !== "ArrowFunctionExpression" && component.generator) ||
    component.params.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(component.params[0], "ObjectPattern")
  )
    return null;
  const [allocation, iteration, completion, ...remaining] = builder.body.body;
  if (
    remaining.length ||
    !isNodeOfType(allocation, "VariableDeclaration") ||
    allocation.kind !== "const" ||
    allocation.declarations.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(iteration, "ForInStatement") ||
    !isNodeOfType(iteration.left, "VariableDeclaration") ||
    iteration.left.kind !== "const" ||
    iteration.left.declarations.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(iteration.right, "Identifier") ||
    !isNodeOfType(iteration.body, "BlockStatement") ||
    iteration.body.body.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(completion, "ReturnStatement") ||
    !isNodeOfType(completion.argument, "Identifier")
  )
    return null;
  const declaration = allocation.declarations[0];
  const keyDeclaration = iteration.left.declarations[0];
  const statement = iteration.body.body[0];
  if (
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.init, "NewExpression") ||
    !isNodeOfType(declaration.init.callee, "Identifier") ||
    declaration.init.callee.name !== "URLSearchParams" ||
    declaration.init.arguments.length ||
    !isNodeOfType(keyDeclaration.id, "Identifier") ||
    keyDeclaration.init ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "CallExpression") ||
    statement.expression.optional ||
    !isNodeOfType(statement.expression.callee, "MemberExpression") ||
    statement.expression.callee.optional ||
    statement.expression.callee.computed ||
    !isNodeOfType(statement.expression.callee.property, "Identifier") ||
    statement.expression.callee.property.name !== "set" ||
    !isNodeOfType(statement.expression.callee.object, "Identifier") ||
    statement.expression.arguments.length !== NEXT_QUERY_SET_ARGUMENT_COUNT ||
    !isNodeOfType(statement.expression.arguments[0], "Identifier")
  )
    return null;
  const value = statement.expression.arguments[1];
  if (
    !isNodeOfType(value, "LogicalExpression") ||
    value.operator !== "??" ||
    !isNodeOfType(value.right, "Literal") ||
    "regex" in value.right ||
    typeof value.right.value !== "string" ||
    !isNodeOfType(value.left, "MemberExpression") ||
    !value.left.computed ||
    value.left.optional ||
    !isNodeOfType(value.left.object, "Identifier") ||
    !isNodeOfType(value.left.property, "Identifier")
  )
    return null;
  const instance = scopes.symbolFor(declaration.id);
  const key = scopes.symbolFor(keyDeclaration.id);
  const record = scopes.symbolFor(iteration.right);
  const propName = record && getDestructuredBindingPropertyName(record.bindingIdentifier);
  if (
    !instance ||
    !key ||
    !record ||
    !propName ||
    record.bindingIdentifier.parent?.parent !== component.params[0] ||
    scopes.symbolFor(statement.expression.callee.object) !== instance ||
    scopes.symbolFor(completion.argument) !== instance ||
    scopes.symbolFor(statement.expression.arguments[0]) !== key ||
    scopes.symbolFor(value.left.property) !== key ||
    scopes.symbolFor(value.left.object) !== record ||
    !hasOnlyAllowedSymbolReads({
      symbol: instance,
      allowedIdentifiers: new Set([statement.expression.callee.object, completion.argument]),
      program: scopes.rootScope.node,
      scopes,
    }) ||
    !hasOnlyAllowedSymbolReads({
      symbol: key,
      allowedIdentifiers: new Set([statement.expression.arguments[0], value.left.property]),
      program: scopes.rootScope.node,
      scopes,
    }) ||
    !hasOnlyAllowedSymbolReads({
      symbol: record,
      allowedIdentifiers: new Set([iteration.right, value.left.object]),
      program: scopes.rootScope.node,
      scopes,
    })
  )
    return null;
  return { call, component, constructor: declaration.init, member: value.left, record, propName };
};
