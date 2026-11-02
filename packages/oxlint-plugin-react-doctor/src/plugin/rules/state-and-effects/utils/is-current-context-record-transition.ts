import { isUndefined } from "./is-undefined.js";
import { hasOnlyEventHandlerInvocations } from "./has-only-event-handler-invocations.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasCurrentContextRecordEnvironment } from "./has-current-context-record-environment.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";

interface ContextRecordTransitionProof {
  readonly program: EsTreeNode;
  readonly component: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly context: RuleContext;
  readonly state: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly currentContext: SymbolDescriptor;
  readonly stampName: string;
  readonly selectedUpdater: EsTreeNode | null;
  readonly resetValues: ReadonlyMap<string, EsTreeNode> | null;
  readonly selectedWrite: EsTreeNode;
}

const isBinding = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const identifier = stripParenExpression(node);
  return isNodeOfType(identifier, "Identifier") && scopes.symbolFor(identifier) === symbol;
};

const hasCompleteReadonlyReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  !isErasedTypeScriptBinding(symbol) &&
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  symbol.references.every(
    (reference) =>
      isNonReferenceIdentifier(reference.identifier) ||
      (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
  );

const hasClosedReadonlyBinding = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const equivalents = new Set([symbol, ...getEquivalentSymbols(symbol.bindingIdentifier, scopes)]);
  return [...equivalents].every(
    (equivalent) =>
      equivalent.bindingIdentifier === symbol.bindingIdentifier &&
      hasCompleteReadonlyReferences(equivalent, program, scopes),
  );
};

const isNull = (node: EsTreeNode): boolean => {
  const value = stripParenExpression(node);
  return isNodeOfType(value, "Literal") && value.value === null;
};

const getDataRead = (
  identifier: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const root = findTransparentExpressionRoot(identifier);
  const member = root.parent;
  return isBinding(identifier, symbol, scopes) &&
    isNodeOfType(member, "MemberExpression") &&
    member.object === root &&
    getStaticPropertyName(member) !== null &&
    !isWithinAssignmentTarget(member)
    ? member
    : null;
};

