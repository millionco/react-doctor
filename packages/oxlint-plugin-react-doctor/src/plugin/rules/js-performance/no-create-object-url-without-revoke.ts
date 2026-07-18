import { defineRule } from "../../utils/define-rule.js";
import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ESCAPE_ASSIGNMENT_TARGET_PROPERTIES = new Set(["href", "src", "current"]);

const MESSAGE =
  "`URL.createObjectURL(...)` pins the underlying Blob/File in memory, and this produced URL is not provably revoked. Store the URL and pass that same value to `URL.revokeObjectURL` once you're done so the Blob can be freed.";

const isUrlMethodCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === methodName &&
    isProvenUnmodifiedGlobalNamespaceReference(callee.object, "URL", scopes)
  );
};

const CACHE_STORE_METHOD_NAMES = new Set(["add", "set"]);
const CACHE_EVICTION_METHOD_NAMES = new Set(["clear", "delete"]);
const LOOP_STATEMENT_TYPES = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

const getModuleScopeCacheSymbolId = (node: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  let cacheReference = stripParenExpression(node);
  const visitedSymbolIds = new Set<number>();
  let symbol = isNodeOfType(cacheReference, "Identifier") ? scopes.symbolFor(cacheReference) : null;
  while (
    symbol?.initializer &&
    symbol.kind === "const" &&
    isNodeOfType(stripParenExpression(symbol.initializer), "Identifier") &&
    !visitedSymbolIds.has(symbol.id)
  ) {
    visitedSymbolIds.add(symbol.id);
    cacheReference = stripParenExpression(symbol.initializer);
    symbol = scopes.symbolFor(cacheReference);
  }
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.scope.kind !== "module" ||
    !/cache/i.test(symbol.name)
  ) {
    return null;
  }
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return initializer &&
    isNodeOfType(initializer, "NewExpression") &&
    (isProvenGlobalNamespaceReference(initializer.callee, "Map", scopes) ||
      isProvenGlobalNamespaceReference(initializer.callee, "Set", scopes))
    ? symbol.id
    : null;
};

const identifierResolvesToSymbolId = (
  expression: EsTreeNode,
  symbolId: number,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol) return false;
  if (symbol.id === symbolId) return true;
  if (symbol.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return identifierResolvesToSymbolId(symbol.initializer, symbolId, scopes, nextVisitedSymbolIds);
};

const isModuleScopeCacheReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  getModuleScopeCacheSymbolId(node, scopes) !== null;

const expressionRetainsCandidate = (
  container: EsTreeNode,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const storedExpression = stripParenExpression(container);
  const candidateExpression = stripParenExpression(expression);
  if (storedExpression === candidateExpression) return true;
  if (
    isNodeOfType(storedExpression, "Literal") &&
    isNodeOfType(candidateExpression, "Literal") &&
    storedExpression.value === candidateExpression.value
  ) {
    return true;
  }
  if (
    isNodeOfType(candidateExpression, "Identifier") &&
    isNodeOfType(storedExpression, "Identifier") &&
    (() => {
      const candidateSymbol = scopes.symbolFor(candidateExpression);
      const storedSymbol = scopes.symbolFor(storedExpression);
      return Boolean(
        (candidateSymbol &&
          identifierResolvesToSymbolId(storedExpression, candidateSymbol.id, scopes)) ||
        (storedSymbol &&
          identifierResolvesToSymbolId(candidateExpression, storedSymbol.id, scopes)),
      );
    })()
  ) {
    return true;
  }
  if (isNodeOfType(storedExpression, "ArrayExpression")) {
    return storedExpression.elements.some((element) => {
      if (!element) return false;
      return expressionRetainsCandidate(
        isNodeOfType(element, "SpreadElement") ? element.argument : element,
        candidateExpression,
        scopes,
      );
    });
  }
  if (!isNodeOfType(storedExpression, "ObjectExpression")) return false;
  return storedExpression.properties.some((property) => {
    if (isNodeOfType(property, "SpreadElement")) {
      return expressionRetainsCandidate(property.argument, candidateExpression, scopes);
    }
    return (
      isNodeOfType(property, "Property") &&
      expressionRetainsCandidate(property.value, candidateExpression, scopes)
    );
  });
};

const isCacheStoreOfExpression = (
  call: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const storeMethodName = getStaticPropertyName(callee);
  if (
    !storeMethodName ||
    !CACHE_STORE_METHOD_NAMES.has(storeMethodName) ||
    !isModuleScopeCacheReference(callee.object, scopes)
  ) {
    return false;
  }
  return call.arguments.some(
    (argument) => isAstNode(argument) && expressionRetainsCandidate(argument, expression, scopes),
  );
};

const isRevokeOfExpression = (
  call: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const revokedUrl = call.arguments[0];
  return (
    isUrlMethodCall(call, "revokeObjectURL", scopes) &&
    isAstNode(revokedUrl) &&
    expressionRetainsCandidate(revokedUrl, expression, scopes)
  );
};

