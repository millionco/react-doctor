import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getShopifyDataProperties } from "./get-shopify-data-properties.js";
import {
  SHOPIFY_ERROR_STATUS_CODE,
  SHOPIFY_FIRST_STATEMENT_INDEX,
  SHOPIFY_GATE_STATEMENT_INDEX,
  SHOPIFY_INVALID_STATUS_CODE,
  SHOPIFY_RAW_ARGUMENT_COUNT,
  SHOPIFY_VALIDATION_ARGUMENT_COUNT,
  SHOPIFY_VALIDATION_PARAMETER_COUNT,
} from "./shopify-webhook-constants.js";

export interface ShopifyValidationHandler {
  client: SymbolDescriptor;
  clientRead: EsTreeNode;
}

const isMember = (node: EsTreeNode | null | undefined, name: string): boolean =>
  Boolean(
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    !node.optional &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === name,
  );

const isSymbolRead = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const getOnlyReturn = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "ReturnStatement")) return node;
  if (
    !isNodeOfType(node, "BlockStatement") ||
    node.body.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT
  )
    return null;
  const statement = node.body[SHOPIFY_FIRST_STATEMENT_INDEX];
  return isNodeOfType(statement, "ReturnStatement") ? statement : null;
};

export const getClosedShopifyValidationHandler = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): ShopifyValidationHandler | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const exports = program.body.filter((statement) => statement.type.startsWith("Export"));
  const selectedExport = exports[SHOPIFY_FIRST_STATEMENT_INDEX];
  if (
    exports.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
    !isNodeOfType(selectedExport, "ExportDefaultDeclaration") ||
    !isNodeOfType(selectedExport.declaration, "Identifier")
  )
    return null;
  const handlerSymbol = scopes.symbolFor(selectedExport.declaration);
  const handler = handlerSymbol?.initializer;
  if (
    !handlerSymbol ||
    handlerSymbol.kind !== "const" ||
    !isNodeOfType(handlerSymbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(handlerSymbol.declarationNode.id, "Identifier") ||
    handlerSymbol.declarationNode.id !== handlerSymbol.bindingIdentifier ||
    !isNodeOfType(handlerSymbol.declarationNode.parent, "VariableDeclaration") ||
    handlerSymbol.declarationNode.parent.declarations.length !==
      SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
    handlerSymbol.declarationNode.parent.declarations[SHOPIFY_FIRST_STATEMENT_INDEX] !==
      handlerSymbol.declarationNode ||
    handlerSymbol.declarationNode.parent.parent !== program ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    !handler.async ||
    !isNodeOfType(handler.body, "BlockStatement") ||
    handler.params.length !== SHOPIFY_VALIDATION_PARAMETER_COUNT ||
    !handlerSymbol.references.every(
      (reference) =>
        reference.flag === "read" && reference.identifier === selectedExport.declaration,
    )
  )
    return null;
  let hasOtherFunction = false;
  walkAst(program, (node) => {
    if (isFunctionLike(node) && node !== handler) hasOtherFunction = true;
  });
  if (hasOtherFunction) return null;
  const [requestParameter, responseParameter] = handler.params;
  if (
    !isNodeOfType(requestParameter, "Identifier") ||
    !isNodeOfType(responseParameter, "Identifier")
  )
    return null;
  const request = scopes.symbolFor(requestParameter);
  const response = scopes.symbolFor(responseParameter);
  if (!request || !response || request === response) return null;
  const statements: ReadonlyArray<EsTreeNode> = handler.body.body;
  const tryStatement = statements.at(-SHOPIFY_VALIDATION_ARGUMENT_COUNT);
  if (
    !isNodeOfType(tryStatement, "TryStatement") ||
    tryStatement.finalizer ||
    !tryStatement.handler
  )
    return null;
  const catchClause = tryStatement.handler;
  const headerSymbols = new Set<SymbolDescriptor>();
  const headerReads = new Set<EsTreeNode>();
  for (const statement of statements.slice(
    SHOPIFY_FIRST_STATEMENT_INDEX,
    -SHOPIFY_VALIDATION_ARGUMENT_COUNT,
  )) {
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT
    )
      return null;
    const declaration = statement.declarations[SHOPIFY_FIRST_STATEMENT_INDEX];
    if (
      !declaration ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.init, "LogicalExpression") ||
      declaration.init.operator !== "||" ||
      !isNodeOfType(declaration.init.right, "Literal") ||
      declaration.init.right.value !== "" ||
      !isNodeOfType(declaration.init.left, "MemberExpression") ||
      declaration.init.left.optional ||
      !isNodeOfType(declaration.init.left.property, "Literal") ||
      typeof declaration.init.left.property.value !== "string" ||
      !declaration.init.left.computed ||
      !isNodeOfType(declaration.init.left.object, "MemberExpression") ||
      !isMember(declaration.init.left.object, "headers") ||
      !isSymbolRead(declaration.init.left.object.object, request, scopes)
    )
      return null;
    const symbol = scopes.symbolFor(declaration.id);
    if (
      !symbol ||
      !symbol.references.every(
        (reference) =>
          reference.flag === "read" && findEnclosingFunction(reference.identifier) === handler,
      )
    )
      return null;
    headerSymbols.add(symbol);
    headerReads.add(declaration.init.left.object);
  }
  const validationStatement = tryStatement.block.body[SHOPIFY_FIRST_STATEMENT_INDEX];
  const gate = tryStatement.block.body[SHOPIFY_GATE_STATEMENT_INDEX];
  if (
    !isNodeOfType(validationStatement, "VariableDeclaration") ||
    validationStatement.kind !== "const" ||
    validationStatement.declarations.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
    !isNodeOfType(gate, "IfStatement")
  )
    return null;
  const declaration = validationStatement.declarations[SHOPIFY_FIRST_STATEMENT_INDEX];
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.init, "AwaitExpression")
  )
    return null;
  const result = scopes.symbolFor(declaration.id);
  const validation = stripParenExpression(declaration.init.argument);
  if (
    !result ||
    !isNodeOfType(validation, "CallExpression") ||
    validation.optional ||
    validation.arguments.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
    !isNodeOfType(validation.callee, "MemberExpression") ||
    !isMember(validation.callee, "validate") ||
    !isNodeOfType(validation.callee.object, "MemberExpression") ||
    !isMember(validation.callee.object, "webhooks") ||
    !isNodeOfType(validation.callee.object.object, "Identifier")
  )
    return null;
  const clientRead = validation.callee.object.object;
  const client = scopes.symbolFor(clientRead);
  const argument = validation.arguments[SHOPIFY_FIRST_STATEMENT_INDEX];
  const properties = argument ? getShopifyDataProperties(argument, scopes) : null;
  if (!client || !properties || properties.size !== SHOPIFY_RAW_ARGUMENT_COUNT) return null;
  const rawBody = properties.get("rawBody");
  const rawRequest = properties.get("rawRequest");
  const rawResponse = properties.get("rawResponse");
  if (
    !rawBody ||
    !isNodeOfType(rawBody, "MemberExpression") ||
    !isMember(rawBody, "body") ||
    !isSymbolRead(rawBody.object, request, scopes) ||
    !rawRequest ||
    !isSymbolRead(rawRequest, request, scopes) ||
    !rawResponse ||
    !isSymbolRead(rawResponse, response, scopes)
  )
    return null;
  const catchParameter = catchClause.param;
  const catchSymbol = isNodeOfType(catchParameter, "Identifier")
    ? scopes.symbolFor(catchParameter)
    : null;
  const isPassiveErrorData = (value: EsTreeNode): boolean => {
    if (isNodeOfType(value, "Literal")) return true;
    if (isNodeOfType(value, "Identifier")) {
      const symbol = scopes.symbolFor(value);
      return Boolean(symbol && (headerSymbols.has(symbol) || symbol === catchSymbol));
    }
    if (
      isNodeOfType(value, "MemberExpression") &&
      isMember(value, "message") &&
      catchSymbol &&
      isSymbolRead(value.object, catchSymbol, scopes)
    )
      return true;
    if (isNodeOfType(value, "TemplateLiteral")) return value.expressions.every(isPassiveErrorData);
    const data = getShopifyDataProperties(value, scopes);
    return data !== null && [...data.values()].every(isPassiveErrorData);
  };
  const isErrorReturn = (branch: EsTreeNode, status: number): boolean => {
    const statement = getOnlyReturn(branch);
    if (
      !isNodeOfType(statement, "ReturnStatement") ||
      !isNodeOfType(statement.argument, "CallExpression") ||
      statement.argument.optional ||
      statement.argument.arguments.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
      !isNodeOfType(statement.argument.callee, "MemberExpression") ||
      !isMember(statement.argument.callee, "send")
    )
      return false;
    const statusCall = statement.argument.callee.object;
    const payload = statement.argument.arguments[SHOPIFY_FIRST_STATEMENT_INDEX];
    const statusArgument = isNodeOfType(statusCall, "CallExpression")
      ? statusCall.arguments[SHOPIFY_FIRST_STATEMENT_INDEX]
      : null;
    return (
      isNodeOfType(statusCall, "CallExpression") &&
      !statusCall.optional &&
      statusCall.arguments.length === SHOPIFY_VALIDATION_ARGUMENT_COUNT &&
      isNodeOfType(statusCall.callee, "MemberExpression") &&
      isMember(statusCall.callee, "status") &&
      isSymbolRead(statusCall.callee.object, response, scopes) &&
      isNodeOfType(statusArgument, "Literal") &&
      statusArgument.value === status &&
      Boolean(payload && isPassiveErrorData(payload))
    );
  };
  const isValidRead = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    isMember(node, "valid") &&
    isSymbolRead(node.object, result, scopes);
  if (isValidRead(gate.test)) {
    if (
      !isNodeOfType(gate.consequent, "BlockStatement") ||
      gate.consequent.body.length !== 0 ||
      !gate.alternate ||
      !isErrorReturn(gate.alternate, SHOPIFY_INVALID_STATUS_CODE)
    )
      return null;
  } else if (
    !isNodeOfType(gate.test, "UnaryExpression") ||
    gate.test.operator !== "!" ||
    !isValidRead(gate.test.argument) ||
    gate.alternate ||
    !isErrorReturn(gate.consequent, SHOPIFY_INVALID_STATUS_CODE)
  )
    return null;
  const catchStatements: ReadonlyArray<EsTreeNode> = catchClause.body.body;
  for (const statement of catchStatements) {
    if (isErrorReturn(statement, SHOPIFY_ERROR_STATUS_CODE)) continue;
    if (
      isNodeOfType(statement, "IfStatement") &&
      !statement.alternate &&
      isNodeOfType(statement.test, "UnaryExpression") &&
      statement.test.operator === "!" &&
      isNodeOfType(statement.test.argument, "MemberExpression") &&
      isMember(statement.test.argument, "headersSent") &&
      isSymbolRead(statement.test.argument.object, response, scopes) &&
      isErrorReturn(statement.consequent, SHOPIFY_ERROR_STATUS_CODE)
    )
      continue;
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "CallExpression") &&
      !statement.expression.optional &&
      isNodeOfType(statement.expression.callee, "MemberExpression") &&
      !statement.expression.callee.computed &&
      !statement.expression.callee.optional &&
      isNodeOfType(statement.expression.callee.object, "Identifier") &&
      statement.expression.callee.object.name === "console" &&
      scopes.isGlobalReference(statement.expression.callee.object) &&
      isNodeOfType(statement.expression.callee.property, "Identifier") &&
      ["error", "log"].includes(statement.expression.callee.property.name) &&
      statement.expression.arguments.every(isPassiveErrorData)
    )
      continue;
    return null;
  }
  if (
    !request.references.every((reference) => {
      const identifier = reference.identifier;
      if (reference.flag !== "read" || findEnclosingFunction(identifier) !== handler) return false;
      if (identifier === rawRequest || identifier === rawBody.object) return true;
      const parent = identifier.parent;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== identifier ||
        parent.optional ||
        isWithinAssignmentTarget(parent)
      )
        return false;
      if (isMember(parent, "headers")) return headerReads.has(parent);
      return (
        isMember(parent, "body") &&
        isAstDescendant(parent, tryStatement.block) &&
        parent.range[0] > gate.range[1] &&
        !isNodeOfType(parent.parent, "MemberExpression") &&
        !isNodeOfType(parent.parent, "VariableDeclarator")
      );
    })
  )
    return null;
  if (
    !response.references.every((reference) => {
      if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== handler)
        return false;
      if (reference.identifier === rawResponse) return true;
      const parent = reference.identifier.parent;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== reference.identifier ||
        isWithinAssignmentTarget(parent)
      )
        return false;
      if (isMember(parent, "headersSent")) return isAstDescendant(parent, catchClause);
      return (
        isMember(parent, "status") &&
        isNodeOfType(parent.parent, "CallExpression") &&
        parent.parent.callee === parent &&
        !parent.parent.optional
      );
    })
  )
    return null;
  if (
    !result.references.every((reference) => {
      const parent = reference.identifier.parent;
      if (
        reference.flag !== "read" ||
        findEnclosingFunction(reference.identifier) !== handler ||
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== reference.identifier ||
        parent.computed ||
        parent.optional ||
        isWithinAssignmentTarget(parent)
      )
        return false;
      if (isValidRead(parent)) return isAstDescendant(parent, gate.test);
      return (
        isMember(parent, "topic") &&
        isAstDescendant(parent, tryStatement.block) &&
        parent.range[0] > gate.range[1] &&
        !isNodeOfType(parent.parent, "MemberExpression")
      );
    })
  )
    return null;
  const handlerDeclaration = handlerSymbol.declarationNode.parent;
  const clientDeclaration = client.declarationNode.parent;
  if (
    !program.body.every(
      (statement) =>
        isNodeOfType(statement, "ImportDeclaration") ||
        statement === selectedExport ||
        statement === handlerDeclaration ||
        (client.kind !== "import" && statement === clientDeclaration),
    )
  )
    return null;
  return { client, clientRead };
};