const getRecordProperties = (expression: EsTreeNode): Map<string, EsTreeNode> | null => {
  const value = stripParenExpression(expression);
  if (!isNodeOfType(value, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || properties.has(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};

const isFreshStampedRecord = (expression: EsTreeNode, stampName: string): boolean =>
  Boolean(getRecordProperties(expression)?.has(stampName));

const hasClosedUpdaterReads = (
  updater: EsTreeNode,
  previous: SymbolDescriptor,
  proof: ContextRecordTransitionProof,
): boolean =>
  (proof.resetValues === null || hasResetUpdaterReads(updater, previous, proof)) &&
  hasClosedReadonlyBinding(previous, proof.program, proof.scopes) &&
  previous.references.every((reference) => {
    const identifier = reference.identifier;
    if (isNonReferenceIdentifier(identifier)) return true;
    if (findEnclosingFunction(identifier) !== updater) return false;
    const root = findTransparentExpressionRoot(identifier);
    if (isNodeOfType(root.parent, "ReturnStatement") && root.parent.argument === root) return true;
    const member = getDataRead(identifier, previous, proof.scopes);
    if (!member) return false;
    const value = findTransparentExpressionRoot(member);
    const consumer = value.parent;
    return (
      (isNodeOfType(consumer, "BinaryExpression") &&
        (consumer.operator === "===" || consumer.operator === "!==")) ||
      (isNodeOfType(consumer, "ConditionalExpression") &&
        (consumer.consequent === value || consumer.alternate === value)) ||
      (isNodeOfType(consumer, "Property") &&
        consumer.value === value &&
        isNodeOfType(consumer.parent, "ObjectExpression"))
    );
  });

const returnsClosedRecord = (
  value: EsTreeNode,
  previous: SymbolDescriptor,
  proof: ContextRecordTransitionProof,
): boolean =>
  proof.resetValues === null
    ? isNull(value) ||
      isBinding(value, previous, proof.scopes) ||
      isFreshStampedRecord(value, proof.stampName)
    : isResetRecordWriter(value, proof);

const hasOnlyEventInvocations = (
  functionNode: EsTreeNode | null,
  proof: ContextRecordTransitionProof,
): boolean =>
  hasOnlyEventHandlerInvocations(functionNode, {
    ...proof,
    isReadonlyBinding: (symbol) => hasClosedReadonlyBinding(symbol, proof.program, proof.scopes),
  });

const hasClosedWriter = (call: EsTreeNode, proof: ContextRecordTransitionProof): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  if (
    proof.resetValues !== null &&
    call !== proof.selectedWrite &&
    !hasOnlyEventInvocations(findEnclosingFunction(call), proof)
  )
    return false;
  const [argument, ...extraArguments] = call.arguments;
  if (!argument || extraArguments.length) return false;
  const value = stripParenExpression(argument);
  if (
    proof.resetValues === null
      ? isNull(value) || isFreshStampedRecord(value, proof.stampName)
      : isResetRecordWriter(value, proof)
  )
    return true;
  if (!isNodeOfType(value, "ArrowFunctionExpression") || value.async) return false;
  if (value === proof.selectedUpdater) return true;
  const [parameter, ...extraParameters] = value.params;
  const previous = isNodeOfType(parameter, "Identifier") ? proof.scopes.symbolFor(parameter) : null;
  if (!previous || extraParameters.length || !hasClosedUpdaterReads(value, previous, proof))
    return false;
  if (!isNodeOfType(value.body, "BlockStatement"))
    return returnsClosedRecord(value.body, previous, proof);
  const statements = [...value.body.body];
  const last = statements.pop();
  if (
    !isNodeOfType(last, "ReturnStatement") ||
    !last.argument ||
    !returnsClosedRecord(last.argument, previous, proof)
  )
    return false;
  return statements.every((statement) => {
    if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
    const [returned, ...others] = isNodeOfType(statement.consequent, "BlockStatement")
      ? statement.consequent.body
      : [statement.consequent];
    return (
      !others.length &&
      isNodeOfType(returned, "ReturnStatement") &&
      Boolean(returned.argument && returnsClosedRecord(returned.argument, previous, proof))
    );
  });
};

const hasOnlyClosedWriters = (proof: ContextRecordTransitionProof): boolean =>
  hasClosedReadonlyBinding(proof.setter, proof.program, proof.scopes) &&
  proof.setter.references.every((reference) => {
    const identifier = reference.identifier;
    if (isNonReferenceIdentifier(identifier)) return true;
    const root = findTransparentExpressionRoot(identifier);
    const call = root.parent;
    return (
      isNodeOfType(call, "CallExpression") && call.callee === root && hasClosedWriter(call, proof)
    );
  });

const isMaskedPayloadRead = (
  member: EsTreeNode,
  conditional: EsTreeNode,
  proof: ContextRecordTransitionProof,
): boolean =>
  isNodeOfType(member, "MemberExpression") &&
  member.optional === true &&
  isBinding(member.object, proof.state, proof.scopes) &&
  getStaticPropertyName(member) !== null &&
  isNodeOfType(conditional, "ConditionalExpression") &&
  stripParenExpression(conditional.consequent) === member &&
  isUndefined(conditional.alternate, proof.scopes);

const isCurrentStampComparison = (
  expression: EsTreeNode,
  proof: ContextRecordTransitionProof,
): boolean => {
  const comparison = stripParenExpression(expression);
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "===") return false;
  const member = stripParenExpression(comparison.left);
  return (
    isNodeOfType(member, "MemberExpression") &&
    member.optional === true &&
    isBinding(member.object, proof.state, proof.scopes) &&
    getStaticPropertyName(member) === proof.stampName &&
    isBinding(comparison.right, proof.currentContext, proof.scopes)
  );
};

const hasOnlyPayloadGuardUses = (
  symbol: SymbolDescriptor,
  proof: ContextRecordTransitionProof,
): boolean =>
  hasClosedReadonlyBinding(symbol, proof.program, proof.scopes) &&
  Boolean(symbol.references.length) &&
  symbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const conditional = root.parent;
    return (
      reference.flag === "read" &&
      isNodeOfType(conditional, "ConditionalExpression") &&
      conditional.test === root &&
      isMaskedPayloadRead(stripParenExpression(conditional.consequent), conditional, proof)
    );
  });

