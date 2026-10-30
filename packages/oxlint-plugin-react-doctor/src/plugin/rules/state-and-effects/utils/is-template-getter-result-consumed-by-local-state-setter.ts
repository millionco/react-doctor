import {
  GETTER_RESULT_ARGUMENT_COUNT,
  GETTER_RESULT_ARGUMENT_INDEX,
} from "../../../constants/react.js";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../../utils/get-transparent-react-callback-wrapper-argument.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getParentCallbackPropNames } from "./resolve-parent-callback-provenance.js";

interface GetterProofContext {
  analysis: ProgramAnalysis;
  scopes: ScopeAnalysis;
  owner: EsTreeNode;
  visited: Set<number>;
}

const isReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const getReadonlyRoot = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const root = resolveConstIdentifierAlias(identifier, scopes);
  const equivalents = getEquivalentSymbols(identifier, scopes);
  return root &&
    equivalents.some((symbol) => symbol.id === root.id) &&
    equivalents.every(isReadonlySymbol)
    ? root
    : null;
};

const hasProducerDefault = (symbol: SymbolDescriptor): boolean => {
  let ancestor: EsTreeNode | null | undefined = symbol.bindingIdentifier;
  while (ancestor && ancestor !== symbol.declarationNode) {
    if (isNodeOfType(ancestor, "AssignmentPattern")) return true;
    ancestor = ancestor.parent;
  }
  return isNodeOfType(symbol.declarationNode, "AssignmentPattern");
};

const isDataRead = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) return !("regex" in value);
  if (isNodeOfType(value, "Identifier")) {
    const symbol = scopes.symbolFor(value);
    return Boolean(symbol && isReadonlySymbol(symbol));
  }
  return (
    isNodeOfType(value, "MemberExpression") &&
    !value.optional &&
    getStaticPropertyName(value) !== null &&
    isDataRead(value.object, scopes)
  );
};

const isGetterCondition = (expression: EsTreeNode, proof: GetterProofContext): boolean => {
  const condition = stripParenExpression(expression);
  if (isDataRead(condition, proof.scopes)) return true;
  if (isNodeOfType(condition, "LogicalExpression") && condition.operator === "&&") {
    return isGetterCondition(condition.left, proof) && isGetterCondition(condition.right, proof);
  }
  if (isNodeOfType(condition, "UnaryExpression")) {
    return (
      (condition.operator === "typeof" || condition.operator === "!") &&
      isGetterCondition(condition.argument, proof)
    );
  }
  return (
    isNodeOfType(condition, "BinaryExpression") &&
    (condition.operator === "===" || condition.operator === "!==" || condition.operator === "in") &&
    isGetterCondition(condition.left, proof) &&
    isGetterCondition(condition.right, proof)
  );
};

const isReturnedGetterValue = (
  expression: EsTreeNode,
  parameter: SymbolDescriptor,
  proof: GetterProofContext,
): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) return !("regex" in value);
  if (isNodeOfType(value, "Identifier")) return proof.scopes.symbolFor(value)?.id === parameter.id;
  if (isNodeOfType(value, "MemberExpression")) {
    return (
      !value.optional &&
      getStaticPropertyName(value) !== null &&
      isReturnedGetterValue(value.object, parameter, proof)
    );
  }
  if (isNodeOfType(value, "ConditionalExpression")) {
    return (
      isGetterCondition(value.test, proof) &&
      isReturnedGetterValue(value.consequent, parameter, proof) &&
      isReturnedGetterValue(value.alternate, parameter, proof)
    );
  }
  return (
    isNodeOfType(value, "CallExpression") &&
    value.arguments.length === GETTER_RESULT_ARGUMENT_COUNT &&
    isNodeOfType(value.arguments[GETTER_RESULT_ARGUMENT_INDEX], "Identifier") &&
    proof.scopes.symbolFor(value.arguments[GETTER_RESULT_ARGUMENT_INDEX])?.id === parameter.id &&
    isGetterCall(value, proof)
  );
};