const collectRetainedSymbolIds = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  symbolIds: Set<number>,
): void => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (symbol) {
      if (symbolIds.has(symbol.id)) return;
      symbolIds.add(symbol.id);
      if (symbol.kind === "const" && symbol.initializer) {
        collectRetainedSymbolIds(symbol.initializer, scopes, symbolIds);
      }
    }
    return;
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    for (const element of candidate.elements) {
      if (!element) continue;
      collectRetainedSymbolIds(
        isNodeOfType(element, "SpreadElement") ? element.argument : element,
        scopes,
        symbolIds,
      );
    }
    return;
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return;
  for (const property of candidate.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      collectRetainedSymbolIds(property.argument, scopes, symbolIds);
    } else if (isNodeOfType(property, "Property")) {
      collectRetainedSymbolIds(property.value, scopes, symbolIds);
    }
  }
};

const findCallResultExpression = (call: EsTreeNode): EsTreeNode => {
  let resultExpression = findTransparentExpressionRoot(call);
  while (resultExpression.parent) {
    const parent = resultExpression.parent;
    if (isNodeOfType(parent, "AwaitExpression") && parent.argument === resultExpression) {
      resultExpression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "SequenceExpression") &&
      parent.expressions.at(-1) === resultExpression
    ) {
      resultExpression = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  return resultExpression;
};

const findBoundCallResult = (call: EsTreeNode): EsTreeNode | null => {
  const resultExpression = analyzeContainingExpression(call).expressionRoot;
  const consumer = resultExpression.parent;
  if (!consumer) return null;
  if (
    isNodeOfType(consumer, "VariableDeclarator") &&
    consumer.init === resultExpression &&
    isNodeOfType(consumer.id, "Identifier")
  ) {
    return consumer.id;
  }
  if (
    isNodeOfType(consumer, "AssignmentExpression") &&
    consumer.right === resultExpression &&
    isNodeOfType(consumer.left, "Identifier")
  ) {
    return consumer.left;
  }
  return null;
};

const isExpressionBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    (stripParenExpression(parent.left) === stripParenExpression(node) ||
      stripParenExpression(parent.right) === stripParenExpression(node))) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripParenExpression(parent.consequent) === stripParenExpression(node) ||
      stripParenExpression(parent.alternate) === stripParenExpression(node)));

const isGuardedExpressionBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    stripParenExpression(parent.right) === stripParenExpression(node)) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripParenExpression(parent.consequent) === stripParenExpression(node) ||
      stripParenExpression(parent.alternate) === stripParenExpression(node)));

interface ContainingExpressionAnalysis {
  expressionRoot: EsTreeNode;
  isGuarded: boolean;
}

const analyzeContainingExpression = (node: EsTreeNode): ContainingExpressionAnalysis => {
  let expressionRoot = findCallResultExpression(node);
  let isGuarded = false;
  let parent = expressionRoot.parent ?? null;
  while (parent && isExpressionBranchOf(parent, expressionRoot)) {
    if (isGuardedExpressionBranchOf(parent, expressionRoot)) isGuarded = true;
    expressionRoot = findCallResultExpression(parent);
    parent = expressionRoot.parent ?? null;
  }
  return { expressionRoot, isGuarded };
};

const bindingIsReturnedFromBoundary = (
  binding: EsTreeNode,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const symbol = context.scopes.symbolFor(binding);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const consumer = referenceRoot.parent;
    if (
      isNodeOfType(consumer, "ReturnStatement") &&
      context.cfg.enclosingFunction(consumer) === executionBoundary
    ) {
      return context.cfg.isUnconditionalFromEntry(consumer);
    }
    if (
      isNodeOfType(consumer, "VariableDeclarator") &&
      consumer.init === referenceRoot &&
      isNodeOfType(consumer.id, "Identifier") &&
      consumer.parent &&
      isNodeOfType(consumer.parent, "VariableDeclaration") &&
      consumer.parent.kind === "const"
    ) {
      return bindingIsReturnedFromBoundary(
        consumer.id,
        executionBoundary,
        context,
        nextVisitedSymbolIds,
      );
    }
    return false;
  });
};

const isReturnedCleanupFromBoundary = (
  candidate: EsTreeNode,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const cleanupFunction = findEnclosingFunction(candidate);
  if (!cleanupFunction || cleanupFunction === executionBoundary) return false;
  const cleanupRoot = findTransparentExpressionRoot(cleanupFunction);
  const cleanupConsumer = cleanupRoot.parent;
  if (
    isNodeOfType(cleanupConsumer, "ReturnStatement") &&
    context.cfg.enclosingFunction(cleanupConsumer) === executionBoundary
  ) {
    return context.cfg.isUnconditionalFromEntry(cleanupConsumer);
  }
  if (
    isNodeOfType(executionBoundary, "ArrowFunctionExpression") &&
    stripParenExpression(executionBoundary.body) === stripParenExpression(cleanupRoot)
  ) {
    return true;
  }
  if (
    !isNodeOfType(cleanupConsumer, "VariableDeclarator") ||
    cleanupConsumer.init !== cleanupRoot ||
    !isNodeOfType(cleanupConsumer.id, "Identifier")
  ) {
    return false;
  }
  return bindingIsReturnedFromBoundary(cleanupConsumer.id, executionBoundary, context);
};

