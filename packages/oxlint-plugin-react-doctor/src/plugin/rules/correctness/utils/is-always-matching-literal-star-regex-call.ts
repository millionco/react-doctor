import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NON_STATEFUL_REGEX_FLAGS,
  SINGLE_LITERAL_STAR_PATTERN,
  SINGLE_REGEX_ARGUMENT_COUNT,
  SINGLE_SELECTED_TYPE_PROPERTY_COUNT,
} from "./constants.js";
import { hasClosedLiteralStarRegexProviders } from "./has-closed-literal-star-regex-providers.js";

export const isAlwaysMatchingLiteralStarRegexCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (
    call.optional ||
    call.arguments.length !== SINGLE_REGEX_ARGUMENT_COUNT ||
    isNodeOfType(call.arguments[0], "SpreadElement") ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.property, "Identifier")
  )
    return false;
  const methodName = call.callee.property.name;
  if (methodName !== "exec" && methodName !== "match") return false;
  const regexOperand = stripParenExpression(
    methodName === "exec" ? call.callee.object : call.arguments[0],
  );
  if (
    !isNodeOfType(regexOperand, "Literal") ||
    !("regex" in regexOperand) ||
    !regexOperand.regex ||
    !SINGLE_LITERAL_STAR_PATTERN.test(regexOperand.regex.pattern) ||
    !NON_STATEFUL_REGEX_FLAGS.test(regexOperand.regex.flags)
  )
    return false;
  if (!hasClosedLiteralStarRegexProviders(call, context.scopes)) return false;
  if (methodName === "exec") return true;
  const receiver = stripParenExpression(call.callee.object);
  if (isNodeOfType(receiver, "Literal")) return typeof receiver.value === "string";
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (
    !receiverSymbol ||
    receiverSymbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  const parameter = receiverSymbol.declarationNode;
  if (isNodeOfType(parameter, "ArrayPattern") && parameter.typeAnnotation) return false;
  if (isNodeOfType(parameter, "ObjectPattern") && parameter.typeAnnotation) {
    const annotation = parameter.typeAnnotation.typeAnnotation;
    if (!isNodeOfType(annotation, "TSTypeReference")) {
      const bindingProperty = receiverSymbol.bindingIdentifier.parent;
      const propertyName = getDestructuredBindingPropertyName(receiverSymbol.bindingIdentifier);
      if (
        !isNodeOfType(annotation, "TSTypeLiteral") ||
        !isNodeOfType(bindingProperty, "Property") ||
        bindingProperty.parent !== parameter ||
        bindingProperty.computed ||
        propertyName === null
      )
        return false;
      const properties = annotation.members.filter(
        (member) =>
          isNodeOfType(member, "TSPropertySignature") &&
          !member.computed &&
          ((isNodeOfType(member.key, "Identifier") && member.key.name === propertyName) ||
            (isNodeOfType(member.key, "Literal") && member.key.value === propertyName)),
      );
      const selectedProperty = properties[0];
      if (
        properties.length !== SINGLE_SELECTED_TYPE_PROPERTY_COUNT ||
        !isNodeOfType(selectedProperty, "TSPropertySignature") ||
        !isNodeOfType(selectedProperty.typeAnnotation?.typeAnnotation, "TSStringKeyword")
      )
        return false;
    }
  }
  const initializer = getDirectConstInitializer(receiverSymbol);
  if (initializer) {
    const value = stripParenExpression(initializer);
    return isNodeOfType(value, "Literal") && typeof value.value === "string";
  }
  if (receiverSymbol.kind !== "parameter") return false;
  if (
    isNodeOfType(receiverSymbol.bindingIdentifier, "Identifier") &&
    receiverSymbol.bindingIdentifier.typeAnnotation &&
    !isNodeOfType(receiverSymbol.bindingIdentifier.typeAnnotation.typeAnnotation, "TSStringKeyword")
  )
    return false;
  let bindingNode: EsTreeNode | null | undefined = receiverSymbol.bindingIdentifier;
  while (bindingNode) {
    if (
      isNodeOfType(bindingNode, "AssignmentPattern") ||
      isNodeOfType(bindingNode, "RestElement") ||
      isNodeOfType(bindingNode, "TSParameterProperty")
    )
      return false;
    if (bindingNode === receiverSymbol.declarationNode) break;
    bindingNode = bindingNode.parent;
  }
  if (!bindingNode) return false;
  const owner = findEnclosingFunction(receiverSymbol.bindingIdentifier);
  if (!owner) return false;
  let hasLexicalEvalReference = false;
  walkAst(owner, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      context.scopes.isGlobalReference(node)
    )
      hasLexicalEvalReference = true;
  });
  return !hasLexicalEvalReference;
};
