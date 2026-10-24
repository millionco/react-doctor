import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
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
import { MAX_CURRENT_CONTEXT_RECORD_UPDATER_EXCEPTIONS } from "./constants.js";
import { hasCurrentContextRecordEnvironment } from "./has-current-context-record-environment.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";

interface ContextRecordRetirementProof {
  readonly program: EsTreeNode;
  readonly component: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly state: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly currentContext: SymbolDescriptor;
  readonly stampName: string;
  readonly selectedUpdater: EsTreeNode;
}

interface ContextRecordWriterFacts {
  readonly areReferencesClosed: boolean;
  readonly unsupportedUpdaters: ReadonlySet<EsTreeNode>;
}

interface ContextRecordBindingFacts {
  isReadonly?: boolean;
  isClosedReadonly?: boolean;
  guardUsesByState?: WeakMap<SymbolDescriptor, boolean>;
  stateReadsByComponent?: WeakMap<EsTreeNode, WeakMap<SymbolDescriptor, Map<string, boolean>>>;
  writersByStamp?: Map<string, ContextRecordWriterFacts>;
}

const bindingFactsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, WeakMap<SymbolDescriptor, ContextRecordBindingFacts>>
>();

const getContextRecordBindingFacts = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): ContextRecordBindingFacts => {
  let factsByProgram = bindingFactsByScopes.get(scopes);
  if (!factsByProgram) {
    factsByProgram = new WeakMap();
    bindingFactsByScopes.set(scopes, factsByProgram);
  }
  let factsBySymbol = factsByProgram.get(program);
  if (!factsBySymbol) {
    factsBySymbol = new WeakMap();
    factsByProgram.set(program, factsBySymbol);
  }
  let facts = factsBySymbol.get(symbol);
  if (!facts) {
    facts = {};
    factsBySymbol.set(symbol, facts);
  }
  return facts;
};

const isBinding = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const identifier = stripParenExpression(node);
  return isNodeOfType(identifier, "Identifier") && scopes.symbolFor(identifier) === symbol;
};

const hasCompleteReadonlyReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const facts = getContextRecordBindingFacts(symbol, program, scopes);
  if (facts.isReadonly !== undefined) return facts.isReadonly;
  const isReadonly =
    !isErasedTypeScriptBinding(symbol) &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      (reference) =>
        isNonReferenceIdentifier(reference.identifier) ||
        (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
    );
  facts.isReadonly = isReadonly;
  return isReadonly;
};

const hasClosedReadonlyBinding = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const facts = getContextRecordBindingFacts(symbol, program, scopes);
  if (facts.isClosedReadonly !== undefined) return facts.isClosedReadonly;
  const equivalents = new Set([symbol, ...getEquivalentSymbols(symbol.bindingIdentifier, scopes)]);
  const isClosedReadonly = [...equivalents].every(
    (equivalent) =>
      equivalent.bindingIdentifier === symbol.bindingIdentifier &&
      hasCompleteReadonlyReferences(equivalent, program, scopes),
  );
  facts.isClosedReadonly = isClosedReadonly;
  return isClosedReadonly;
};

const isNull = (node: EsTreeNode): boolean => {
  const value = stripParenExpression(node);
  return isNodeOfType(value, "Literal") && value.value === null;
};

const isUndefined = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const value = stripParenExpression(node);
  return (
    (isNodeOfType(value, "Identifier") &&
      value.name === "undefined" &&
      scopes.isGlobalReference(value)) ||
    (isNodeOfType(value, "UnaryExpression") &&
      value.operator === "void" &&
      isNodeOfType(value.argument, "Literal") &&
      value.argument.value === 0)
  );
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

const isFreshStampedRecord = (expression: EsTreeNode, stampName: string): boolean => {
  const value = stripParenExpression(expression);
  if (!isNodeOfType(value, "ObjectExpression")) return false;
  const names = new Set<string>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || names.has(name)) return false;
    names.add(name);
  }
  return names.has(stampName);
};

const hasClosedUpdaterReads = (
  updater: EsTreeNode,
  previous: SymbolDescriptor,
  proof: ContextRecordRetirementProof,
): boolean =>
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
  proof: ContextRecordRetirementProof,
): boolean =>
  isNull(value) ||
  isBinding(value, previous, proof.scopes) ||
  isFreshStampedRecord(value, proof.stampName);