const statementContainsFunctionExit = (statement: EsTreeNode): boolean => {
  let didFindExit = false;
  walkAst(statement, (child) => {
    if (child !== statement && FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      didFindExit = true;
      return false;
    }
  });
  return didFindExit;
};

const isPositiveGuardOnResult = (
  candidate: EsTreeNode,
  resultExpression: EsTreeNode,
  executionBoundary: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  const resultCandidate = stripParenExpression(resultExpression);
  if (!isNodeOfType(resultCandidate, "Identifier")) return false;
  const resultSymbol = scopes.symbolFor(resultCandidate);
  if (!resultSymbol) return false;
  let current = candidate;
  let didCrossUnrelatedCondition = false;
  let didCrossInterveningExit = false;
  while (current.parent && current !== executionBoundary) {
    const parent = current.parent;
    let guardExpression: EsTreeNode | null = null;
    if (isNodeOfType(parent, "IfStatement") && parent.consequent === current) {
      guardExpression = parent.test;
    } else if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === current
    ) {
      guardExpression = parent.left;
    } else if (isNodeOfType(parent, "ConditionalExpression") && parent.consequent === current) {
      guardExpression = parent.test;
    }
    if (guardExpression) {
      const guardCandidate = stripParenExpression(guardExpression);
      if (
        isNodeOfType(guardCandidate, "Identifier") &&
        identifierResolvesToSymbolId(guardCandidate, resultSymbol.id, scopes)
      ) {
        return !didCrossUnrelatedCondition && !didCrossInterveningExit;
      }
      didCrossUnrelatedCondition = true;
    } else if (
      (isNodeOfType(parent, "IfStatement") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current))
    ) {
      didCrossUnrelatedCondition = true;
    }
    if (isNodeOfType(parent, "BlockStatement")) {
      const currentIndex = parent.body.findIndex(
        (statement) =>
          statement.range[0] === current.range[0] && statement.range[1] === current.range[1],
      );
      const priorStatements = parent.body.slice(0, currentIndex);
      const matchingExitGuardIndex = priorStatements.findLastIndex((statement) => {
        if (
          !isNodeOfType(statement, "IfStatement") ||
          statement.alternate ||
          !statementAlwaysExits(statement.consequent)
        ) {
          return false;
        }
        const guardCandidate = stripParenExpression(statement.test);
        if (!isNodeOfType(guardCandidate, "UnaryExpression") || guardCandidate.operator !== "!") {
          return false;
        }
        const guardedValue = stripParenExpression(guardCandidate.argument);
        return (
          isNodeOfType(guardedValue, "Identifier") &&
          identifierResolvesToSymbolId(guardedValue, resultSymbol.id, scopes)
        );
      });
      if (matchingExitGuardIndex >= 0) {
        const interveningStatements = priorStatements.slice(matchingExitGuardIndex + 1);
        if (
          !didCrossUnrelatedCondition &&
          !didCrossInterveningExit &&
          !interveningStatements.some(statementContainsFunctionExit)
        ) {
          return true;
        }
      }
      if (priorStatements.some(statementContainsFunctionExit)) {
        didCrossInterveningExit = true;
      }
    }
    current = parent;
  }
  return false;
};

const consumerIsGuaranteedAfterResult = (
  consumer: EsTreeNode,
  resultCall: EsTreeNode,
  resultExpression: EsTreeNode,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (isReturnedCleanupFromBoundary(consumer, executionBoundary, context)) {
    return (
      context.cfg.isUnconditionalFromEntry(consumer) ||
      isPositiveGuardOnResult(consumer, resultExpression, executionBoundary, context.scopes)
    );
  }
  if (context.cfg.enclosingFunction(consumer) !== executionBoundary) return false;
  const consumerRunsAfterResult =
    consumer.range[0] > resultCall.range[1] ||
    (consumer.range[0] <= resultCall.range[0] && consumer.range[1] >= resultCall.range[1]);
  if (context.cfg.isUnconditionalFromEntry(consumer) && consumerRunsAfterResult) {
    return true;
  }
  const boundaryControlFlow = executionBoundary ? context.cfg.cfgFor(executionBoundary) : null;
  const resultBlock = boundaryControlFlow?.blockOf(resultCall);
  const consumerBlock = boundaryControlFlow?.blockOf(consumer);
  if (resultBlock && resultBlock === consumerBlock && consumer.range[0] > resultCall.range[1]) {
    return true;
  }
  return (
    consumerRunsAfterResult &&
    isPositiveGuardOnResult(consumer, resultExpression, executionBoundary, context.scopes)
  );
};

const nodeIsWithin = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent ?? null;
  }
  return false;
};

