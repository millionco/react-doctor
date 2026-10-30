import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNativePrototypeExposure } from "../../../utils/is-native-prototype-exposure.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES, REGEX_RESULT_PROVIDER_NAMES } from "./constants.js";

export const hasClosedLiteralStarRegexProviders = (
  source: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = findProgramRoot(source);
  if (!program) return false;
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "TSParameterProperty")) {
      if (node.decorators.length > 0 || !isNodeOfType(node.parameter, "Identifier"))
        isClosed = false;
      return false;
    }
    if (
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNativePrototypeExposure(node)) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES.has(node.name)) {
      const symbol = scopes.symbolFor(node);
      if (
        symbol &&
        symbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "Literal") && "regex" in node) {
      const reference = findTransparentExpressionRoot(node);
      const consumer = reference.parent;
      const invocation = consumer && findTransparentExpressionRoot(consumer).parent;
      const isDirectRegexMethodCall =
        isNodeOfType(consumer, "MemberExpression") &&
        consumer.object === reference &&
        !consumer.optional &&
        (getStaticPropertyName(consumer) === "exec" ||
          getStaticPropertyName(consumer) === "test") &&
        isNodeOfType(invocation, "CallExpression") &&
        !invocation.optional &&
        invocation.callee === findTransparentExpressionRoot(consumer);
      const methodReceiver =
        isNodeOfType(consumer, "CallExpression") &&
        isNodeOfType(consumer.callee, "MemberExpression")
          ? stripParenExpression(consumer.callee.object)
          : null;
      const receiverSymbol = isNodeOfType(methodReceiver, "Identifier")
        ? scopes.symbolFor(methodReceiver)
        : null;
      const receiverValue = receiverSymbol
        ? getDirectConstInitializer(receiverSymbol)
        : methodReceiver;
      const isKnownStringReceiver =
        (isNodeOfType(receiverValue, "Literal") && typeof receiverValue.value === "string") ||
        (receiverSymbol?.kind === "parameter" &&
          getSymbolTypeAnnotation(receiverSymbol)?.type === "TSStringKeyword");
      const isReadonlyReceiver =
        !receiverSymbol ||
        receiverSymbol.references.every(
          (reference) =>
            reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
        );
      const isStringMethodArgument =
        isNodeOfType(consumer, "CallExpression") &&
        !consumer.optional &&
        consumer.arguments[0] === reference &&
        isNodeOfType(consumer.callee, "MemberExpression") &&
        !consumer.callee.optional &&
        (consumer === source || (isKnownStringReceiver && isReadonlyReceiver)) &&
        ["match", "replace", "replaceAll", "search", "split"].includes(
          getStaticPropertyName(consumer.callee) ?? "",
        );
      if (!isDirectRegexMethodCall && !isStringMethodArgument) {
        isClosed = false;
        return false;
      }
    }
    if (isNodeOfType(node, "Identifier") && isProvenGlobalObjectReference(node, scopes)) {
      const reference = findTransparentExpressionRoot(node);
      const consumer = reference.parent;
      if (
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "typeof" &&
        consumer.argument === reference
      )
        return;
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== reference ||
        consumer.optional ||
        isWithinAssignmentTarget(node) ||
        getStaticPropertyName(consumer) === null ||
        REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES.has(getStaticPropertyName(consumer) ?? "")
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "MemberExpression")) return;
    if (
      !REGEX_RESULT_PROVIDER_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    )
      return;
    const reference = findTransparentExpressionRoot(node);
    const consumer = reference.parent;
    if (
      !isNodeOfType(node, "Identifier") ||
      !scopes.isGlobalReference(node) ||
      isWithinAssignmentTarget(node) ||
      (!isNodeOfType(consumer, "CallExpression") && !isNodeOfType(consumer, "NewExpression")) ||
      consumer.callee !== reference ||
      (isNodeOfType(consumer, "CallExpression") && consumer.optional)
    )
      isClosed = false;
  });
  return isClosed;
};