const hasClosedStateReads = (proof: ContextRecordTransitionProof): boolean => {
  if (proof.resetValues !== null) return hasResetRecordSelectorReads(proof);
  if (!hasClosedReadonlyBinding(proof.state, proof.program, proof.scopes)) return false;
  let hasProjection = false;
  for (const reference of proof.state.references) {
    const identifier = reference.identifier;
    if (isNonReferenceIdentifier(identifier)) continue;
    if (findEnclosingFunction(identifier) !== proof.component) return false;
    const member = getDataRead(identifier, proof.state, proof.scopes);
    if (!isNodeOfType(member, "MemberExpression") || member.optional !== true) return false;
    const root = findTransparentExpressionRoot(member);
    const comparison = root.parent;
    if (comparison && isCurrentStampComparison(comparison, proof)) {
      const comparisonRoot = findTransparentExpressionRoot(comparison);
      const declaration = comparisonRoot.parent;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.init !== comparisonRoot ||
        !isNodeOfType(declaration.id, "Identifier") ||
        !isNodeOfType(declaration.parent, "VariableDeclaration") ||
        declaration.parent.kind !== "const"
      )
        return false;
      const guard = proof.scopes.symbolFor(declaration.id);
      if (!guard || !hasOnlyPayloadGuardUses(guard, proof)) return false;
      hasProjection = true;
      continue;
    }
    const conditional = root.parent;
    if (
      !isNodeOfType(conditional, "ConditionalExpression") ||
      !isMaskedPayloadRead(member, conditional, proof) ||
      !isNodeOfType(conditional.test, "Identifier")
    )
      return false;
    const guard = proof.scopes.symbolFor(conditional.test);
    const guardDeclaration = guard?.declarationNode;
    if (
      !guard ||
      !isNodeOfType(guardDeclaration, "VariableDeclarator") ||
      !guardDeclaration.init ||
      !isCurrentStampComparison(guardDeclaration.init, proof) ||
      !hasOnlyPayloadGuardUses(guard, proof)
    )
      return false;
    hasProjection = true;
  }
  return hasProjection;
};

const hasSameNeutralValue = (
  left: EsTreeNode | undefined,
  right: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  const leftValue = left && stripParenExpression(left);
  const rightValue = right && stripParenExpression(right);
  if (
    (!leftValue || isUndefined(leftValue, scopes)) &&
    (!rightValue || isUndefined(rightValue, scopes))
  )
    return true;
  return (
    isNodeOfType(leftValue, "Literal") &&
    isNodeOfType(rightValue, "Literal") &&
    (leftValue.value === null ||
      typeof leftValue.value === "string" ||
      typeof leftValue.value === "boolean" ||
      (typeof leftValue.value === "number" && Number.isFinite(leftValue.value))) &&
    Object.is(leftValue.value, rightValue.value)
  );
};

const isCurrentStringSnapshot = (
  expression: EsTreeNode,
  proof: ContextRecordTransitionProof,
): boolean => {
  if (isBinding(expression, proof.currentContext, proof.scopes)) return true;
  const identifier = stripParenExpression(expression);
  const symbol = isNodeOfType(identifier, "Identifier") ? proof.scopes.symbolFor(identifier) : null;
  const declaration = symbol?.declarationNode;
  return Boolean(
    symbol?.kind === "const" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id === symbol.bindingIdentifier &&
    declaration.init &&
    isBinding(declaration.init, proof.currentContext, proof.scopes) &&
    hasCompleteReadonlyReferences(symbol, proof.program, proof.scopes),
  );
};

const isResetRecordWriter = (
  expression: EsTreeNode,
  proof: ContextRecordTransitionProof,
): boolean => {
  const properties = getRecordProperties(expression);
  const stamp = properties?.get(proof.stampName);
  return Boolean(stamp && isCurrentStringSnapshot(stamp, proof));
};