const bindingValueRemainsCurrentAtConsumer = (
  resultExpression: EsTreeNode,
  resultCall: EsTreeNode,
  consumer: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const resultCandidate = stripParenExpression(resultExpression);
  if (!isNodeOfType(resultCandidate, "Identifier")) return true;
  const resultSymbol = scopes.symbolFor(resultCandidate);
  if (!resultSymbol) return false;
  if (
    resultSymbol.references.some(
      (reference) =>
        reference.flag !== "read" &&
        reference.identifier.range[0] > resultCall.range[1] &&
        reference.identifier.range[0] < consumer.range[0],
    )
  ) {
    return false;
  }
  let current = resultCall.parent ?? null;
  while (current) {
    if (LOOP_STATEMENT_TYPES.has(current.type) && !nodeIsWithin(consumer, current)) return false;
    if (FUNCTION_LIKE_TYPES.has(current.type) || isNodeOfType(current, "Program")) break;
    current = current.parent ?? null;
  }
  return true;
};

const collectProvenValueBindings = (
  binding: EsTreeNode,
  scopes: ScopeAnalysis,
  bindings: EsTreeNode[],
  visitedSymbolIds = new Set<number>(),
): void => {
  const symbol = scopes.symbolFor(binding);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return;
  visitedSymbolIds.add(symbol.id);
  bindings.push(binding);
  for (const reference of symbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const consumer = referenceRoot.parent;
    if (
      isNodeOfType(consumer, "VariableDeclarator") &&
      consumer.init === referenceRoot &&
      isNodeOfType(consumer.id, "Identifier") &&
      consumer.parent &&
      isNodeOfType(consumer.parent, "VariableDeclaration") &&
      consumer.parent.kind === "const"
    ) {
      collectProvenValueBindings(consumer.id, scopes, bindings, visitedSymbolIds);
    }
  }
};

const statementAlwaysRevokesResult = (
  statement: EsTreeNode,
  resultExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    for (const child of statement.body) {
      if (statementAlwaysRevokesResult(child, resultExpression, scopes)) return true;
      if (statementAlwaysExits(child)) return false;
    }
    return false;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return Boolean(
      statement.alternate &&
      statementAlwaysRevokesResult(statement.consequent, resultExpression, scopes) &&
      statementAlwaysRevokesResult(statement.alternate, resultExpression, scopes),
    );
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  return (
    isNodeOfType(expression, "CallExpression") &&
    isRevokeOfExpression(expression, resultExpression, scopes)
  );
};

const boundaryHasExhaustiveDisposal = (
  resultCall: EsTreeNode,
  resultExpression: EsTreeNode,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!executionBoundary) return false;
  let didFindExhaustiveDisposal = false;
  walkAst(executionBoundary, (child) => {
    if (child !== executionBoundary && FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (
      isNodeOfType(child, "IfStatement") &&
      child.range[0] > resultCall.range[1] &&
      bindingValueRemainsCurrentAtConsumer(resultExpression, resultCall, child, context.scopes) &&
      isNodeReachableWithinFunction(child, context) &&
      statementAlwaysRevokesResult(child, resultExpression, context.scopes)
    ) {
      didFindExhaustiveDisposal = true;
      return false;
    }
  });
  return didFindExhaustiveDisposal;
};

const boundCreationIsDisposed = (
  createCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const resultExpression = findBoundCallResult(createCall);
  if (!resultExpression) return false;
  const resultSymbol = context.scopes.symbolFor(resultExpression);
  if (!resultSymbol) return false;
  const executionBoundary = context.cfg.enclosingFunction(createCall);
  const valueBindings: EsTreeNode[] = [];
  collectProvenValueBindings(resultExpression, context.scopes, valueBindings);
  const didFindGuaranteedRevoke = valueBindings.some((binding) => {
    const bindingSymbol = context.scopes.symbolFor(binding);
    return bindingSymbol?.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const consumer = referenceRoot.parent;
      return Boolean(
        consumer &&
        isNodeOfType(consumer, "CallExpression") &&
        isRevokeOfExpression(consumer, resultExpression, context.scopes) &&
        bindingValueRemainsCurrentAtConsumer(
          resultExpression,
          createCall,
          consumer,
          context.scopes,
        ) &&
        isNodeReachableWithinFunction(consumer, context) &&
        consumerIsGuaranteedAfterResult(
          consumer,
          createCall,
          resultExpression,
          executionBoundary,
          context,
        ),
      );
    });
  });
  return (
    didFindGuaranteedRevoke ||
    boundaryHasExhaustiveDisposal(createCall, resultExpression, executionBoundary, context)
  );
};

interface ProgramDisposalIndex {
  readonly cacheEvictionsBySymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
  readonly cacheStoresByCacheSymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
  readonly cacheStoresByRetainedSymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
  readonly callsByInitializer: Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>;
  readonly callExpressions: EsTreeNodeOfType<"CallExpression">[];
  readonly forOfStatements: EsTreeNodeOfType<"ForOfStatement">[];
  readonly revokeCallsByArgumentSymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
}

const resolveConstInitializer = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol?.initializer || visitedSymbolIds.has(symbol.id)) return null;
  if (symbol.kind !== "const" && !FUNCTION_LIKE_TYPES.has(symbol.initializer.type)) {
    return symbol.initializer;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "Identifier")
    ? resolveConstInitializer(initializer, scopes, nextVisitedSymbolIds)
    : initializer;
};

