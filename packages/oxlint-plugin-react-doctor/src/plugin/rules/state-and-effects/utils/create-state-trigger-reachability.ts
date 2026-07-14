import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getDownstreamRefs, getRef, getUpstreamRefs, resolveToFunction } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isGenuineReactHookDeclarator, isProp, isState } from "./effect/react.js";
import { getStaticMemberPropertyName } from "./static-member-property-name.js";

interface SnapshotShape {
  scalarKey: string | null;
  elementKeys: ReadonlyArray<string> | null;
}

interface SnapshotEnvironment {
  refShapes: ReadonlyMap<number, SnapshotShape>;
  previousValueKeys: ReadonlyMap<number, string>;
}

interface CreateStateTriggerReachabilityOptions {
  analysis: ProgramAnalysis;
  context: RuleContext;
  effectFunction: EsTreeNode;
}

interface BooleanEvaluationEnvironment {
  analysis: ProgramAnalysis;
  context: RuleContext;
  effectFunction: EsTreeNode;
  snapshotEnvironment: SnapshotEnvironment;
  substitutions: ReadonlyMap<number, EsTreeNode>;
  visitedSymbolIds: ReadonlySet<number>;
  allowHelperCall: boolean;
}

const getRefCurrentSymbol = (node: EsTreeNode, context: RuleContext): SymbolDescriptor | null => {
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    getStaticMemberPropertyName(expression) !== "current" ||
    !isNodeOfType(expression.object, "Identifier")
  ) {
    return null;
  }
  return context.scopes.symbolFor(expression.object);
};

const expressionReadsState = (analysis: ProgramAnalysis, expression: EsTreeNode): boolean =>
  getDownstreamRefs(analysis, expression).some((reference) =>
    getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isState(analysis, upstreamReference),
    ),
  );

const expressionReadsProp = (analysis: ProgramAnalysis, expression: EsTreeNode): boolean =>
  getDownstreamRefs(analysis, expression).some((reference) =>
    getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isProp(analysis, upstreamReference),
    ),
  );

const hasNonInitializerWrite = (analysis: ProgramAnalysis, identifier: EsTreeNode): boolean => {
  const reference = getRef(analysis, identifier);
  return Boolean(
    reference?.resolved?.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    ),
  );
};

const isSupportedPropProjection = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  visitedBindings: ReadonlySet<unknown> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const reference = getRef(analysis, candidate);
    if (!reference) return false;
    if (isProp(analysis, reference)) return true;
    if (!reference.resolved || visitedBindings.has(reference.resolved)) return false;
    if (hasNonInitializerWrite(analysis, candidate)) return false;
    const declarator = reference.resolved.defs
      .map((definition) => definition.node as unknown as EsTreeNode)
      .find((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
    if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
      return false;
    }
    const nextVisitedBindings = new Set(visitedBindings);
    nextVisitedBindings.add(reference.resolved);
    return isSupportedPropProjection(analysis, declarator.init as EsTreeNode, nextVisitedBindings);
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    if (
      candidate.computed &&
      !isNodeOfType(candidate.property, "Literal") &&
      !isNodeOfType(candidate.property, "Identifier")
    ) {
      return false;
    }
    return isSupportedPropProjection(analysis, candidate.object as EsTreeNode, visitedBindings);
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      getStaticMemberPropertyName(callee) === "getTime" &&
      (candidate.arguments ?? []).length === 0 &&
      isSupportedPropProjection(analysis, callee.object as EsTreeNode, visitedBindings),
    );
  }
  return false;
};

const getStableCurrentValueKey = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (expressionReadsState(analysis, expression)) return null;
  if (!expressionReadsProp(analysis, expression)) return null;
  if (!isSupportedPropProjection(analysis, expression)) return null;
  return resolveExpressionKey(expression, context);
};

const getSnapshotShape = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  context: RuleContext,
): SnapshotShape | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) {
    const elementKeys: string[] = [];
    for (const element of candidate.elements ?? []) {
      if (!element || isNodeOfType(element as EsTreeNode, "SpreadElement")) return null;
      const elementKey = getStableCurrentValueKey(analysis, element as EsTreeNode, context);
      if (!elementKey) return null;
      elementKeys.push(elementKey);
    }
    return { scalarKey: null, elementKeys };
  }
  const scalarKey = getStableCurrentValueKey(analysis, candidate, context);
  return scalarKey ? { scalarKey, elementKeys: null } : null;
};

const snapshotShapesMatch = (left: SnapshotShape, right: SnapshotShape): boolean => {
  if (left.scalarKey !== right.scalarKey) return false;
  if (left.elementKeys === null || right.elementKeys === null) {
    return left.elementKeys === right.elementKeys;
  }
  return (
    left.elementKeys.length === right.elementKeys.length &&
    left.elementKeys.every((elementKey, index) => elementKey === right.elementKeys?.[index])
  );
};