const hasResetUpdaterReads = (
  updater: EsTreeNode,
  previous: SymbolDescriptor,
  proof: ContextRecordTransitionProof,
): boolean => {
  const returned = getSingleReturnExpression(updater);
  const properties = returned && getRecordProperties(returned);
  const stamp = properties?.get(proof.stampName);
  if (!properties || !stamp || !isCurrentStringSnapshot(stamp, proof)) return false;
  return previous.references.every((reference) => {
    if (isNonReferenceIdentifier(reference.identifier)) return true;
    if (findEnclosingFunction(reference.identifier) !== updater) return false;
    const member = getDataRead(reference.identifier, previous, proof.scopes);
    if (!isNodeOfType(member, "MemberExpression") || member.optional) return false;
    const root = findTransparentExpressionRoot(member);
    const parent = root.parent;
    if (
      getStaticPropertyName(member) === proof.stampName &&
      isNodeOfType(parent, "BinaryExpression") &&
      parent.operator === "===" &&
      parent.left === root &&
      isCurrentStringSnapshot(parent.right, proof)
    )
      return isNodeOfType(parent.parent, "ConditionalExpression") && parent.parent.test === parent;
    if (!isNodeOfType(parent, "ConditionalExpression") || parent.consequent !== root) return false;
    const comparison = stripParenExpression(parent.test);
    const comparedMember = isNodeOfType(comparison, "BinaryExpression")
      ? stripParenExpression(comparison.left)
      : null;
    const name = getStaticPropertyName(member);
    return (
      name !== null &&
      name !== proof.stampName &&
      isNodeOfType(comparison, "BinaryExpression") &&
      comparison.operator === "===" &&
      isNodeOfType(comparedMember, "MemberExpression") &&
      !comparedMember.optional &&
      isBinding(comparedMember.object, previous, proof.scopes) &&
      getStaticPropertyName(comparedMember) === proof.stampName &&
      isCurrentStringSnapshot(comparison.right, proof) &&
      hasSameNeutralValue(parent.alternate, proof.resetValues?.get(name), proof.scopes)
    );
  });
};

const hasResetRecordSelectorReads = (proof: ContextRecordTransitionProof): boolean => {
  if (!hasClosedReadonlyBinding(proof.state, proof.program, proof.scopes)) return false;
  const references = proof.state.references.filter(
    (reference) => !isNonReferenceIdentifier(reference.identifier),
  );
  const stampReference = references.find((reference) => {
    const member = getDataRead(reference.identifier, proof.state, proof.scopes);
    return (
      isNodeOfType(member, "MemberExpression") && getStaticPropertyName(member) === proof.stampName
    );
  });
  const stampMember =
    stampReference && getDataRead(stampReference.identifier, proof.state, proof.scopes);
  const comparison = stampMember && findTransparentExpressionRoot(stampMember).parent;
  if (
    !isNodeOfType(stampMember, "MemberExpression") ||
    stampMember.optional ||
    !isNodeOfType(comparison, "BinaryExpression") ||
    comparison.operator !== "===" ||
    stripParenExpression(comparison.left) !== stampMember ||
    !isBinding(comparison.right, proof.currentContext, proof.scopes)
  )
    return false;
  const conditional = findTransparentExpressionRoot(comparison).parent;
  if (
    !isNodeOfType(conditional, "ConditionalExpression") ||
    stripParenExpression(conditional.test) !== comparison ||
    !isBinding(conditional.consequent, proof.state, proof.scopes)
  )
    return false;
  const allowedStateReads = new Set([
    stripParenExpression(stampMember.object),
    stripParenExpression(conditional.consequent),
  ]);
  if (references.some((reference) => !allowedStateReads.has(reference.identifier))) return false;
  const root = findTransparentExpressionRoot(conditional);
  const declaration = root.parent;
  const fallback = getRecordProperties(conditional.alternate);
  if (
    !fallback ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== root ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    findEnclosingFunction(declaration) !== proof.component
  )
    return false;
  const selector = proof.scopes.symbolFor(declaration.id);
  if (!selector || !hasClosedReadonlyBinding(selector, proof.program, proof.scopes)) return false;
  for (const [name, value] of fallback) {
    if (
      name === proof.stampName
        ? !isBinding(value, proof.currentContext, proof.scopes)
        : !hasSameNeutralValue(value, proof.resetValues?.get(name), proof.scopes)
    )
      return false;
  }
  let payloadReads = 0;
  for (const reference of selector.references) {
    if (isNonReferenceIdentifier(reference.identifier)) continue;
    if (findEnclosingFunction(reference.identifier) !== proof.component) return false;
    const member = getDataRead(reference.identifier, selector, proof.scopes);
    if (!isNodeOfType(member, "MemberExpression")) return false;
    const name = getStaticPropertyName(member);
    const root = findTransparentExpressionRoot(member);
    const consumer = root.parent;
    if (
      name === null ||
      name === undefined ||
      name === proof.stampName ||
      OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) ||
      (isNodeOfType(consumer, "CallExpression") && consumer.callee === root) ||
      (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === root) ||
      !hasSameNeutralValue(proof.resetValues?.get(name), fallback.get(name), proof.scopes)
    )
      return false;
    payloadReads += 1;
  }
  return payloadReads > 0;
};