const buildProgramDisposalIndex = (
  programRoot: EsTreeNode,
  context: RuleContext,
): ProgramDisposalIndex => {
  const { scopes } = context;
  const index: ProgramDisposalIndex = {
    cacheEvictionsBySymbolId: new Map(),
    cacheStoresByCacheSymbolId: new Map(),
    cacheStoresByRetainedSymbolId: new Map(),
    callsByInitializer: new Map(),
    callExpressions: [],
    forOfStatements: [],
    revokeCallsByArgumentSymbolId: new Map(),
  };
  walkAst(programRoot, (child) => {
    if (isNodeOfType(child, "ForOfStatement")) index.forOfStatements.push(child);
    if (!isNodeOfType(child, "CallExpression")) return;
    index.callExpressions.push(child);
    const resolvedInitializer = resolveConstInitializer(child.callee, scopes);
    if (resolvedInitializer && FUNCTION_LIKE_TYPES.has(resolvedInitializer.type)) {
      const calls = index.callsByInitializer.get(resolvedInitializer) ?? [];
      calls.push(child);
      index.callsByInitializer.set(resolvedInitializer, calls);
    }
    if (isUrlMethodCall(child, "revokeObjectURL", scopes)) {
      const revokedUrl = child.arguments[0];
      if (!isAstNode(revokedUrl)) return;
      const revokedSymbolIds = new Set<number>();
      collectRetainedSymbolIds(revokedUrl, scopes, revokedSymbolIds);
      for (const revokedSymbolId of revokedSymbolIds) {
        const revokeCalls = index.revokeCallsByArgumentSymbolId.get(revokedSymbolId) ?? [];
        revokeCalls.push(child);
        index.revokeCallsByArgumentSymbolId.set(revokedSymbolId, revokeCalls);
      }
      return;
    }
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee) ?? "";
    if (!CACHE_EVICTION_METHOD_NAMES.has(methodName) && !CACHE_STORE_METHOD_NAMES.has(methodName)) {
      return;
    }
    const cacheSymbolId = getModuleScopeCacheSymbolId(callee.object, scopes);
    if (cacheSymbolId === null) return;
    if (CACHE_EVICTION_METHOD_NAMES.has(methodName)) {
      const evictions = index.cacheEvictionsBySymbolId.get(cacheSymbolId) ?? [];
      evictions.push(child);
      index.cacheEvictionsBySymbolId.set(cacheSymbolId, evictions);
      return;
    }
    const cacheStores = index.cacheStoresByCacheSymbolId.get(cacheSymbolId) ?? [];
    cacheStores.push(child);
    index.cacheStoresByCacheSymbolId.set(cacheSymbolId, cacheStores);
    const retainedSymbolIds = new Set<number>();
    for (const argument of child.arguments) {
      if (isAstNode(argument)) collectRetainedSymbolIds(argument, scopes, retainedSymbolIds);
    }
    for (const retainedSymbolId of retainedSymbolIds) {
      const stores = index.cacheStoresByRetainedSymbolId.get(retainedSymbolId) ?? [];
      stores.push(child);
      index.cacheStoresByRetainedSymbolId.set(retainedSymbolId, stores);
    }
  });
  return index;
};

const boundResultIsRevokedBefore = (
  resultCall: EsTreeNodeOfType<"CallExpression">,
  beforeNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const resultExpression = findBoundCallResult(resultCall);
  if (!resultExpression) return false;
  const executionBoundary = context.cfg.enclosingFunction(resultCall);
  if (context.cfg.enclosingFunction(beforeNode) !== executionBoundary) return false;
  const valueBindings: EsTreeNode[] = [];
  collectProvenValueBindings(resultExpression, context.scopes, valueBindings);
  return valueBindings.some((binding) => {
    const symbol = context.scopes.symbolFor(binding);
    return symbol?.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const consumer = referenceRoot.parent;
      return Boolean(
        consumer &&
        isNodeOfType(consumer, "CallExpression") &&
        consumer.range[0] < beforeNode.range[0] &&
        isRevokeOfExpression(consumer, resultExpression, context.scopes) &&
        bindingValueRemainsCurrentAtConsumer(
          resultExpression,
          resultCall,
          consumer,
          context.scopes,
        ) &&
        consumerIsGuaranteedAfterResult(
          consumer,
          resultCall,
          resultExpression,
          executionBoundary,
          context,
        ),
      );
    });
  });
};

const cacheGetMatchesKey = (
  call: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  keyExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  const keyArgument = call.arguments[0];
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "get" &&
    getModuleScopeCacheSymbolId(callee.object, scopes) === cacheSymbolId &&
    isAstNode(keyArgument) &&
    expressionRetainsCandidate(keyArgument, keyExpression, scopes),
  );
};

