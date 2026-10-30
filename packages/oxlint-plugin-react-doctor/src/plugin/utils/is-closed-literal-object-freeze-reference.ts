import {
  CLOSED_LITERAL_FREEZE_ARGUMENT_COUNT,
  CLOSED_LITERAL_FREEZE_RESERVED_KEYS,
} from "../constants/js.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getObjectIntegrityMethodName } from "./unwrap-object-integrity-expression.js";

const isClosedFrozenLiteralValue = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(expression, "Literal")) {
    if ("regex" in expression || "bigint" in expression) return false;
    return (
      expression.value === null ||
      typeof expression.value === "string" ||
      typeof expression.value === "number" ||
      typeof expression.value === "boolean"
    );
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  if (
    expression.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier") ||
    getObjectIntegrityMethodName(expression, scopes) !== "freeze" ||
    expression.arguments.length !== CLOSED_LITERAL_FREEZE_ARGUMENT_COUNT
  ) {
    return false;
  }
  const argument = expression.arguments[0];
  if (isNodeOfType(argument, "ArrayExpression")) {
    return argument.elements.every(
      (element) => element !== null && isClosedFrozenLiteralValue(element, scopes),
    );
  }
  if (!isNodeOfType(argument, "ObjectExpression")) return false;
  return argument.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.shorthand ||
      property.computed
    ) {
      return false;
    }
    const propertyName = getStaticPropertyKeyName(property);
    return (
      propertyName !== null &&
      !CLOSED_LITERAL_FREEZE_RESERVED_KEYS.has(propertyName) &&
      isClosedFrozenLiteralValue(property.value, scopes)
    );
  });
};

export const isClosedLiteralObjectFreezeReference = (
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(reference, "Identifier") ||
    reference.name !== "Object" ||
    !scopes.isGlobalReference(reference)
  ) {
    return false;
  }
  const member = reference.parent;
  const call = member?.parent;
  return Boolean(
    isNodeOfType(member, "MemberExpression") &&
    member.object === reference &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === member &&
    isClosedFrozenLiteralValue(call, scopes),
  );
};