const isCurrentContextRecordReset = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression") || write.optional || !context.filename) return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const stateCall = pair?.declarator.init;
  const component = pair && findEnclosingFunction(pair.declarator);
  const program = findProgramRoot(write);
  const [reset, ...extraArguments] = write.arguments;
  if (
    !pair?.stateSymbol ||
    !component ||
    !program ||
    !isNodeOfType(stateCall, "CallExpression") ||
    !reset ||
    extraArguments.length
  )
    return false;
  const [initial, ...extraInitialArguments] = stateCall.arguments;
  const initialValues = initial && getRecordProperties(initial);
  const resetValues = getRecordProperties(reset);
  if (
    !initialValues ||
    !resetValues ||
    extraInitialArguments.length ||
    initialValues.size !== resetValues.size
  )
    return false;
  let currentContext: SymbolDescriptor | null = null;
  let stampName: string | null = null;
  for (const [name, value] of resetValues) {
    const initialValue = initialValues.get(name);
    if (!initialValue) return false;
    if (hasSameNeutralValue(value, initialValue, context.scopes)) continue;
    const identifier = stripParenExpression(value);
    const symbol = isNodeOfType(identifier, "Identifier")
      ? context.scopes.symbolFor(identifier)
      : null;
    const declaration = symbol?.declarationNode;
    if (
      currentContext ||
      !symbol ||
      symbol.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !declaration.init ||
      !isNodeOfType(stripParenExpression(declaration.init), "TemplateLiteral") ||
      findEnclosingFunction(declaration) !== component ||
      !isBinding(initialValue, symbol, context.scopes) ||
      !hasCompleteReadonlyReferences(symbol, program, context.scopes)
    )
      return false;
    currentContext = symbol;
    stampName = name;
  }
  if (!currentContext || !stampName) return false;
  const effect = findEnclosingFunction(write);
  const effectCall = effect && findTransparentExpressionRoot(effect).parent;
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.params.length ||
    findEnclosingFunction(effect) !== component ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    !isNodeOfType(effectCall, "CallExpression")
  )
    return false;
  const [callback, dependencies, ...extraEffectArguments] = effectCall.arguments;
  const [statement, ...extraStatements] = effect.body.body;
  const dependencyElements = isNodeOfType(dependencies, "ArrayExpression")
    ? dependencies.elements
    : [];
  const [dependency, ...extraDependencies] = dependencyElements;
  if (
    !callback ||
    stripParenExpression(callback) !== effect ||
    extraEffectArguments.length ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    stripParenExpression(statement.expression) !== write ||
    extraStatements.length ||
    !dependency ||
    extraDependencies.length ||
    !isBinding(dependency, currentContext, context.scopes)
  )
    return false;
  const proof: ContextRecordTransitionProof = {
    program,
    component,
    scopes: context.scopes,
    context,
    state: pair.stateSymbol,
    setter: pair.setterSymbol,
    currentContext,
    stampName,
    selectedUpdater: null,
    resetValues,
    selectedWrite: write,
  };
  return (
    hasClosedStateReads(proof) &&
    hasOnlyClosedWriters(proof) &&
    hasRefNotificationReactCall(stateCall, "useState", context) &&
    hasRefNotificationReactCall(effectCall, "useEffect", context) &&
    isUnmodifiedLocalReactStateCall(stateCall, context.scopes) &&
    hasCurrentContextRecordEnvironment(context.filename)
  );
};

export const isCurrentContextRecordTransition = (
  write: EsTreeNode,
  context: RuleContext,
  transitionKind: "retirement" | "neutral-reset" = "retirement",
): boolean =>
  transitionKind === "neutral-reset"
    ? isCurrentContextRecordReset(write, context)
    : isCurrentContextRecordRetirement(write, context);