const cacheKeyIsRevokedBefore = (
  cacheSymbolId: number,
  keyExpression: EsTreeNode,
  beforeNode: EsTreeNode,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean =>
  index.callExpressions.some(
    (call) =>
      call.range[0] < beforeNode.range[0] &&
      cacheGetMatchesKey(call, cacheSymbolId, keyExpression, context.scopes) &&
      boundResultIsRevokedBefore(call, beforeNode, context),
  );

const callbackAlwaysRevokesFirstParameter = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(callback);
  if (
    !isNodeOfType(candidate, "ArrowFunctionExpression") &&
    !isNodeOfType(candidate, "FunctionExpression")
  ) {
    return false;
  }
  const parameter = candidate.params[0];
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const body = stripParenExpression(candidate.body);
  return isNodeOfType(body, "CallExpression")
    ? isRevokeOfExpression(body, parameter, scopes)
    : statementAlwaysRevokesResult(body, parameter, scopes);
};

const cacheClearIsSafe = (
  clearCall: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const executionBoundary = context.cfg.enclosingFunction(clearCall);
  const hasForEachProtocol = index.callExpressions.some((call) => {
    if (
      call.range[0] >= clearCall.range[0] ||
      context.cfg.enclosingFunction(call) !== executionBoundary
    ) {
      return false;
    }
    const callee = stripParenExpression(call.callee);
    const callback = call.arguments[0];
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "forEach" &&
      getModuleScopeCacheSymbolId(callee.object, context.scopes) === cacheSymbolId &&
      isAstNode(callback) &&
      callbackAlwaysRevokesFirstParameter(callback, context.scopes) &&
      context.cfg.isUnconditionalFromEntry(call),
    );
  });
  if (hasForEachProtocol) return true;
  return index.forOfStatements.some((loop) => {
    if (
      loop.range[0] >= clearCall.range[0] ||
      context.cfg.enclosingFunction(loop) !== executionBoundary ||
      !context.cfg.isUnconditionalFromEntry(loop) ||
      !isNodeOfType(loop.left, "VariableDeclaration")
    ) {
      return false;
    }
    const declaration = loop.left.declarations[0];
    const right = stripParenExpression(loop.right);
    if (
      !declaration ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(right, "CallExpression")
    ) {
      return false;
    }
    const valuesCallee = stripParenExpression(right.callee);
    return Boolean(
      isNodeOfType(valuesCallee, "MemberExpression") &&
      getStaticPropertyName(valuesCallee) === "values" &&
      getModuleScopeCacheSymbolId(valuesCallee.object, context.scopes) === cacheSymbolId &&
      statementAlwaysRevokesResult(loop.body, declaration.id, context.scopes),
    );
  });
};

