import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

const getLocalObjectExpression = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression")) return candidate;
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const initializer = context.scopes.symbolFor(candidate)?.initializer;
  if (!initializer) return null;
  const initializerExpression = stripParenExpression(initializer);
  return isNodeOfType(initializerExpression, "ObjectExpression") ? initializerExpression : null;
};

const hasUnstableLocalMemberSource = (expression: EsTreeNode, context: RuleContext): boolean => {
  let candidate = stripParenExpression(expression);
  const propertyNames: string[] = [];
  while (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    if (!propertyName) return false;
    propertyNames.unshift(propertyName);
    candidate = stripParenExpression(candidate.object);
  }
  let objectExpression = getLocalObjectExpression(candidate, context);
  if (!objectExpression) return false;
  const finalPropertyName = propertyNames.pop();
  if (!finalPropertyName) return false;
  for (const propertyName of propertyNames) {
    const propertyValue = getStaticObjectPropertyValue(objectExpression, propertyName);
    if (propertyValue === null || propertyValue === undefined) return true;
    objectExpression = getLocalObjectExpression(propertyValue, context);
    if (!objectExpression) return false;
  }
  const propertyValue = getStaticObjectPropertyValue(objectExpression, finalPropertyName);
  return propertyValue === null || propertyValue === undefined;
};

const isExpressionKeyAffectedByWrite = (
  expressionKey: string,
  writeTarget: EsTreeNode,
  context: RuleContext,
): boolean => {
  const writeKey = resolveExpressionKey(writeTarget, context);
  return Boolean(
    writeKey && (writeKey === expressionKey || expressionKey.startsWith(`${writeKey}.`)),
  );
};

const isExpressionWrittenWithinFunction = (
  expressionKey: string,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  let isWritten = false;
  walkFunctionExecution(functionNode, context.scopes, (descendant) => {
    if (isWritten) return;
    if (
      isNodeOfType(descendant, "AssignmentExpression") &&
      isExpressionKeyAffectedByWrite(expressionKey, descendant.left, context)
    ) {
      isWritten = true;
      return;
    }
    if (
      (isNodeOfType(descendant, "UpdateExpression") ||
        (isNodeOfType(descendant, "UnaryExpression") && descendant.operator === "delete")) &&
      isExpressionKeyAffectedByWrite(expressionKey, descendant.argument, context)
    ) {
      isWritten = true;
    }
  });
  return isWritten;
};

export const isReferenceStableAcrossFunctionExecutions = (
  expression: EsTreeNode,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  const expressionKey = resolveExpressionKey(candidate, context);
  if (
    (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "MemberExpression")) ||
    !expressionKey ||
    (isNodeOfType(candidate, "MemberExpression") &&
      hasUnstableLocalMemberSource(candidate, context)) ||
    isExpressionWrittenWithinFunction(expressionKey, functionNode, context)
  ) {
    return false;
  }
  let referencesFunctionBinding = false;
  walkAst(candidate, (descendant) => {
    if (!isNodeOfType(descendant, "Identifier")) return;
    const reference = context.scopes.referenceFor(descendant);
    if (
      reference?.resolvedSymbol &&
      (isAstDescendant(reference.resolvedSymbol.bindingIdentifier, functionNode) ||
        reference.resolvedSymbol.references.some(
          (symbolReference) =>
            (symbolReference.flag !== "read" ||
              isWithinAssignmentTarget(symbolReference.identifier)) &&
            isAstDescendant(symbolReference.identifier, functionNode),
        ))
    ) {
      referencesFunctionBinding = true;
      return false;
    }
  });
  return !referencesFunctionBinding;
};