const hasClosedWriter = (call: EsTreeNode, proof: ContextRecordRetirementProof): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const [argument, ...extraArguments] = call.arguments;
  if (!argument || extraArguments.length) return false;
  const value = stripParenExpression(argument);
  if (isNull(value) || isFreshStampedRecord(value, proof.stampName)) return true;
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

const hasOnlyClosedWriters = (proof: ContextRecordRetirementProof): boolean => {
  const facts = getContextRecordBindingFacts(proof.setter, proof.program, proof.scopes);
  const writersByStamp = (facts.writersByStamp ??= new Map());
  let writerFacts = writersByStamp.get(proof.stampName);
  if (!writerFacts) {
    let areReferencesClosed = hasClosedReadonlyBinding(proof.setter, proof.program, proof.scopes);
    const unsupportedUpdaters = new Set<EsTreeNode>();
    const independentProof = { ...proof, selectedUpdater: proof.setter.bindingIdentifier };
    if (areReferencesClosed) {
      for (const reference of proof.setter.references) {
        const identifier = reference.identifier;
        if (isNonReferenceIdentifier(identifier)) continue;
        const root = findTransparentExpressionRoot(identifier);
        const call = root.parent;
        if (!isNodeOfType(call, "CallExpression") || call.callee !== root || call.optional) {
          areReferencesClosed = false;
          break;
        }
        const [argument, ...extraArguments] = call.arguments;
        if (!argument || extraArguments.length) {
          areReferencesClosed = false;
          break;
        }
        if (!hasClosedWriter(call, independentProof))
          unsupportedUpdaters.add(stripParenExpression(argument));
      }
    }
    writerFacts = { areReferencesClosed, unsupportedUpdaters };
    writersByStamp.set(proof.stampName, writerFacts);
  }
  return (
    writerFacts.areReferencesClosed &&
    (writerFacts.unsupportedUpdaters.size === 0 ||
      (writerFacts.unsupportedUpdaters.size === MAX_CURRENT_CONTEXT_RECORD_UPDATER_EXCEPTIONS &&
        writerFacts.unsupportedUpdaters.has(proof.selectedUpdater)))
  );
};

const isMaskedPayloadRead = (
  member: EsTreeNode,
  conditional: EsTreeNode,
  proof: ContextRecordRetirementProof,
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
  proof: ContextRecordRetirementProof,
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
  proof: ContextRecordRetirementProof,
): boolean => {
  const facts = getContextRecordBindingFacts(symbol, proof.program, proof.scopes);
  const guardUsesByState = (facts.guardUsesByState ??= new WeakMap());
  const cached = guardUsesByState.get(proof.state);
  if (cached !== undefined) return cached;
  const hasOnlyGuardUses =
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
  guardUsesByState.set(proof.state, hasOnlyGuardUses);
  return hasOnlyGuardUses;
};

const hasClosedStateReads = (proof: ContextRecordRetirementProof): boolean => {
  const facts = getContextRecordBindingFacts(proof.state, proof.program, proof.scopes);
  const stateReadsByComponent = (facts.stateReadsByComponent ??= new WeakMap());
  let stateReadsByContext = stateReadsByComponent.get(proof.component);
  if (!stateReadsByContext) {
    stateReadsByContext = new WeakMap();
    stateReadsByComponent.set(proof.component, stateReadsByContext);
  }
  let stateReadsByStamp = stateReadsByContext.get(proof.currentContext);
  if (!stateReadsByStamp) {
    stateReadsByStamp = new Map();
    stateReadsByContext.set(proof.currentContext, stateReadsByStamp);
  }
  const cached = stateReadsByStamp.get(proof.stampName);
  if (cached !== undefined) return cached;
  stateReadsByStamp.set(proof.stampName, false);
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
  stateReadsByStamp.set(proof.stampName, hasProjection);
  return hasProjection;
};

export const isCurrentContextRecordRetirement = (
  write: EsTreeNode,
  context: RuleContext,
): boolean => {
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
  const proof: ContextRecordRetirementProof = {
    program,
    component,
    scopes: context.scopes,
    state: pair.stateSymbol,
    setter: pair.setterSymbol,
    currentContext,
    stampName,
    selectedUpdater: updater,
  };
  if (!hasClosedStateReads(proof) || !hasOnlyClosedWriters(proof)) return false;
  return (
    hasRefNotificationReactCall(stateCall, "useState", context) &&
    hasRefNotificationReactCall(effectCall, "useEffect", context) &&
    isUnmodifiedLocalReactStateCall(stateCall, context.scopes) &&
    hasCurrentContextRecordEnvironment(context.filename)
  );
};