const cacheEvictionIsSafe = (
  eviction: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(eviction.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (methodName === "clear") {
    return cacheClearIsSafe(eviction, cacheSymbolId, index, context);
  }
  const keyExpression = eviction.arguments[0];
  return Boolean(
    methodName === "delete" &&
    isAstNode(keyExpression) &&
    cacheKeyIsRevokedBefore(cacheSymbolId, keyExpression, eviction, index, context),
  );
};

const cacheStoreHasSafeOwnership = (
  store: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const evictions = index.cacheEvictionsBySymbolId.get(cacheSymbolId) ?? [];
  if (
    !evictions.every((eviction) => cacheEvictionIsSafe(eviction, cacheSymbolId, index, context))
  ) {
    return false;
  }
  const callee = stripParenExpression(store.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "set") {
    return true;
  }
  const keyExpression = store.arguments[0];
  if (!isAstNode(keyExpression)) return true;
  const executionBoundary = context.cfg.enclosingFunction(store);
  if (isNodeOfType(executionBoundary, "Program")) return true;
  const hasSameKeyReplacement = (index.cacheStoresByCacheSymbolId.get(cacheSymbolId) ?? []).some(
    (candidateStore) => {
      if (
        candidateStore === store ||
        context.cfg.enclosingFunction(candidateStore) !== executionBoundary
      ) {
        return false;
      }
      const candidateKey = candidateStore.arguments[0];
      return (
        isAstNode(candidateKey) &&
        expressionRetainsCandidate(candidateKey, keyExpression, context.scopes)
      );
    },
  );
  if (!isNodeOfType(stripParenExpression(keyExpression), "Literal") && !hasSameKeyReplacement) {
    return true;
  }
  return cacheKeyIsRevokedBefore(cacheSymbolId, keyExpression, store, index, context);
};

const moduleDisposesEveryReturnedResult = (
  createCall: EsTreeNode,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const enclosingFunction = findEnclosingFunction(createCall);
  if (!enclosingFunction) return false;
  const returnedExpression = analyzeContainingExpression(createCall).expressionRoot;
  const isExplicitReturn = isNodeOfType(returnedExpression.parent, "ReturnStatement");
  const isConciseArrowReturn =
    isNodeOfType(enclosingFunction, "ArrowFunctionExpression") &&
    stripParenExpression(enclosingFunction.body) === stripParenExpression(returnedExpression);
  if (!isExplicitReturn && !isConciseArrowReturn) {
    return false;
  }
  let didFindCall = false;
  let didFindUndisposedCall = false;
  for (const child of index.callsByInitializer.get(enclosingFunction) ?? []) {
    if (didFindUndisposedCall) break;
    didFindCall = true;
    const resultExpression =
      findBoundCallResult(child) ?? analyzeContainingExpression(child).expressionRoot;
    let didDisposeResult = false;
    const executionBoundary = context.cfg.enclosingFunction(child);
    const resultCandidate = stripParenExpression(resultExpression);
    const resultSymbol = isNodeOfType(resultCandidate, "Identifier")
      ? scopes.symbolFor(resultCandidate)
      : null;
    const candidateConsumers = resultSymbol
      ? [
          ...(index.cacheStoresByRetainedSymbolId.get(resultSymbol.id) ?? []),
          ...(index.revokeCallsByArgumentSymbolId.get(resultSymbol.id) ?? []),
        ]
      : (() => {
          const ancestors: EsTreeNodeOfType<"CallExpression">[] = [];
          let ancestor = resultExpression.parent ?? null;
          while (ancestor && context.cfg.enclosingFunction(ancestor) === executionBoundary) {
            if (isNodeOfType(ancestor, "CallExpression")) ancestors.push(ancestor);
            ancestor = ancestor.parent ?? null;
          }
          return ancestors;
        })();
    for (const candidate of candidateConsumers) {
      if (didDisposeResult) break;
      if (
        isNodeReachableWithinFunction(candidate, context) &&
        bindingValueRemainsCurrentAtConsumer(resultExpression, child, candidate, scopes) &&
        consumerIsGuaranteedAfterResult(
          candidate,
          child,
          resultExpression,
          executionBoundary,
          context,
        )
      ) {
        if (isRevokeOfExpression(candidate, resultExpression, scopes)) {
          didDisposeResult = true;
          continue;
        }
        if (!isCacheStoreOfExpression(candidate, resultExpression, scopes)) continue;
        const candidateCallee = stripParenExpression(candidate.callee);
        if (isNodeOfType(candidateCallee, "MemberExpression")) {
          const cacheSymbolId = getModuleScopeCacheSymbolId(candidateCallee.object, scopes);
          didDisposeResult =
            cacheSymbolId !== null &&
            cacheStoreHasSafeOwnership(candidate, cacheSymbolId, index, context);
        }
      }
    }
    if (
      !didDisposeResult &&
      boundaryHasExhaustiveDisposal(child, resultExpression, executionBoundary, context)
    ) {
      didDisposeResult = true;
    }
    if (!didDisposeResult) {
      didFindUndisposedCall = true;
    }
  }
  return didFindCall && !didFindUndisposedCall;
};

const isStateSetterCallee = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(callee);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (isSetterIdentifier(candidate.name)) return true;
  const symbol = scopes.symbolFor(candidate);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return isStateSetterCallee(symbol.initializer, scopes, nextVisitedSymbolIds);
};

const SET_ATTRIBUTE_URL_NAMES = new Set(["href", "src"]);

const resolveStaticString = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): string | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal") && typeof candidate.value === "string") {
    return candidate.value;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return null;
  }
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return resolveStaticString(symbol.initializer, scopes, nextVisitedSymbolIds);
};

const isUrlSetAttributeCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  urlArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName =
    getStaticPropertyName(callee) ??
    (callee.computed && isAstNode(callee.property)
      ? resolveStaticString(callee.property, scopes)
      : null);
  if (methodName !== "setAttribute") return false;
  const [attributeName, attributeValue] = call.arguments;
  if (!isAstNode(attributeName) || !isAstNode(attributeValue)) return false;
  const attributeNameCandidate = stripParenExpression(attributeName);
  if (
    !isNodeOfType(attributeNameCandidate, "Literal") ||
    typeof attributeNameCandidate.value !== "string"
  ) {
    return false;
  }
  if (!SET_ATTRIBUTE_URL_NAMES.has(attributeNameCandidate.value)) return false;
  return stripParenExpression(attributeValue) === stripParenExpression(urlArgument);
};

const isDirectIfBranchStatement = (candidate: EsTreeNode): boolean => {
  const statement = findTransparentExpressionRoot(candidate).parent ?? null;
  if (
    !statement ||
    (!isNodeOfType(statement, "ExpressionStatement") &&
      !isNodeOfType(statement, "VariableDeclaration"))
  ) {
    return false;
  }
  let container = statement.parent ?? null;
  if (container && isNodeOfType(container, "BlockStatement")) container = container.parent ?? null;
  return container !== null && isNodeOfType(container, "IfStatement");
};

