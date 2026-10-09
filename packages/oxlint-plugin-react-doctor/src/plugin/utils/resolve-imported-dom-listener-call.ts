import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ImportedDomListenerCall {
  method: string;
  receiverKey: string;
  eventNode: EsTreeNode;
  handlerNode: EsTreeNode;
}

export const resolveImportedDomListenerCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ImportedDomListenerCall | null => {
  if (
    !context.filename ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return null;
  const imported = resolveImportedApiReference(call.callee, context.scopes);
  if (!imported?.importedName) return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    imported.source,
    imported.importedName,
  );
  const helper = resolved?.functionNode;
  if (!resolved || !helper || !isFunctionLike(helper) || helper.async || helper.generator)
    return null;
  const body = helper.body;
  const statement =
    isNodeOfType(body, "BlockStatement") && body.body.length === 1 ? body.body[0] : body;
  let expression: EsTreeNode | null = statement;
  if (isNodeOfType(statement, "ExpressionStatement")) expression = statement.expression;
  else if (isNodeOfType(statement, "ReturnStatement")) expression = statement.argument;
  if (!expression) return null;
  const operation = stripParenExpression(expression);
  if (
    !isNodeOfType(operation, "CallExpression") ||
    !isNodeOfType(operation.callee, "MemberExpression")
  )
    return null;
  const method = getStaticPropertyName(operation.callee);
  if (method !== "addEventListener" && method !== "removeEventListener") return null;
  const scopes = analyzeScopes(resolved.programNode);
  const receiverExpression = operation.callee.object;
  const receiver = ["document", "window"].find((name) =>
    isProvenGlobalNamespaceReference(receiverExpression, name, scopes),
  );
  if (!receiver) return null;
  const argumentsByParameter = operation.arguments.slice(0, 2).map((argument) => {
    if (!isNodeOfType(argument, "Identifier")) return null;
    const symbol = scopes.symbolFor(argument);
    const position = helper.params.findIndex(
      (parameter) =>
        isNodeOfType(parameter, "Identifier") && scopes.symbolFor(parameter) === symbol,
    );
    return position < 0 ? null : call.arguments[position];
  });
  const [eventNode, handlerNode] = argumentsByParameter;
  return eventNode && handlerNode
    ? { method, receiverKey: `global:${receiver}`, eventNode, handlerNode }
    : null;
};
