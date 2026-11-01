import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { hasClosedReactStateProvider } from "../../../utils/has-closed-react-state-provider.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { LOCAL_FORMATTER_ARGUMENT_COUNT, STRING_STATE_TUPLE_LENGTH } from "./constants.js";
import { hasClosedStateTupleProvider } from "./has-closed-state-tuple-provider.js";
import { isConstructivelyStringExpression } from "./is-constructively-string-expression.js";
import { isLocalStringFormatterCallResult } from "./is-local-string-formatter-call-result.js";

export const isClosedStringStateBinding = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const declarator = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== STRING_STATE_TUPLE_LENGTH ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    declarator.init.arguments.length !== LOCAL_FORMATTER_ARGUMENT_COUNT
  )
    return false;
  const [stateIdentifier, setterIdentifier] = declarator.id.elements;
  const [initialValue] = declarator.init.arguments;
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    stateIdentifier !== symbol.bindingIdentifier ||
    !isNodeOfType(initialValue, "Literal") ||
    typeof initialValue.value !== "string" ||
    !hasClosedReactStateProvider(declarator.init, scopes) ||
    !hasClosedStateTupleProvider(scopes)
  )
    return false;
  const pair = resolveReactUseStatePair(setterIdentifier, scopes);
  if (
    !pair ||
    pair.declarator !== declarator ||
    pair.stateSymbol !== symbol ||
    pair.setterSymbol.bindingIdentifier !== setterIdentifier ||
    !symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
    )
  )
    return false;
  return pair.setterSymbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const target = findTransparentExpressionRoot(reference.identifier);
    const call = target.parent;
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(reference.identifier) ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== target ||
      call.optional ||
      call.arguments.length !== LOCAL_FORMATTER_ARGUMENT_COUNT
    )
      return false;
    const [value] = call.arguments;
    return (
      Boolean(value) &&
      (isConstructivelyStringExpression(value) || isLocalStringFormatterCallResult(value, scopes))
    );
  });
};