const collectSnapshotEnvironment = (
  analysis: ProgramAnalysis,
  effectFunction: EsTreeNode,
  context: RuleContext,
): SnapshotEnvironment => {
  const assignmentsByRefSymbolId = new Map<number, EsTreeNode[]>();
  const refSymbolsById = new Map<number, SymbolDescriptor>();
  walkAst(effectFunction, (child: EsTreeNode): boolean | void => {
    if (child !== effectFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    const refSymbol = getRefCurrentSymbol(child.left as EsTreeNode, context);
    if (!refSymbol) return;
    const assignments = assignmentsByRefSymbolId.get(refSymbol.id) ?? [];
    assignments.push(child);
    assignmentsByRefSymbolId.set(refSymbol.id, assignments);
    refSymbolsById.set(refSymbol.id, refSymbol);
  });

  const refShapes = new Map<number, SnapshotShape>();
  for (const [refSymbolId, assignments] of assignmentsByRefSymbolId) {
    if (assignments.length !== 1) continue;
    const assignment = assignments[0];
    if (!assignment || !isNodeOfType(assignment, "AssignmentExpression")) continue;
    if (context.cfg.enclosingFunction(assignment) !== effectFunction) continue;
    if (!context.cfg.isUnconditionalFromEntry(assignment)) continue;
    const refSymbol = refSymbolsById.get(refSymbolId);
    const declarator = refSymbol?.declarationNode ?? null;
    if (
      !declarator ||
      !isGenuineReactHookDeclarator(analysis, declarator, "useRef") ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.init, "CallExpression")
    ) {
      continue;
    }
    const refIdentifier = isNodeOfType(declarator.id, "Identifier") ? declarator.id : null;
    const declarationSymbol = refIdentifier ? context.scopes.symbolFor(refIdentifier) : null;
    if (!declarationSymbol || declarationSymbol.id !== refSymbolId) continue;
    const hasUnsupportedReference = declarationSymbol.references.some((reference) => {
      const member = reference.identifier.parent;
      if (
        !member ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference.identifier ||
        getStaticMemberPropertyName(member) !== "current"
      ) {
        return true;
      }
      const parent = member.parent;
      if (!parent) return false;
      if (isNodeOfType(parent, "UpdateExpression")) return true;
      if (isNodeOfType(parent, "AssignmentExpression") && parent.left === member) {
        return parent !== assignment;
      }
      return false;
    });
    if (hasUnsupportedReference) continue;
    const initializer = declarator.init.arguments?.[0];
    if (!initializer) continue;
    const initialShape = getSnapshotShape(analysis, initializer as EsTreeNode, context);
    const assignedShape = getSnapshotShape(analysis, assignment.right as EsTreeNode, context);
    if (!initialShape || !assignedShape || !snapshotShapesMatch(initialShape, assignedShape)) {
      continue;
    }
    refShapes.set(refSymbolId, assignedShape);
  }

  const previousValueKeys = new Map<number, string>();
  walkAst(effectFunction, (child: EsTreeNode): boolean | void => {
    if (child !== effectFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
    const refSymbol = getRefCurrentSymbol(child.init as EsTreeNode, context);
    if (!refSymbol) return;
    const snapshotShape = refShapes.get(refSymbol.id);
    if (!snapshotShape) return;
    if (isNodeOfType(child.id, "Identifier") && snapshotShape.scalarKey) {
      const previousSymbol = context.scopes.symbolFor(child.id);
      if (previousSymbol && previousSymbol.kind === "const") {
        previousValueKeys.set(previousSymbol.id, snapshotShape.scalarKey);
      }
      return;
    }
    if (!isNodeOfType(child.id, "ArrayPattern") || !snapshotShape.elementKeys) return;
    for (let elementIndex = 0; elementIndex < child.id.elements.length; elementIndex += 1) {
      const element = child.id.elements[elementIndex];
      const elementKey = snapshotShape.elementKeys[elementIndex];
      if (!element || !elementKey || !isNodeOfType(element, "Identifier")) continue;
      const previousSymbol = context.scopes.symbolFor(element);
      if (previousSymbol && previousSymbol.kind === "const") {
        previousValueKeys.set(previousSymbol.id, elementKey);
      }
    }
  });

  return { refShapes, previousValueKeys };
};

const getSnapshotValueKey = (
  expression: EsTreeNode,
  environment: BooleanEvaluationEnvironment,
): string | null => {
  const candidate = stripParenExpression(expression);
  const refSymbol = getRefCurrentSymbol(candidate, environment.context);
  if (refSymbol) {
    return environment.snapshotEnvironment.refShapes.get(refSymbol.id)?.scalarKey ?? null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = environment.context.scopes.symbolFor(candidate);
  if (!symbol) return null;
  const substitutedExpression = environment.substitutions.get(symbol.id);
  if (substitutedExpression) {
    return getSnapshotValueKey(substitutedExpression, environment);
  }
  const directKey = environment.snapshotEnvironment.previousValueKeys.get(symbol.id);
  if (directKey) return directKey;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    environment.visitedSymbolIds.has(symbol.id)
  ) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(environment.visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return getSnapshotValueKey(symbol.initializer, {
    ...environment,
    visitedSymbolIds: nextVisitedSymbolIds,
  });
};

const evaluateComparison = (
  expression: EsTreeNode,
  environment: BooleanEvaluationEnvironment,
): boolean | null => {
  if (!isNodeOfType(expression, "BinaryExpression")) return null;
  if (!["===", "!==", "==", "!="].includes(expression.operator)) return null;
  const resolveSubstitutedExpression = (operand: EsTreeNode): EsTreeNode => {
    const candidate = stripParenExpression(operand);
    if (!isNodeOfType(candidate, "Identifier")) return candidate;
    const symbol = environment.context.scopes.symbolFor(candidate);
    return (symbol && environment.substitutions.get(symbol.id)) ?? candidate;
  };
  const leftExpression = resolveSubstitutedExpression(expression.left as EsTreeNode);
  const rightExpression = resolveSubstitutedExpression(expression.right as EsTreeNode);
  const leftSnapshotKey = getSnapshotValueKey(leftExpression, environment);
  const rightSnapshotKey = getSnapshotValueKey(rightExpression, environment);
  const leftCurrentKey = getStableCurrentValueKey(
    environment.analysis,
    leftExpression,
    environment.context,
  );
  const rightCurrentKey = getStableCurrentValueKey(
    environment.analysis,
    rightExpression,
    environment.context,
  );
  const comparesSameValue =
    (leftSnapshotKey !== null && leftSnapshotKey === rightCurrentKey) ||
    (rightSnapshotKey !== null && rightSnapshotKey === leftCurrentKey);
  if (!comparesSameValue) return null;
  return expression.operator === "===" || expression.operator === "==";
};

const getHelperReturnExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (
    Boolean((functionNode as unknown as { async?: boolean }).async) ||
    Boolean((functionNode as unknown as { generator?: boolean }).generator)
  ) {
    return null;
  }
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return functionNode.body as EsTreeNode;
  }
  const statements = functionNode.body.body ?? [];
  if (statements.length !== 1 || !isNodeOfType(statements[0], "ReturnStatement")) return null;
  return statements[0].argument ? (statements[0].argument as EsTreeNode) : null;
};