const isCurrentContextRecordRetirement = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression") || write.optional || !context.filename) return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const component = pair && findEnclosingFunction(pair.declarator);
  const program = findProgramRoot(write);
  const stateCall = pair?.declarator.init;
  const [updater, ...extraArguments] = write.arguments;
  if (
    !pair?.stateSymbol ||
    !component ||
    !program ||
    !stateCall ||
    extraArguments.length ||
    !isNodeOfType(stateCall, "CallExpression") ||
    !isNodeOfType(updater, "ArrowFunctionExpression") ||
    updater.async
  )
    return false;
  const [initialValue, ...otherInitialValues] = stateCall.arguments;
  if (!initialValue || !isNull(initialValue) || otherInitialValues.length) return false;
  const [parameter, ...extraParameters] = updater.params;
  const previous = isNodeOfType(parameter, "Identifier")
    ? context.scopes.symbolFor(parameter)
    : null;
  const returned = getSingleReturnExpression(updater);
  const selected = returned ? stripParenExpression(returned) : null;
  if (
    !previous ||
    extraParameters.length ||
    !isNodeOfType(selected, "ConditionalExpression") ||
    !isNull(selected.consequent) ||
    !isBinding(selected.alternate, previous, context.scopes)
  )
    return false;
  const condition = stripParenExpression(selected.test);
  if (
    !isNodeOfType(condition, "LogicalExpression") ||
    condition.operator !== "&&" ||
    !isBinding(condition.left, previous, context.scopes)
  )
    return false;
  const mismatch = stripParenExpression(condition.right);
  if (!isNodeOfType(mismatch, "BinaryExpression") || mismatch.operator !== "!==") return false;
  const stamp = stripParenExpression(mismatch.left);
  const current = stripParenExpression(mismatch.right);
  const stampName = isNodeOfType(stamp, "MemberExpression") ? getStaticPropertyName(stamp) : null;
  const currentContext = isNodeOfType(current, "Identifier")
    ? context.scopes.symbolFor(current)
    : null;
  if (
    !isNodeOfType(stamp, "MemberExpression") ||
    stamp.optional ||
    !stampName ||
    !isBinding(stamp.object, previous, context.scopes) ||
    !currentContext ||
    currentContext.kind !== "const" ||
    !isNodeOfType(currentContext.declarationNode, "VariableDeclarator") ||
    currentContext.declarationNode.id !== currentContext.bindingIdentifier ||
    !currentContext.declarationNode.init ||
    findEnclosingFunction(currentContext.declarationNode) !== component ||
    !hasCompleteReadonlyReferences(currentContext, program, context.scopes) ||
    !hasClosedReadonlyBinding(previous, program, context.scopes)
  )
    return false;
  const selectedReads = new Set([
    stripParenExpression(condition.left),
    stripParenExpression(stamp.object),
    stripParenExpression(selected.alternate),
  ]);
  if (
    previous.references.some(
      (reference) =>
        !isNonReferenceIdentifier(reference.identifier) && !selectedReads.has(reference.identifier),
    )
  )
    return false;
  const effect = findEnclosingFunction(write);
  const effectCall = effect && findTransparentExpressionRoot(effect).parent;
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    findEnclosingFunction(effect) !== component ||
    effect.params.length ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    !isNodeOfType(effectCall, "CallExpression")
  )
    return false;
  const [effectCallback, dependencies, ...extraEffectArguments] = effectCall.arguments;
  const [statement, ...otherStatements] = effect.body.body;
  if (
    !effectCallback ||
    stripParenExpression(effectCallback) !== effect ||
    extraEffectArguments.length ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    stripParenExpression(statement.expression) !== write ||
    otherStatements.length
  )
    return false;
  const [dependency, ...otherDependencies] = dependencies.elements;
  if (
    !dependency ||
    otherDependencies.length ||
    !isBinding(dependency, currentContext, context.scopes)
  )
    return false;
  const proof: ContextRecordTransitionProof = {
    program,
    component,
    scopes: context.scopes,
    context,
    state: pair.stateSymbol,
    setter: pair.setterSymbol,
    currentContext,
    stampName,
    selectedUpdater: updater,
    resetValues: null,
    selectedWrite: write,
  };
  if (!hasClosedStateReads(proof) || !hasOnlyClosedWriters(proof)) return false;
  return (
    hasRefNotificationReactCall(stateCall, "useState", context) &&
    hasRefNotificationReactCall(effectCall, "useEffect", context) &&
    isUnmodifiedLocalReactStateCall(stateCall, context.scopes) &&
    hasCurrentContextRecordEnvironment(context.filename)
  );
};
