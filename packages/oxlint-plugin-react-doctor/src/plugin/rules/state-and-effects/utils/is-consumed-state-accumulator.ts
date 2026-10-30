import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getStaticNumber } from "../../r3f/utils/get-static-number.js";
import type {
  EffectExecutionFrame,
  EffectStateWriteFact,
} from "./collect-effect-state-write-facts.js";
import {
  ACCUMULATOR_CLAMP_STATEMENT_COUNT,
  ACCUMULATOR_VALUE_ARGUMENT_COUNT,
  ACCUMULATOR_ZERO_DIVISOR,
  FIRST_ARGUMENT_INDEX,
  SECOND_ARGUMENT_INDEX,
} from "./effect/constants.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getEffectFn, isProp } from "./effect/react.js";

interface ScalarStepEvidence {
  isValid: boolean;
  isConstant: boolean;
  isConstantZero: boolean;
}

const SCALAR_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/"]);
const mathSafetyByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const isReadonlyDirectCallableSymbol = (symbol: SymbolDescriptor): boolean =>
  isReadonlySymbol(symbol) &&
  symbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const invocation = root.parent;
    return (
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === root &&
      !invocation.optional
    );
  });

const hasReadonlyMathOrigin = (scopes: ScopeAnalysis): boolean => {
  const cached = mathSafetyByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let isSafe = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isSafe) return false;
    if (isProvenGlobalObjectReference(node, scopes)) {
      isSafe = false;
      return false;
    }
    if (!isProvenGlobalNamespaceReference(node, "Math", scopes)) return;
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    const memberRoot = member ? findTransparentExpressionRoot(member) : null;
    const invocation = memberRoot?.parent;
    if (
      isBindingAssignmentTarget(node) ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "ceil" ||
      isMemberMutationTarget(member) ||
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.callee !== memberRoot ||
      invocation.optional ||
      invocation.arguments.length !== ACCUMULATOR_VALUE_ARGUMENT_COUNT
    ) {
      isSafe = false;
    }
  });
  mathSafetyByScopes.set(scopes, isSafe);
  return isSafe;
};

const isPlainFrame = (frame: EffectExecutionFrame, scopes: ScopeAnalysis): boolean => {
  const owner = frame.functionNode;
  if (
    frame.isDeferred ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  ) {
    return false;
  }
  if (isNodeOfType(owner, "FunctionExpression") && owner.id) return false;
  if (frame.invocation) {
    if (
      !isNodeOfType(frame.invocation, "CallExpression") ||
      frame.invocation.optional ||
      frame.invocation.arguments.length !== owner.params.length ||
      frame.invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const callee = stripParenExpression(frame.invocation.callee);
    if (!isNodeOfType(callee, "Identifier")) return false;
    const symbol = scopes.symbolFor(callee);
    if (
      !symbol ||
      !isReadonlyDirectCallableSymbol(symbol) ||
      (symbol.kind !== "const" && symbol.kind !== "function") ||
      symbol.initializer !== owner
    ) {
      return false;
    }
  }
  let hasOpaqueInput = false;
  walkAst(owner, (node) => {
    if (isNodeOfType(node, "ThisExpression")) hasOpaqueInput = true;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "arguments" &&
      scopes.isGlobalReference(node)
    ) {
      hasOpaqueInput = true;
    }
  });
  return !hasOpaqueInput;
};

