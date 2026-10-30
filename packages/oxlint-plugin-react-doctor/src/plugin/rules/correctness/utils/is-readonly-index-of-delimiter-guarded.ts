import {
  FIRST_DELIMITED_PART_INDEX,
  MISSING_DELIMITER_POSITION,
  NO_ARGUMENTS_COUNT,
  SINGLE_DELIMITER_ARGUMENT_COUNT,
} from "./constants.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNativePrototypeExposure } from "../../../utils/is-native-prototype-exposure.js";
import { isPresenceProvenBeforeNode } from "../../../utils/is-presence-proven-before-node.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isReadonlyIndexOfDelimiterGuarded = (
  node: EsTreeNode,
  splitCall: EsTreeNode,
  partIndex: number,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    partIndex !== FIRST_DELIMITED_PART_INDEX ||
    !isNodeOfType(splitCall, "CallExpression") ||
    splitCall.optional ||
    splitCall.arguments.length !== SINGLE_DELIMITER_ARGUMENT_COUNT ||
    !isNodeOfType(splitCall.callee, "MemberExpression") ||
    splitCall.callee.optional ||
    getStaticPropertyName(splitCall.callee) !== "split" ||
    !isNodeOfType(splitCall.callee.object, "Identifier")
  ) {
    return false;
  }
  const delimiter = splitCall.arguments[0];
  if (
    !isNodeOfType(delimiter, "Literal") ||
    typeof delimiter.value !== "string" ||
    !delimiter.value
  ) {
    return false;
  }
  const owner = findEnclosingFunction(node);
  const receiverSymbol = scopes.symbolFor(splitCall.callee.object);
  if (!owner || !receiverSymbol) return false;
  const isReadonlyOwnBinding = (symbol: SymbolDescriptor): boolean =>
    findEnclosingFunction(symbol.bindingIdentifier) === owner &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        findEnclosingFunction(reference.identifier) === owner,
    );
  const receiverInitializer = getDirectConstInitializer(receiverSymbol);
  if (!receiverInitializer || !isReadonlyOwnBinding(receiverSymbol)) return false;
  let parameter = receiverInitializer;
  let requiredAnnotation = "TSStringKeyword";
  if (isNodeOfType(receiverInitializer, "CallExpression")) {
    if (
      receiverInitializer.optional ||
      receiverInitializer.arguments.length !== NO_ARGUMENTS_COUNT ||
      !isNodeOfType(receiverInitializer.callee, "MemberExpression") ||
      receiverInitializer.callee.optional ||
      getStaticPropertyName(receiverInitializer.callee) !== "toString"
    ) {
      return false;
    }
    parameter = receiverInitializer.callee.object;
    requiredAnnotation = "TSNumberKeyword";
  }
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (
    !parameterSymbol ||
    parameterSymbol.kind !== "parameter" ||
    parameterSymbol.bindingIdentifier.parent !== owner ||
    getSymbolTypeAnnotation(parameterSymbol)?.type !== requiredAnnotation ||
    !isReadonlyOwnBinding(parameterSymbol)
  ) {
    return false;
  }
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (hasUnsupportedRuntime) return false;
    if (
      candidate.type === "WithStatement" ||
      candidate.type === "TSImportEqualsDeclaration" ||
      candidate.type === "TSExportAssignment" ||
      candidate.type === "TSParameterProperty" ||
      ((isNodeOfType(candidate, "TSEnumDeclaration") ||
        isNodeOfType(candidate, "TSModuleDeclaration")) &&
        !("declare" in candidate && candidate.declare))
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(candidate)) return false;
    if (isNativePrototypeExposure(candidate)) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isNodeOfType(candidate, "Identifier")) {
      const symbol = scopes.symbolFor(candidate);
      if (
        symbol &&
        symbol.bindingIdentifier !== candidate &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol) &&
        (candidate.name === "String" ||
          candidate.name === "Number" ||
          candidate.name === "globalThis" ||
          candidate.name === "window" ||
          candidate.name === "self" ||
          candidate.name === "global")
      ) {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (
      isNodeOfType(candidate, "Identifier") &&
      candidate.name === "eval" &&
      scopes.isGlobalReference(candidate)
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isNodeOfType(candidate, "Identifier") && isProvenGlobalObjectReference(candidate, scopes)) {
      const reference = findTransparentExpressionRoot(candidate);
      const consumer = reference.parent;
      if (
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "typeof" &&
        consumer.argument === reference
      )
        return;
      const propertyName = isNodeOfType(consumer, "MemberExpression")
        ? getStaticPropertyName(consumer)
        : null;
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== reference ||
        consumer.optional ||
        isWithinAssignmentTarget(candidate) ||
        propertyName === null ||
        propertyName === "String" ||
        propertyName === "Number" ||
        propertyName === "constructor" ||
        propertyName === "global" ||
        propertyName === "globalThis" ||
        propertyName === "self" ||
        propertyName === "window"
      ) {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "MemberExpression"))
      return;
    if (
      !isProvenGlobalNamespaceReference(candidate, "String", scopes) &&
      !isProvenGlobalNamespaceReference(candidate, "Number", scopes)
    )
      return;
    const reference = findTransparentExpressionRoot(candidate);
    const consumer = reference.parent;
    const methodName = isNodeOfType(consumer, "MemberExpression")
      ? getStaticPropertyName(consumer)
      : null;
    const invocation = consumer?.parent;
    const isDirectConversion =
      isNodeOfType(consumer, "CallExpression") &&
      !consumer.optional &&
      consumer.callee === reference;
    const isStaticMethodCall =
      isNodeOfType(consumer, "MemberExpression") &&
      consumer.object === reference &&
      !consumer.optional &&
      methodName !== null &&
      methodName !== "prototype" &&
      methodName !== "constructor" &&
      methodName !== "__proto__" &&
      isNodeOfType(invocation, "CallExpression") &&
      !invocation.optional &&
      invocation.callee === consumer;
    if (
      !isNodeOfType(candidate, "Identifier") ||
      !scopes.isGlobalReference(candidate) ||
      isWithinAssignmentTarget(candidate) ||
      (!isDirectConversion && !isStaticMethodCall)
    ) {
      hasUnsupportedRuntime = true;
    }
  });
  if (hasUnsupportedRuntime) return false;
  const testProvesDelimiter = (test: EsTreeNode): boolean => {
    if (isNodeOfType(test, "LogicalExpression")) {
      if (test.operator === "&&")
        return testProvesDelimiter(test.left) || testProvesDelimiter(test.right);
      if (test.operator === "||")
        return testProvesDelimiter(test.left) && testProvesDelimiter(test.right);
      return false;
    }
    if (!isNodeOfType(test, "BinaryExpression")) return false;
    let position = test.left;
    let missingPosition: EsTreeNode = test.right;
    let isReversed = false;
    if (!isNodeOfType(position, "Identifier")) {
      position = test.right;
      missingPosition = test.left;
      isReversed = true;
    }
    if (
      !isNodeOfType(position, "Identifier") ||
      !isNodeOfType(missingPosition, "UnaryExpression") ||
      missingPosition.operator !== "-" ||
      !isNodeOfType(missingPosition.argument, "Literal") ||
      typeof missingPosition.argument.value !== "number" ||
      -missingPosition.argument.value !== MISSING_DELIMITER_POSITION ||
      !(
        test.operator === "!==" ||
        test.operator === "!=" ||
        (!isReversed && test.operator === ">") ||
        (isReversed && test.operator === "<")
      )
    ) {
      return false;
    }
    const positionSymbol = scopes.symbolFor(position);
    if (!positionSymbol || !isReadonlyOwnBinding(positionSymbol)) return false;
    const positionInitializer = getDirectConstInitializer(positionSymbol);
    return Boolean(
      isNodeOfType(positionInitializer, "CallExpression") &&
      !positionInitializer.optional &&
      positionInitializer.arguments.length === SINGLE_DELIMITER_ARGUMENT_COUNT &&
      isNodeOfType(positionInitializer.callee, "MemberExpression") &&
      !positionInitializer.callee.optional &&
      getStaticPropertyName(positionInitializer.callee) === "indexOf" &&
      isNodeOfType(positionInitializer.callee.object, "Identifier") &&
      scopes.symbolFor(positionInitializer.callee.object) === receiverSymbol &&
      isNodeOfType(positionInitializer.arguments[0], "Literal") &&
      positionInitializer.arguments[0].value === delimiter.value,
    );
  };
  return isPresenceProvenBeforeNode(node, testProvesDelimiter);
};
