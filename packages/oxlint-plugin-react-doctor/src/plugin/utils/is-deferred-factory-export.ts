import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

const sameIdentifier = (
  reference: EsTreeNode | null | undefined,
  declaration: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(reference, "Identifier") &&
  scopes.symbolFor(declaration) !== null &&
  scopes.symbolFor(reference) === scopes.symbolFor(declaration);

const readGlobalCall = (
  expression: EsTreeNode | null | undefined,
  name: string,
  argumentCount: number,
  scopes: ScopeAnalysis,
) =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === name &&
  scopes.isGlobalReference(expression.callee) &&
  expression.arguments.length === argumentCount
    ? expression
    : null;

export const isDeferredFactoryExport = (
  filename: string,
  sourceText: string,
  exportedName: string,
): boolean => {
  const program = parseSourceText({ filename, sourceText });
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
  const [statement] = program.body;
  if (
    !isNodeOfType(statement, "ExportNamedDeclaration") ||
    statement.exportKind === "type" ||
    statement.source ||
    statement.specifiers.length !== 0
  )
    return false;

  const declaration = statement.declaration;
  if (
    !isNodeOfType(declaration, "FunctionDeclaration") ||
    declaration.id?.name !== exportedName ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 2 ||
    !isNodeOfType(declaration.body, "BlockStatement") ||
    declaration.body.body.length !== 2
  )
    return false;

  const [callback, delay] = declaration.params;
  const [local, returned] = declaration.body.body;
  if (
    !isNodeOfType(callback, "Identifier") ||
    !isNodeOfType(delay, "AssignmentPattern") ||
    !isNodeOfType(delay.left, "Identifier") ||
    !isNodeOfType(delay.right, "Literal") ||
    typeof delay.right.value !== "number" ||
    !Number.isFinite(delay.right.value) ||
    delay.right.value <= 0 ||
    !isNodeOfType(local, "VariableDeclaration") ||
    local.kind !== "let" ||
    local.declarations.length !== 1 ||
    local.declarations[0].init ||
    !isNodeOfType(local.declarations[0].id, "Identifier") ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ArrowFunctionExpression") ||
    returned.argument.async ||
    returned.argument.params.length !== 1 ||
    !isNodeOfType(returned.argument.params[0], "RestElement") ||
    !isNodeOfType(returned.argument.params[0].argument, "Identifier") ||
    !isNodeOfType(returned.argument.body, "BlockStatement") ||
    returned.argument.body.body.length !== 2
  )
    return false;

  const timerBinding = local.declarations[0].id;
  const args = returned.argument.params[0].argument;
  const [cancel, queue] = returned.argument.body.body;
  const scopes = analyzeScopes(program);
  if (
    !isNodeOfType(cancel, "ExpressionStatement") ||
    !isNodeOfType(queue, "ExpressionStatement") ||
    !isNodeOfType(queue.expression, "AssignmentExpression") ||
    queue.expression.operator !== "=" ||
    !sameIdentifier(queue.expression.left, timerBinding, scopes)
  )
    return false;

  const cancelCall = readGlobalCall(cancel.expression, "clearTimeout", 1, scopes);
  const queueCall = readGlobalCall(queue.expression.right, "setTimeout", 2, scopes);
  if (
    !cancelCall ||
    !sameIdentifier(cancelCall.arguments[0], timerBinding, scopes) ||
    !queueCall ||
    !sameIdentifier(queueCall.arguments[1], delay.left, scopes)
  )
    return false;

  const thunk = queueCall.arguments[0];
  if (!isNodeOfType(thunk, "ArrowFunctionExpression") || thunk.async || thunk.params.length !== 0) {
    return false;
  }
  const forward = isNodeOfType(thunk.body, "BlockStatement")
    ? thunk.body.body.length === 1 && isNodeOfType(thunk.body.body[0], "ExpressionStatement")
      ? thunk.body.body[0].expression
      : null
    : thunk.body;
  return (
    isNodeOfType(forward, "CallExpression") &&
    !forward.optional &&
    sameIdentifier(forward.callee, callback, scopes) &&
    forward.arguments.length === 1 &&
    isNodeOfType(forward.arguments[0], "SpreadElement") &&
    sameIdentifier(forward.arguments[0].argument, args, scopes)
  );
};
