import type { Reference, Scope } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../../utils/find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { isNoOpExpression } from "../../../../utils/is-no-op-expression.js";
import { stripParenExpression } from "../../../../utils/strip-paren-expression.js";
import { getRef } from "./ast.js";
import type { ProgramAnalysis } from "./get-program-analysis.js";

const getOrdinaryFunction = (node: EsTreeNode) => {
  const value = stripParenExpression(node);
  return isFunctionLike(value) &&
    !isNodeOfType(value, "FunctionDeclaration") &&
    !value.async &&
    !("generator" in value && value.generator) &&
    value.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
    ? value
    : null;
};

// A factory can take a prop without returning it in the destructured slot.
export const hasFreshLocalDestructuredCallback = (
  analysis: ProgramAnalysis,
  reference: Reference,
): boolean => {
  const invocation = findTransparentExpressionRoot(reference.identifier as unknown as EsTreeNode);
  if (
    !isNodeOfType(invocation.parent, "CallExpression") ||
    invocation.parent.callee !== invocation ||
    invocation.parent.arguments.length > 0
  ) {
    return false;
  }

  const binding = reference.resolved;
  if (reference.tainted || binding?.defs.length !== 1) return false;
  const [definition] = binding.defs;
  const declarator = definition.node as unknown as EsTreeNode;
  const identifier = definition.name as unknown as EsTreeNode;
  const selected = identifier.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !declarator.init ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    !isNodeOfType(selected, "Property") ||
    selected.parent !== declarator.id ||
    selected.value !== identifier
  ) {
    return false;
  }

  const call = stripParenExpression(declarator.init);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const factoryReference = getRef(analysis, callee);
  const factoryBinding = factoryReference?.resolved;
  if (factoryReference?.tainted || factoryBinding?.defs.length !== 1) return false;
  const factoryDeclaration = factoryBinding.defs[0].node as unknown as EsTreeNode;
  if (
    !isNodeOfType(factoryDeclaration, "VariableDeclarator") ||
    !isNodeOfType(factoryDeclaration.id, "Identifier") ||
    !factoryDeclaration.init ||
    !isNodeOfType(factoryDeclaration.parent, "VariableDeclaration") ||
    factoryDeclaration.parent.kind !== "const"
  ) {
    return false;
  }
  const factory = getOrdinaryFunction(factoryDeclaration.init);
  if (!factory) return false;
  const returned = getSingleReturnExpression(factory);
  const record = returned && stripParenExpression(returned);
  if (!isNodeOfType(record, "ObjectExpression")) return false;

  const selectedKey = getStaticPropertyKeyName(selected);
  const noOpOptions = {
    isNoOpIdentifier: (node: EsTreeNode): boolean => {
      if (!isNodeOfType(node, "Identifier") || node.name !== "undefined") return false;
      const identifierReference = getRef(analysis, node);
      if (!identifierReference || identifierReference.resolved || identifierReference.tainted)
        return false;
      for (let scope: Scope | null = identifierReference.from; scope; scope = scope.upper) {
        if (scope.type === "with") return false;
      }
      return true;
    },
  };
  const isInertArgumentValue = (node: EsTreeNode): boolean => {
    const value = stripParenExpression(node);
    if (!isNodeOfType(value, "Identifier")) return isNoOpExpression(value, noOpOptions);
    if (isNoOpExpression(value, noOpOptions)) return true;
    const argumentReference = getRef(analysis, value);
    return (
      argumentReference?.tainted === false &&
      argumentReference.resolved?.defs.length === 1 &&
      argumentReference.resolved.defs[0].type === "Parameter"
    );
  };
  // The discarded call can be the only existing warning when computing an
  // argument invokes a prop. Preserve the fallback for executable inputs.
  if (
    !call.arguments.every((argument) => {
      const value = stripParenExpression(argument);
      if (!isNodeOfType(value, "ObjectExpression")) return isInertArgumentValue(value);
      return value.properties.every(
        (property) =>
          isNodeOfType(property, "Property") &&
          property.kind === "init" &&
          !property.method &&
          !property.computed &&
          getStaticPropertyKeyName(property) !== "__proto__" &&
          isInertArgumentValue(property.value),
      );
    })
  ) {
    return false;
  }

  const ownFields = new Map<string, EsTreeNode>();
  for (const field of record.properties) {
    if (!isNodeOfType(field, "Property") || field.kind !== "init" || field.method) return false;
    const key = getStaticPropertyKeyName(field);
    if (key === null || key === "__proto__" || ownFields.has(key)) return false;
    const value = stripParenExpression(field.value);
    // A sibling may carry a borrowed callback, but constructing the object
    // and destructuring its own fields must not invoke one.
    if (
      key !== selectedKey &&
      !isFunctionLike(value) &&
      !isNoOpExpression(value, noOpOptions) &&
      !(
        isNodeOfType(value, "Identifier") &&
        getRef(analysis, value)?.resolved?.defs.some(
          (definition) => definition.type === "Parameter" && definition.node === factory,
        )
      )
    ) {
      return false;
    }
    ownFields.set(key, value);
  }
  for (const field of declarator.id.properties) {
    if (!isNodeOfType(field, "Property") || !isNodeOfType(field.value, "Identifier")) return false;
    const key = getStaticPropertyKeyName(field);
    if (key === null || !ownFields.has(key)) return false;
  }

  const selectedField = selectedKey === null ? undefined : ownFields.get(selectedKey);
  const callback = selectedField && getOrdinaryFunction(selectedField);
  if (!callback) return false;
  if (isNodeOfType(callback.body, "BlockStatement") && callback.body.body.length === 0) return true;
  const value = getSingleReturnExpression(callback);
  return value !== null && isNoOpExpression(value, noOpOptions);
};