const isNestedInReturnedValue = (node: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(node);
  while (current.parent) {
    const resultExpression = findCallResultExpression(current);
    if (resultExpression !== current) {
      current = resultExpression;
      continue;
    }
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) return true;
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") &&
      stripParenExpression(parent.body) === stripParenExpression(current)
    ) {
      return true;
    }
    if (isNodeOfType(parent, "Property") && parent.value === current) {
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "ObjectExpression") &&
        parent.properties.some((property) => property === current)) ||
      (isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === current)) ||
      (isNodeOfType(parent, "SpreadElement") && parent.argument === current)
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isExpressionBranchOf(parent, current)) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const boundValueHasHardEscape = (
  binding: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const symbol = context.scopes.symbolFor(binding);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const nextVisitedSymbolIds = new Set(visitedSymbolIds);
  nextVisitedSymbolIds.add(symbol.id);
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const consumer = referenceRoot.parent;
    if (
      isNodeOfType(consumer, "VariableDeclarator") &&
      consumer.init === referenceRoot &&
      isNodeOfType(consumer.id, "Identifier") &&
      consumer.parent &&
      isNodeOfType(consumer.parent, "VariableDeclaration") &&
      consumer.parent.kind === "const"
    ) {
      return boundValueHasHardEscape(consumer.id, context, nextVisitedSymbolIds);
    }
    if (
      isNodeOfType(consumer, "AssignmentExpression") &&
      consumer.right === referenceRoot &&
      isNodeOfType(consumer.left, "MemberExpression") &&
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(getStaticPropertyName(consumer.left) ?? "")
    ) {
      return true;
    }
    if (isNestedInReturnedValue(referenceRoot)) return true;
    if (isNodeOfType(consumer, "JSXExpressionContainer") && consumer.parent) {
      return isNodeOfType(consumer.parent, "JSXAttribute");
    }
    return Boolean(
      isNodeOfType(consumer, "CallExpression") &&
      isUrlSetAttributeCall(consumer, referenceRoot, context.scopes),
    );
  });
};

const escapeIsLeaky = (callNode: EsTreeNode, context: RuleContext): boolean => {
  const containingExpression = analyzeContainingExpression(callNode);
  const topNode = containingExpression.expressionRoot;
  const guarded = containingExpression.isGuarded;
  const parent = topNode.parent ?? null;
  if (!parent) return false;
  const storedResultIsGuarded = guarded || isDirectIfBranchStatement(parent);

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    stripParenExpression(parent.right) === stripParenExpression(topNode)
  ) {
    const target = parent.left;
    if (
      isNodeOfType(target, "MemberExpression") &&
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(getStaticPropertyName(target) ?? "")
    ) {
      return true;
    }
    // The guarded creation assigned to a pre-declared variable is the same
    // "object URL for fetched data" leak as the guarded VariableDeclarator.
    if (isNodeOfType(target, "Identifier")) {
      return storedResultIsGuarded;
    }
    return false;
  }

  if (isNodeOfType(parent, "ReturnStatement")) return true;
  if (isNestedInReturnedValue(topNode)) return true;

  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    stripParenExpression(parent.body) === stripParenExpression(topNode)
  ) {
    return true;
  }

  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.parent) {
    return isNodeOfType(parent.parent, "JSXAttribute");
  }

  // A conditional/logical creation stored in a variable is the
  // "object URL for fetched data, kept in state" leak; an unguarded
  // `const x = URL.createObjectURL(file)` is the ambiguous
  // avatar/preview case the spec keeps quiet.
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init &&
    stripParenExpression(parent.init) === stripParenExpression(topNode)
  ) {
    return (
      storedResultIsGuarded ||
      (isNodeOfType(parent.id, "Identifier") && boundValueHasHardEscape(parent.id, context))
    );
  }

  // Passed directly to a state setter (`setImageUrl(URL.createObjectURL(...))`)
  // or set as an element URL attribute (`a.setAttribute('href', ...)`).
  if (isNodeOfType(parent, "CallExpression")) {
    if (isStateSetterCallee(parent.callee, context.scopes)) return true;
    if (isUrlSetAttributeCall(parent, topNode, context.scopes)) return true;
  }

  return false;
};

// Flags `URL.createObjectURL(...)` whose produced URL escapes (assigned to
// an element `href`/`src` directly or via `setAttribute`, stored into a ref,
// returned, rendered inline in JSX, passed to a state setter, or a guarded
// value bound to a variable — declared or assigned)
// when no matching cleanup is proven after creation. The blob URL pins its
// Blob/File in memory until revoked, so an un-revoked URL leaks.
export const noCreateObjectUrlWithoutRevoke = defineRule({
  id: "no-create-object-url-without-revoke",
  title: "createObjectURL without revokeObjectURL",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Call `URL.revokeObjectURL(url)` once the object URL is no longer needed (after the download, in a `useEffect` cleanup, or on unmount). An object URL keeps its Blob/File alive for the document lifetime until it is revoked.",
  create: (context: RuleContext) => {
    let programRoot: EsTreeNode | null = null;
    let programDisposalIndex: ProgramDisposalIndex | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programRoot = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isUrlMethodCall(node, "createObjectURL", context.scopes)) return;
        if (!escapeIsLeaky(node, context)) return;
        if (boundCreationIsDisposed(node, context)) return;
        if (programRoot) {
          programDisposalIndex ??= buildProgramDisposalIndex(programRoot, context);
          if (moduleDisposesEveryReturnedResult(node, programDisposalIndex, context)) return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