const isGetterCall = (expression: EsTreeNode, proof: GetterProofContext): boolean => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== GETTER_RESULT_ARGUMENT_COUNT ||
    !isNodeOfType(expression.callee, "Identifier") ||
    !isDataRead(expression.arguments[GETTER_RESULT_ARGUMENT_INDEX], proof.scopes)
  )
    return false;
  const root = getReadonlyRoot(expression.callee, proof.scopes);
  if (!root || hasProducerDefault(root)) return false;
  if (root.kind === "parameter") {
    return (
      findEnclosingFunction(root.bindingIdentifier) === proof.owner &&
      Boolean(
        getParentCallbackPropNames({
          analysis: proof.analysis,
          expression: expression.callee,
          scopes: proof.scopes,
        }),
      )
    );
  }
  if (
    root.kind !== "const" ||
    !root.initializer ||
    findEnclosingFunction(root.declarationNode) !== proof.owner ||
    proof.visited.has(root.id) ||
    proof.visited.size >= FUNCTION_RESOLUTION_MAX_DEPTH
  )
    return false;
  let callback = stripParenExpression(root.initializer);
  if (isNodeOfType(callback, "CallExpression")) {
    const receiver = getRootIdentifier(callback.callee);
    const provider = receiver ? proof.scopes.symbolFor(receiver) : null;
    const declaration = provider ? getImportDeclarationForSymbol(provider) : null;
    if (
      !declaration ||
      declaration.source.value !== "react" ||
      declaration.importKind === "type" ||
      (isNodeOfType(provider?.declarationNode, "ImportSpecifier") &&
        provider.declarationNode.importKind === "type") ||
      !isProvenUnmodifiedReactApiCall(callback, "useCallback", proof.scopes) ||
      hasReactDefaultProviderMutation("useCallback", proof.scopes)
    )
      return false;
    const wrapped = getTransparentReactCallbackWrapperArgument(callback, root, proof.scopes);
    if (!wrapped) return false;
    callback = wrapped;
  }
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== GETTER_RESULT_ARGUMENT_COUNT ||
    !isNodeOfType(callback.params[GETTER_RESULT_ARGUMENT_INDEX], "Identifier")
  )
    return false;
  const parameter = proof.scopes.symbolFor(callback.params[GETTER_RESULT_ARGUMENT_INDEX]);
  const returned = getSingleReturnExpression(callback);
  if (!parameter || !isReadonlySymbol(parameter) || !returned) return false;
  proof.visited.add(root.id);
  const accepted = isReturnedGetterValue(returned, parameter, proof);
  proof.visited.delete(root.id);
  return accepted;
};

export const isTemplateGetterResultConsumedByLocalStateSetter = (
  call: EsTreeNode,
  analysis: ProgramAnalysis,
  scopes: ScopeAnalysis,
): boolean => {
  const conditions: EsTreeNode[] = [];
  let result = findTransparentExpressionRoot(call);
  while (isNodeOfType(result.parent, "ConditionalExpression") && result.parent.test !== result) {
    conditions.push(result.parent.test);
    result = findTransparentExpressionRoot(result.parent);
  }
  const template = result.parent;
  if (
    !isNodeOfType(template, "TemplateLiteral") ||
    template.expressions.length !== GETTER_RESULT_ARGUMENT_COUNT ||
    template.expressions[GETTER_RESULT_ARGUMENT_INDEX] !== result
  )
    return false;
  const templateRoot = findTransparentExpressionRoot(template);
  const sink = templateRoot.parent;
  if (
    !isNodeOfType(sink, "CallExpression") ||
    sink.optional ||
    sink.arguments.length !== GETTER_RESULT_ARGUMENT_COUNT ||
    sink.arguments[GETTER_RESULT_ARGUMENT_INDEX] !== templateRoot ||
    !isNodeOfType(sink.callee, "Identifier")
  )
    return false;
  const pair = resolveReactUseStatePair(sink.callee, scopes);
  if (
    !pair ||
    pair.setterSymbol.kind !== "const" ||
    scopes.symbolFor(sink.callee)?.id !== pair.setterSymbol.id ||
    !isReadonlySymbol(pair.setterSymbol) ||
    !pair.declarator.init ||
    !isUnmodifiedLocalReactStateCall(pair.declarator.init, scopes, {
      allowFiniteCharacterMapLookup: true,
    })
  )
    return false;
  const stateInitializer = stripParenExpression(pair.declarator.init);
  if (!isNodeOfType(stateInitializer, "CallExpression")) return false;
  const stateProviderIdentifier = getRootIdentifier(stateInitializer.callee);
  const stateProvider = stateProviderIdentifier ? scopes.symbolFor(stateProviderIdentifier) : null;
  if (!stateProvider || getImportDeclarationForSymbol(stateProvider)?.source.value !== "react")
    return false;
  const owner = findEnclosingFunction(pair.declarator);
  if (!owner) return false;
  const proof = { analysis, scopes, owner, visited: new Set<number>() };
  return (
    conditions.every((condition) => isGetterCondition(condition, proof)) &&
    isGetterCall(call, proof)
  );
};