export const isConsumedStateAccumulator = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  fact: EffectStateWriteFact,
  frame: EffectExecutionFrame,
  effectNode: EsTreeNode,
): boolean => {
  const scopes = context.scopes;
  const state = fact.stateDeclarator;
  const call = fact.callExpression;
  const effectCallee = isNodeOfType(effectNode, "CallExpression")
    ? stripParenExpression(effectNode.callee)
    : null;
  const effectSymbol = isNodeOfType(effectCallee, "Identifier")
    ? scopes.symbolFor(effectCallee)
    : null;
  const effectImport = effectSymbol ? getImportDeclarationForSymbol(effectSymbol) : null;
  if (
    !effectSymbol ||
    effectImport?.source.value !== "react" ||
    effectImport?.importKind === "type" ||
    (isNodeOfType(effectSymbol.declarationNode, "ImportSpecifier") &&
      effectSymbol.declarationNode.importKind === "type") ||
    !isProvenUnmodifiedReactApiCall(effectNode, "useEffect", scopes) ||
    hasReactDefaultProviderMutation("useEffect", scopes) ||
    fact.isDeferred ||
    fact.hasIndependentWriter ||
    !isNodeOfType(state, "VariableDeclarator") ||
    !isNodeOfType(state.id, "ArrayPattern") ||
    !isNodeOfType(state.init, "CallExpression") ||
    !isNodeOfType(state.init.callee, "Identifier") ||
    !isUnmodifiedLocalReactStateCall(state.init, scopes) ||
    state.init.arguments.length !== ACCUMULATOR_VALUE_ARGUMENT_COUNT ||
    !isNodeOfType(state.init.arguments[FIRST_ARGUMENT_INDEX], "Literal") ||
    typeof state.init.arguments[FIRST_ARGUMENT_INDEX].value !== "number" ||
    !Number.isFinite(state.init.arguments[FIRST_ARGUMENT_INDEX].value) ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== ACCUMULATOR_VALUE_ARGUMENT_COUNT ||
    !isPlainFrame(frame, scopes) ||
    !isNodeReachableWithinFunction(call, context)
  ) {
    return false;
  }
  const stateApiSymbol = scopes.symbolFor(state.init.callee);
  if (!stateApiSymbol || getImportDeclarationForSymbol(stateApiSymbol)?.source.value !== "react") {
    return false;
  }
  const stateBinding = state.id.elements[FIRST_ARGUMENT_INDEX];
  const setterBinding = state.id.elements[SECOND_ARGUMENT_INDEX];
  if (!isNodeOfType(stateBinding, "Identifier") || !isNodeOfType(setterBinding, "Identifier")) {
    return false;
  }
  const stateSymbol = scopes.symbolFor(stateBinding);
  const setterSymbol = scopes.symbolFor(setterBinding);
  if (
    !stateSymbol ||
    !setterSymbol ||
    !isReadonlySymbol(stateSymbol) ||
    !isReadonlyDirectCallableSymbol(setterSymbol)
  ) {
    return false;
  }
  const owner = frame.functionNode;
  const effectFunction = getEffectFn(analysis, effectNode);
  if (
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isFunctionLike(effectFunction) ||
    !isNodeOfType(effectFunction.body, "BlockStatement")
  )
    return false;
  if (frame.invocation) {
    const entryStatement = frame.invocation.parent;
    if (
      !isNodeOfType(entryStatement, "ExpressionStatement") ||
      entryStatement.parent !== effectFunction.body ||
      !isNodeReachableWithinFunction(frame.invocation, context)
    )
      return false;
  } else if (owner !== effectFunction) {
    return false;
  }
  const statement = call.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || statement.parent !== owner.body)
    return false;
  const statementIndex = owner.body.body.findIndex((candidate) => candidate === statement);
  if (statementIndex < 0) return false;
  const consumedConstSymbols = new Set<number>();
  const numericPropSymbols = new Set<number>();
  const resolveConst = (node: EsTreeNode): EsTreeNode | null => {
    const candidate = stripParenExpression(node);
    if (!isNodeOfType(candidate, "Identifier")) return candidate;
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isReadonlySymbol(symbol) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      !symbol.initializer ||
      symbol.initializer.range[1] >= candidate.range[0] ||
      findEnclosingFunction(symbol.declarationNode) !== owner
    ) {
      return candidate;
    }
    consumedConstSymbols.add(symbol.id);
    return symbol.initializer;
  };
  const getStepEvidence = (
    node: EsTreeNode,
    currentFrame: EffectExecutionFrame,
    visitedSymbols: Set<number> = new Set(),
    hasNumericInputContract = false,
  ): ScalarStepEvidence => {
    const candidate = stripParenExpression(node);
    if (isNodeOfType(candidate, "Literal")) {
      return {
        isValid: typeof candidate.value === "number" && Number.isFinite(candidate.value),
        isConstant: true,
        isConstantZero: candidate.value === ACCUMULATOR_ZERO_DIVISOR,
      };
    }
    if (
      isNodeOfType(candidate, "UnaryExpression") &&
      (candidate.operator === "+" || candidate.operator === "-")
    ) {
      return getStepEvidence(
        candidate.argument,
        currentFrame,
        visitedSymbols,
        hasNumericInputContract,
      );
    }
    if (
      isNodeOfType(candidate, "BinaryExpression") &&
      SCALAR_ARITHMETIC_OPERATORS.has(candidate.operator)
    ) {
      const left = getStepEvidence(
        candidate.left,
        currentFrame,
        new Set(visitedSymbols),
        hasNumericInputContract,
      );
      const right = getStepEvidence(
        candidate.right,
        currentFrame,
        new Set(visitedSymbols),
        hasNumericInputContract,
      );
      const isConstant = left.isConstant && right.isConstant;
      const staticValue = isConstant ? getStaticNumber(candidate, scopes) : null;
      return {
        isValid:
          left.isValid &&
          right.isValid &&
          (candidate.operator !== "/" || !right.isConstantZero) &&
          (!isConstant || staticValue !== null),
        isConstant,
        isConstantZero: staticValue === ACCUMULATOR_ZERO_DIVISOR,
      };
    }
    if (!isNodeOfType(candidate, "Identifier"))
      return { isValid: false, isConstant: false, isConstantZero: false };
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      symbol === stateSymbol ||
      visitedSymbols.has(symbol.id) ||
      !isReadonlySymbol(symbol)
    ) {
      return { isValid: false, isConstant: false, isConstantZero: false };
    }
    visitedSymbols.add(symbol.id);
    const substitution = currentFrame.substitutions.get(getRef(analysis, candidate)?.resolved);
    if (substitution) {
      if (
        symbol.kind !== "parameter" ||
        !isNodeOfType(symbol.bindingIdentifier, "Identifier") ||
        !isNodeOfType(getSymbolTypeAnnotation(symbol), "TSNumberKeyword") ||
        !isPlainFrame(substitution.frame, scopes)
      ) {
        return { isValid: false, isConstant: false, isConstantZero: false };
      }
      return getStepEvidence(substitution.expression, substitution.frame, visitedSymbols, true);
    }
    if (
      symbol.kind === "const" &&
      symbol.initializer &&
      symbol.initializer.range[1] < candidate.range[0]
    ) {
      if (
        !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        symbol.declarationNode.id !== symbol.bindingIdentifier
      ) {
        return { isValid: false, isConstant: false, isConstantZero: false };
      }
      consumedConstSymbols.add(symbol.id);
      return getStepEvidence(
        symbol.initializer,
        currentFrame,
        visitedSymbols,
        hasNumericInputContract,
      );
    }
    const reference = getRef(analysis, candidate);
    const annotation = getSymbolTypeAnnotation(symbol);
    const hasNumericContract =
      isNodeOfType(annotation, "TSNumberKeyword") ||
      (!annotation && (hasNumericInputContract || numericPropSymbols.has(symbol.id)));
    const isValidProp = Boolean(reference && isProp(analysis, reference) && hasNumericContract);
    if (isValidProp) numericPropSymbols.add(symbol.id);
    return { isValid: isValidProp, isConstant: false, isConstantZero: false };
  };
  let written = stripParenExpression(call.arguments[FIRST_ARGUMENT_INDEX]);
  const visitedAliases = new Set<EsTreeNode>();
  while (isNodeOfType(written, "Identifier") && !visitedAliases.has(written)) {
    visitedAliases.add(written);
    const resolved = resolveConst(written);
    if (!resolved || resolved === written) break;
    written = stripParenExpression(resolved);
  }
  if (isNodeOfType(written, "CallExpression")) {
    const callee = stripParenExpression(written.callee);
    if (
      written.optional ||
      written.arguments.length !== ACCUMULATOR_VALUE_ARGUMENT_COUNT ||
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      getStaticPropertyName(callee) !== "ceil" ||
      !isNodeOfType(callee.object, "Identifier") ||
      callee.object.name !== "Math" ||
      !scopes.isGlobalReference(callee.object) ||
      !hasReadonlyMathOrigin(scopes)
    ) {
      return false;
    }
    written = stripParenExpression(written.arguments[FIRST_ARGUMENT_INDEX]);
  }
  if (
    !isNodeOfType(written, "BinaryExpression") ||
    written.operator !== "+" ||
    !isNodeOfType(written.left, "Identifier") ||
    scopes.symbolFor(written.left) !== stateSymbol ||
    !getStepEvidence(written.right, frame).isValid
  ) {
    return false;
  }
  let hasClamp = false;
  for (const preceding of owner.body.body.slice(FIRST_ARGUMENT_INDEX, statementIndex)) {
    if (isNodeOfType(preceding, "VariableDeclaration") && preceding.kind === "const") {
      if (
        preceding.declarations.some((declaration) => {
          const symbol = scopes.symbolFor(declaration.id);
          return !symbol || !consumedConstSymbols.has(symbol.id);
        })
      )
        return false;
      continue;
    }
    const clampAliasSymbol =
      isNodeOfType(preceding, "IfStatement") &&
      isNodeOfType(preceding.test, "BinaryExpression") &&
      isNodeOfType(preceding.test.left, "Identifier")
        ? scopes.symbolFor(preceding.test.left)
        : null;
    const clampAliasInitializer = clampAliasSymbol?.initializer;
    if (
      hasClamp ||
      !isNodeOfType(preceding, "IfStatement") ||
      preceding.alternate ||
      !isNodeOfType(preceding.test, "BinaryExpression") ||
      preceding.test.operator !== ">" ||
      !isNodeOfType(preceding.test.left, "Identifier") ||
      !isNodeOfType(call.arguments[FIRST_ARGUMENT_INDEX], "Identifier") ||
      scopes.symbolFor(preceding.test.left) !==
        scopes.symbolFor(call.arguments[FIRST_ARGUMENT_INDEX]) ||
      !clampAliasInitializer ||
      clampAliasInitializer.range[1] >= preceding.test.left.range[0] ||
      !getStepEvidence(preceding.test.right, frame).isValid ||
      !isNodeOfType(preceding.consequent, "BlockStatement") ||
      preceding.consequent.body.length !== ACCUMULATOR_CLAMP_STATEMENT_COUNT
    ) {
      return false;
    }
    hasClamp = true;
    const clamp = preceding.consequent.body[FIRST_ARGUMENT_INDEX];
    const exit = preceding.consequent.body[SECOND_ARGUMENT_INDEX];
    const limit = stripParenExpression(preceding.test.right);
    const clampValue =
      isNodeOfType(clamp, "ExpressionStatement") &&
      isNodeOfType(clamp.expression, "CallExpression") &&
      clamp.expression.arguments.length === ACCUMULATOR_VALUE_ARGUMENT_COUNT
        ? stripParenExpression(clamp.expression.arguments[FIRST_ARGUMENT_INDEX])
        : null;
    const matchesLimit =
      (isNodeOfType(limit, "Identifier") &&
        isNodeOfType(clampValue, "Identifier") &&
        scopes.symbolFor(limit) === scopes.symbolFor(clampValue)) ||
      (isNodeOfType(limit, "Literal") &&
        isNodeOfType(clampValue, "Literal") &&
        limit.value === clampValue.value);
    if (
      !matchesLimit ||
      !isNodeOfType(clamp, "ExpressionStatement") ||
      !isNodeOfType(clamp.expression, "CallExpression") ||
      clamp.expression.optional ||
      clamp.expression.arguments.length !== ACCUMULATOR_VALUE_ARGUMENT_COUNT ||
      !isNodeOfType(clamp.expression.callee, "Identifier") ||
      scopes.symbolFor(clamp.expression.callee) !== setterSymbol ||
      !getStepEvidence(clamp.expression.arguments[FIRST_ARGUMENT_INDEX], frame).isValid ||
      !isNodeOfType(exit, "ReturnStatement") ||
      !isNodeOfType(exit.argument, "Literal")
    ) {
      return false;
    }
  }
  return true;
};
