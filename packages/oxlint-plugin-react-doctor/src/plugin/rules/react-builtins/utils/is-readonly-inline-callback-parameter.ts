import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isReadonlyInlineCallbackParameter = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "parameter" || symbol.initializer !== null) return false;
  const owner = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !owner ||
    (owner.type !== "ArrowFunctionExpression" && owner.type !== "FunctionExpression") ||
    symbol.scope.node !== owner ||
    !owner.params.some((parameter) => parameter === symbol.declarationNode)
  ) {
    return false;
  }
  const call = owner.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.parent?.type === "ChainExpression" ||
    !call.arguments.some((argument) => argument === owner)
  ) {
    return false;
  }
  const parameter = symbol.declarationNode;
  const binding = symbol.bindingIdentifier;
  let hasDirectBinding = parameter === binding && isNodeOfType(parameter, "Identifier");
  if (isNodeOfType(parameter, "ArrayPattern")) {
    hasDirectBinding =
      parameter.elements.every((element) => !element || element.type === "Identifier") &&
      parameter.elements.some((element) => element === binding);
  } else if (isNodeOfType(parameter, "ObjectPattern")) {
    hasDirectBinding =
      parameter.properties.every(
        (property) =>
          property.type === "Property" &&
          !property.computed &&
          !property.method &&
          property.kind === "init" &&
          property.value.type === "Identifier",
      ) &&
      parameter.properties.some(
        (property) => property.type === "Property" && property.value === binding,
      );
  }
  if (
    !hasDirectBinding ||
    !symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  if (owner.type === "FunctionExpression") {
    let hasArgumentsReference = false;
    walkAst(owner, (node) => {
      if (hasArgumentsReference) return false;
      if (isNodeOfType(node, "Identifier") && node.name === "arguments") {
        hasArgumentsReference = true;
        return false;
      }
    });
    if (hasArgumentsReference) return false;
  }
  return true;
};