const evaluateBoolean = (
  expression: EsTreeNode,
  environment: BooleanEvaluationEnvironment,
): boolean | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal") && typeof candidate.value === "boolean") {
    return candidate.value;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = environment.context.scopes.symbolFor(candidate);
    if (!symbol) return null;
    const substitutedExpression = environment.substitutions.get(symbol.id);
    if (substitutedExpression) return evaluateBoolean(substitutedExpression, environment);
    if (
      symbol.kind !== "const" ||
      !symbol.initializer ||
      environment.visitedSymbolIds.has(symbol.id)
    ) {
      return null;
    }
    const nextVisitedSymbolIds = new Set(environment.visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return evaluateBoolean(symbol.initializer, {
      ...environment,
      visitedSymbolIds: nextVisitedSymbolIds,
    });
  }
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    const argumentValue = evaluateBoolean(candidate.argument as EsTreeNode, environment);
    return argumentValue === null ? null : !argumentValue;
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    const leftValue = evaluateBoolean(candidate.left as EsTreeNode, environment);
    if (candidate.operator === "&&") {
      if (leftValue === false) return false;
      const rightValue = evaluateBoolean(candidate.right as EsTreeNode, environment);
      if (leftValue === true) return rightValue;
      return rightValue === false ? false : null;
    }
    if (candidate.operator === "||") {
      if (leftValue === true) return true;
      const rightValue = evaluateBoolean(candidate.right as EsTreeNode, environment);
      if (leftValue === false) return rightValue;
      return rightValue === true ? true : null;
    }
    return null;
  }
  const comparisonValue = evaluateComparison(candidate, environment);
  if (comparisonValue !== null) return comparisonValue;
  if (!environment.allowHelperCall || !isNodeOfType(candidate, "CallExpression")) return null;
  const callee = stripParenExpression(candidate.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const calleeReference = getRef(environment.analysis, callee);
  if (
    calleeReference?.resolved?.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    )
  ) {
    return null;
  }
  const helperFunction = calleeReference ? resolveToFunction(calleeReference) : null;
  const returnExpression = helperFunction ? getHelperReturnExpression(helperFunction) : null;
  if (!helperFunction || !returnExpression || !isFunctionLike(helperFunction)) return null;
  const parameters = helperFunction.params ?? [];
  const argumentsForHelper = candidate.arguments ?? [];
  if (parameters.length !== argumentsForHelper.length) return null;
  const substitutions = new Map(environment.substitutions);
  for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
    const parameter = parameters[parameterIndex];
    const argument = argumentsForHelper[parameterIndex];
    if (!parameter || !argument || !isNodeOfType(parameter, "Identifier")) return null;
    const parameterSymbol = environment.context.scopes.symbolFor(parameter);
    if (!parameterSymbol) return null;
    substitutions.set(parameterSymbol.id, argument as EsTreeNode);
  }
  return evaluateBoolean(returnExpression, {
    ...environment,
    substitutions,
    visitedSymbolIds: new Set(),
    allowHelperCall: false,
  });
};

const statementCanCompleteNormally = (
  statement: EsTreeNode,
  environment: BooleanEvaluationEnvironment,
): boolean => {
  if (
    isNodeOfType(statement, "ReturnStatement") ||
    isNodeOfType(statement, "ThrowStatement") ||
    isNodeOfType(statement, "BreakStatement") ||
    isNodeOfType(statement, "ContinueStatement")
  ) {
    return false;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    return (statement.body ?? []).every((childStatement) =>
      statementCanCompleteNormally(childStatement, environment),
    );
  }
  if (isNodeOfType(statement, "IfStatement")) {
    const testValue = evaluateBoolean(statement.test as EsTreeNode, environment);
    if (testValue === true) {
      return statementCanCompleteNormally(statement.consequent as EsTreeNode, environment);
    }
    if (testValue === false) {
      return statement.alternate
        ? statementCanCompleteNormally(statement.alternate as EsTreeNode, environment)
        : true;
    }
    const consequentCanComplete = statementCanCompleteNormally(
      statement.consequent as EsTreeNode,
      environment,
    );
    const alternateCanComplete = statement.alternate
      ? statementCanCompleteNormally(statement.alternate as EsTreeNode, environment)
      : true;
    return consequentCanComplete || alternateCanComplete;
  }
  if (isNodeOfType(statement, "LabeledStatement")) {
    return statementCanCompleteNormally(statement.body as EsTreeNode, environment);
  }
  return true;
};

const isAncestorOf = (ancestor: EsTreeNode, node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const isReachableUnderSnapshotEnvironment = (
  target: EsTreeNode,
  effectFunction: EsTreeNode,
  environment: BooleanEvaluationEnvironment,
): boolean => {
  if (environment.context.cfg.enclosingFunction(target) !== effectFunction) return true;
  let current: EsTreeNode = target;
  while (current !== effectFunction) {
    const parent = current.parent;
    if (!parent) return true;
    if (isFunctionLike(parent) && parent !== effectFunction) return true;
    if (isNodeOfType(parent, "IfStatement")) {
      const testValue = evaluateBoolean(parent.test as EsTreeNode, environment);
      if (isAncestorOf(parent.consequent as EsTreeNode, current) && testValue === false) {
        return false;
      }
      if (
        parent.alternate &&
        isAncestorOf(parent.alternate as EsTreeNode, current) &&
        testValue === true
      ) {
        return false;
      }
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) {
      const leftValue = evaluateBoolean(parent.left as EsTreeNode, environment);
      if (parent.operator === "&&" && leftValue === false) return false;
      if (parent.operator === "||" && leftValue === true) return false;
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const testValue = evaluateBoolean(parent.test as EsTreeNode, environment);
      if (parent.consequent === current && testValue === false) return false;
      if (parent.alternate === current && testValue === true) return false;
    }
    if (isNodeOfType(parent, "BlockStatement")) {
      const containingStatementIndex = (parent.body ?? []).findIndex((statement) =>
        isAncestorOf(statement as EsTreeNode, current),
      );
      if (containingStatementIndex >= 0) {
        const precedingStatements = (parent.body ?? []).slice(0, containingStatementIndex);
        if (
          precedingStatements.some(
            (statement) => !statementCanCompleteNormally(statement as EsTreeNode, environment),
          )
        ) {
          return false;
        }
      }
    }
    current = parent;
  }
  return true;
};

export const createStateTriggerReachability = ({
  analysis,
  context,
  effectFunction,
}: CreateStateTriggerReachabilityOptions): ((target: EsTreeNode) => boolean) => {
  const snapshotEnvironment = collectSnapshotEnvironment(analysis, effectFunction, context);
  if (snapshotEnvironment.refShapes.size === 0) return () => true;
  const environment: BooleanEvaluationEnvironment = {
    analysis,
    context,
    effectFunction,
    snapshotEnvironment,
    substitutions: new Map(),
    visitedSymbolIds: new Set(),
    allowHelperCall: true,
  };
  return (target) => isReachableUnderSnapshotEnvironment(target, effectFunction, environment);
};
