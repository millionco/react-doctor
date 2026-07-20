import { defineRule } from "../../utils/define-rule.js";
import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { resolveStaticLocalCallFunction } from "../../utils/get-order-independent-local-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
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
    isProvenUnmodifiedGlobalNamespaceReference(callee.object, "URL", scopes, methodName)
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

interface ModuleScopeCache {
  readonly kind: "map" | "set";
  readonly symbolId: number;
}

interface CacheRetention {
  readonly kind: "map-key" | "map-value" | "set-element";
  readonly propertyPath: readonly string[];
}

interface ProducedValueBinding {
  readonly acquiredAt: number;
  readonly binding: EsTreeNode;
}

interface BindingPathAlias {
  readonly binding: EsTreeNode;
  readonly propertyPath: readonly string[];
}

const getModuleScopeCache = (node: EsTreeNode, scopes: ScopeAnalysis): ModuleScopeCache | null => {
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
  if (!initializer || !isNodeOfType(initializer, "NewExpression")) return null;
  if (isProvenGlobalNamespaceReference(initializer.callee, "Map", scopes)) {
    return { kind: "map", symbolId: symbol.id };
  }
  if (isProvenGlobalNamespaceReference(initializer.callee, "Set", scopes)) {
    return { kind: "set", symbolId: symbol.id };
  }
  return null;
};

const getModuleScopeCacheSymbolId = (node: EsTreeNode, scopes: ScopeAnalysis): number | null =>
  getModuleScopeCache(node, scopes)?.symbolId ?? null;

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

const expressionsReferToSameValue = (
  firstExpression: EsTreeNode,
  secondExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const firstCandidate = stripParenExpression(firstExpression);
  const secondCandidate = stripParenExpression(secondExpression);
  if (firstCandidate === secondCandidate) return true;
  if (
    isNodeOfType(firstCandidate, "Literal") &&
    isNodeOfType(secondCandidate, "Literal") &&
    firstCandidate.value === secondCandidate.value
  ) {
    return true;
  }
  if (!isNodeOfType(firstCandidate, "Identifier") || !isNodeOfType(secondCandidate, "Identifier")) {
    return false;
  }
  const firstSymbol = scopes.symbolFor(firstCandidate);
  const secondSymbol = scopes.symbolFor(secondCandidate);
  return Boolean(
    (firstSymbol && identifierResolvesToSymbolId(secondCandidate, firstSymbol.id, scopes)) ||
    (secondSymbol && identifierResolvesToSymbolId(firstCandidate, secondSymbol.id, scopes)),
  );
};

const findRetainedPropertyPath = (
  container: EsTreeNode,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): readonly string[] | null => {
  const candidate = stripParenExpression(container);
  if (expressionsReferToSameValue(candidate, expression, scopes)) return [];
  if (!isNodeOfType(candidate, "ObjectExpression")) return null;
  for (const property of candidate.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) continue;
    const nestedPath = findRetainedPropertyPath(property.value, expression, scopes);
    if (nestedPath) return [propertyName, ...nestedPath];
  }
  return null;
};

const getCacheRetention = (
  store: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): CacheRetention | null => {
  const callee = stripParenExpression(store.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const cache = getModuleScopeCache(callee.object, scopes);
  if (!cache) return null;
  const methodName = getStaticPropertyName(callee);
  if (cache.kind === "set" && methodName === "add") {
    const element = store.arguments[0];
    return isAstNode(element) && expressionRetainsCandidate(element, expression, scopes)
      ? { kind: "set-element", propertyPath: [] }
      : null;
  }
  if (cache.kind !== "map" || methodName !== "set") return null;
  const key = store.arguments[0];
  if (isAstNode(key) && expressionRetainsCandidate(key, expression, scopes)) {
    return { kind: "map-key", propertyPath: [] };
  }
  const value = store.arguments[1];
  if (!isAstNode(value)) return null;
  const propertyPath = findRetainedPropertyPath(value, expression, scopes);
  return propertyPath ? { kind: "map-value", propertyPath } : null;
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

const isRevokeOfProducedBinding = (
  call: EsTreeNodeOfType<"CallExpression">,
  binding: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const revokedUrl = call.arguments[0];
  if (!isUrlMethodCall(call, "revokeObjectURL", scopes) || !isAstNode(revokedUrl)) return false;
  const revokedCandidate = stripParenExpression(revokedUrl);
  const bindingCandidate = stripParenExpression(binding);
  if (revokedCandidate === bindingCandidate) return true;
  if (
    !isNodeOfType(revokedCandidate, "Identifier") ||
    !isNodeOfType(bindingCandidate, "Identifier")
  ) {
    return false;
  }
  const revokedSymbol = scopes.symbolFor(revokedCandidate);
  const bindingSymbol = scopes.symbolFor(bindingCandidate);
  return Boolean(revokedSymbol && bindingSymbol && revokedSymbol.id === bindingSymbol.id);
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

const statementContainsBypassingControlFlow = (statement: EsTreeNode): boolean => {
  let didFindExit = false;
  const rootIsLoop = LOOP_STATEMENT_TYPES.has(statement.type);
  walkAst(statement, (child) => {
    if (child !== statement && FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (child !== statement && LOOP_STATEMENT_TYPES.has(child.type)) return false;
    if (
      isNodeOfType(child, "ReturnStatement") ||
      isNodeOfType(child, "ThrowStatement") ||
      (!rootIsLoop &&
        (isNodeOfType(child, "BreakStatement") || isNodeOfType(child, "ContinueStatement")))
    ) {
      didFindExit = true;
      return false;
    }
  });
  return didFindExit;
};

const isPositiveGuardOnResult = (
  candidate: EsTreeNode,
  resultExpression: EsTreeNode,
  acquiredAt: number,
  executionBoundary: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  const resultCandidate = stripParenExpression(resultExpression);
  if (!isNodeOfType(resultCandidate, "Identifier")) return false;
  const resultSymbol = scopes.symbolFor(resultCandidate);
  if (!resultSymbol) return false;
  let current = candidate;
  let didFindPositiveResultGuard = false;
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
      const guardAlsoControlsResult =
        (isNodeOfType(parent, "IfStatement") &&
          ((parent.consequent === current &&
            isAstDescendant(resultExpression, parent.consequent)) ||
            (parent.alternate === current &&
              parent.alternate !== null &&
              isAstDescendant(resultExpression, parent.alternate)))) ||
        (isNodeOfType(parent, "LogicalExpression") &&
          parent.right === current &&
          isAstDescendant(resultExpression, parent.right)) ||
        (isNodeOfType(parent, "ConditionalExpression") &&
          ((parent.consequent === current &&
            isAstDescendant(resultExpression, parent.consequent)) ||
            (parent.alternate === current && isAstDescendant(resultExpression, parent.alternate))));
      const guardCandidate = stripParenExpression(guardExpression);
      if (
        isNodeOfType(guardCandidate, "Identifier") &&
        identifierResolvesToSymbolId(guardCandidate, resultSymbol.id, scopes)
      ) {
        didFindPositiveResultGuard = true;
      } else if (!guardAlsoControlsResult) {
        didCrossUnrelatedCondition = true;
      }
    } else if (
      (isNodeOfType(parent, "IfStatement") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current))
    ) {
      const conditionalBranch = isNodeOfType(parent, "IfStatement")
        ? parent.consequent === current
          ? parent.consequent
          : parent.alternate
        : current;
      if (!conditionalBranch || !isAstDescendant(resultExpression, conditionalBranch)) {
        didCrossUnrelatedCondition = true;
      }
    }
    const optionalExecutionRegion =
      ((isNodeOfType(parent, "WhileStatement") ||
        isNodeOfType(parent, "ForStatement") ||
        isNodeOfType(parent, "ForInStatement") ||
        isNodeOfType(parent, "ForOfStatement")) &&
        parent.body === current) ||
      isNodeOfType(parent, "SwitchCase") ||
      (isNodeOfType(parent, "CatchClause") && parent.body === current)
        ? parent
        : null;
    if (optionalExecutionRegion && !isAstDescendant(resultExpression, optionalExecutionRegion)) {
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
        didFindPositiveResultGuard = true;
        if (interveningStatements.some(statementContainsBypassingControlFlow)) {
          didCrossInterveningExit = true;
        }
      }
      const unrelatedPriorStatements = (
        matchingExitGuardIndex >= 0
          ? priorStatements.filter((_, index) => index !== matchingExitGuardIndex)
          : priorStatements
      ).filter((statement) => statement.range[1] > acquiredAt);
      if (unrelatedPriorStatements.some(statementContainsBypassingControlFlow)) {
        didCrossInterveningExit = true;
      }
    }
    current = parent;
  }
  return didFindPositiveResultGuard && !didCrossUnrelatedCondition && !didCrossInterveningExit;
};

const isWithinConditionallyEvaluatedExpression = (
  candidate: EsTreeNode,
  executionBoundary: EsTreeNode | null,
): boolean => {
  let current = candidate;
  while (current.parent && current !== executionBoundary) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current))
    ) {
      return true;
    }
    current = parent;
  }
  return false;
};

const consumerIsGuaranteedAfterResult = (
  consumer: EsTreeNode,
  resultCall: EsTreeNode,
  producedValue: ProducedValueBinding,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const resultExpression = producedValue.binding;
  const hasPositiveResultGuard = isPositiveGuardOnResult(
    consumer,
    resultExpression,
    producedValue.acquiredAt,
    executionBoundary,
    context.scopes,
  );
  const isConditionallyEvaluated = isWithinConditionallyEvaluatedExpression(
    consumer,
    executionBoundary,
  );
  if (isReturnedCleanupFromBoundary(consumer, executionBoundary, context)) {
    if (hasPositiveResultGuard) return true;
    if (isConditionallyEvaluated) return false;
    return context.cfg.isUnconditionalFromEntry(consumer);
  }
  if (context.cfg.enclosingFunction(consumer) !== executionBoundary) return false;
  const consumerRunsAfterResult =
    consumer.range[0] > resultCall.range[1] ||
    (consumer.range[0] <= resultCall.range[0] && consumer.range[1] >= resultCall.range[1]);
  if (
    !isConditionallyEvaluated &&
    context.cfg.isUnconditionalFromEntry(consumer) &&
    consumerRunsAfterResult
  ) {
    return true;
  }
  const boundaryControlFlow = executionBoundary ? context.cfg.cfgFor(executionBoundary) : null;
  const resultBlock = boundaryControlFlow?.blockOf(resultCall);
  const consumerBlock = boundaryControlFlow?.blockOf(consumer);
  if (
    !isConditionallyEvaluated &&
    resultBlock &&
    resultBlock === consumerBlock &&
    consumer.range[0] > resultCall.range[1]
  ) {
    return true;
  }
  return consumerRunsAfterResult && hasPositiveResultGuard;
};

const identifierIsWithinAssignmentTarget = (identifier: EsTreeNode): boolean => {
  let current = identifier;
  while (current.parent) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "Property") && parent.value === current) ||
      (isNodeOfType(parent, "RestElement") && parent.argument === current) ||
      (isNodeOfType(parent, "AssignmentPattern") && parent.left === current) ||
      isNodeOfType(parent, "ObjectPattern") ||
      isNodeOfType(parent, "ArrayPattern")
    ) {
      current = parent;
      continue;
    }
    return (
      (isNodeOfType(parent, "AssignmentExpression") ||
        isNodeOfType(parent, "ForInStatement") ||
        isNodeOfType(parent, "ForOfStatement")) &&
      parent.left === current
    );
  }
  return false;
};

const bindingValueHasNoWritesBefore = (
  producedValue: ProducedValueBinding,
  consumer: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = stripParenExpression(producedValue.binding);
  if (!isNodeOfType(binding, "Identifier")) return true;
  const symbol = scopes.symbolFor(binding);
  if (!symbol) return false;
  return !symbol.references.some(
    (reference) =>
      (reference.flag !== "read" || identifierIsWithinAssignmentTarget(reference.identifier)) &&
      reference.identifier.range[0] > producedValue.acquiredAt &&
      reference.identifier.range[0] < consumer.range[0],
  );
};

const bindingValueRemainsCurrentAtConsumer = (
  producedValue: ProducedValueBinding,
  resultCall: EsTreeNode,
  consumer: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!bindingValueHasNoWritesBefore(producedValue, consumer, scopes)) return false;
  let current = resultCall.parent ?? null;
  while (current) {
    if (LOOP_STATEMENT_TYPES.has(current.type) && !isAstDescendant(consumer, current)) return false;
    if (FUNCTION_LIKE_TYPES.has(current.type) || isNodeOfType(current, "Program")) break;
    current = current.parent ?? null;
  }
  return true;
};

const collectProvenValueBindings = (
  binding: EsTreeNode,
  acquiredAt: number,
  scopes: ScopeAnalysis,
  bindings: ProducedValueBinding[],
  visitedSymbolIds = new Set<number>(),
): void => {
  const symbol = scopes.symbolFor(binding);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return;
  visitedSymbolIds.add(symbol.id);
  const producedValue = { acquiredAt, binding };
  bindings.push(producedValue);
  for (const reference of symbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const consumer = referenceRoot.parent;
    if (
      isNodeOfType(consumer, "VariableDeclarator") &&
      consumer.init === referenceRoot &&
      isNodeOfType(consumer.id, "Identifier") &&
      consumer.parent &&
      isNodeOfType(consumer.parent, "VariableDeclaration") &&
      consumer.parent.kind === "const" &&
      reference.identifier.range[0] > acquiredAt &&
      bindingValueHasNoWritesBefore(producedValue, consumer, scopes)
    ) {
      collectProvenValueBindings(
        consumer.id,
        consumer.range[1],
        scopes,
        bindings,
        visitedSymbolIds,
      );
    }
  }
};

const findControlTransferTarget = (
  transfer: EsTreeNodeOfType<"BreakStatement"> | EsTreeNodeOfType<"ContinueStatement">,
): EsTreeNode | null => {
  const labelName = transfer.label?.name ?? null;
  let current = transfer.parent ?? null;
  while (current) {
    if (
      labelName !== null &&
      isNodeOfType(current, "LabeledStatement") &&
      current.label.name === labelName
    ) {
      return current;
    }
    if (
      labelName === null &&
      (LOOP_STATEMENT_TYPES.has(current.type) ||
        (isNodeOfType(transfer, "BreakStatement") && isNodeOfType(current, "SwitchStatement")))
    ) {
      return current;
    }
    if (FUNCTION_LIKE_TYPES.has(current.type) || isNodeOfType(current, "Program")) break;
    current = current.parent ?? null;
  }
  return null;
};

const throwIsCaughtWithinStatement = (
  throwStatement: EsTreeNodeOfType<"ThrowStatement">,
  statement: EsTreeNode,
): boolean => {
  let current = throwStatement.parent ?? null;
  while (current) {
    if (
      isNodeOfType(current, "TryStatement") &&
      current.handler &&
      isAstDescendant(throwStatement, current.block)
    ) {
      return current === statement || isAstDescendant(current, statement);
    }
    if (FUNCTION_LIKE_TYPES.has(current.type) || isNodeOfType(current, "Program")) break;
    current = current.parent ?? null;
  }
  return false;
};

const statementCanBypassFollowingSibling = (statement: EsTreeNode): boolean => {
  let canBypass = false;
  walkAst(statement, (child) => {
    if (canBypass) return false;
    if (child !== statement && FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      canBypass = true;
      return false;
    }
    if (isNodeOfType(child, "ThrowStatement")) {
      canBypass = !throwIsCaughtWithinStatement(child, statement);
      return !canBypass;
    }
    if (isNodeOfType(child, "BreakStatement") || isNodeOfType(child, "ContinueStatement")) {
      const target = findControlTransferTarget(child);
      canBypass = Boolean(!target || (target !== statement && !isAstDescendant(target, statement)));
      return !canBypass;
    }
  });
  return canBypass;
};

const statementAlwaysRevokesResult = (
  statement: EsTreeNode,
  resultExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    for (const child of statement.body) {
      if (statementAlwaysRevokesResult(child, resultExpression, scopes)) return true;
      if (statementAlwaysExits(child) || statementCanBypassFollowingSibling(child)) return false;
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
  if (isNodeOfType(statement, "SwitchStatement")) {
    if (!statement.cases.some((switchCase) => switchCase.test === null)) return false;
    return statement.cases.every((_, caseIndex) => {
      for (const switchCase of statement.cases.slice(caseIndex)) {
        for (const child of switchCase.consequent) {
          if (statementAlwaysRevokesResult(child, resultExpression, scopes)) return true;
          if (statementAlwaysExits(child) || statementCanBypassFollowingSibling(child)) {
            return false;
          }
        }
      }
      return false;
    });
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  return (
    isNodeOfType(expression, "CallExpression") &&
    isRevokeOfProducedBinding(expression, resultExpression, scopes)
  );
};

const boundaryHasExhaustiveDisposal = (
  resultCall: EsTreeNode,
  producedValues: readonly ProducedValueBinding[],
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!executionBoundary) return false;
  let didFindExhaustiveDisposal = false;
  walkAst(executionBoundary, (child) => {
    if (child !== executionBoundary && FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (
      (isNodeOfType(child, "IfStatement") || isNodeOfType(child, "SwitchStatement")) &&
      child.range[0] > resultCall.range[1] &&
      isNodeReachableWithinFunction(child, context) &&
      producedValues.some(
        (producedValue) =>
          bindingValueRemainsCurrentAtConsumer(producedValue, resultCall, child, context.scopes) &&
          consumerIsGuaranteedAfterResult(
            child,
            resultCall,
            producedValue,
            executionBoundary,
            context,
          ) &&
          statementAlwaysRevokesResult(child, producedValue.binding, context.scopes),
      )
    ) {
      didFindExhaustiveDisposal = true;
      return false;
    }
  });
  return didFindExhaustiveDisposal;
};

const isGuaranteedScheduledRevoke = (
  revokeCall: EsTreeNodeOfType<"CallExpression">,
  createCall: EsTreeNodeOfType<"CallExpression">,
  producedValue: ProducedValueBinding,
  executionBoundary: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const callback = findEnclosingFunction(revokeCall);
  if (!callback || callback === executionBoundary) return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  const schedulerCall = callbackRoot.parent;
  if (
    !isNodeOfType(schedulerCall, "CallExpression") ||
    schedulerCall.arguments[0] !== callbackRoot ||
    !isNodeOfType(schedulerCall.parent, "ExpressionStatement")
  ) {
    return false;
  }
  const scheduler = stripParenExpression(schedulerCall.callee);
  if (
    !isNodeOfType(scheduler, "Identifier") ||
    (scheduler.name !== "queueMicrotask" && scheduler.name !== "setTimeout") ||
    !isProvenGlobalNamespaceReference(scheduler, scheduler.name, context.scopes)
  ) {
    return false;
  }
  return (
    context.cfg.enclosingFunction(schedulerCall) === executionBoundary &&
    context.cfg.isUnconditionalFromEntry(revokeCall) &&
    isNodeReachableWithinFunction(revokeCall, context) &&
    bindingValueRemainsCurrentAtConsumer(
      producedValue,
      createCall,
      schedulerCall,
      context.scopes,
    ) &&
    consumerIsGuaranteedAfterResult(
      schedulerCall,
      createCall,
      producedValue,
      executionBoundary,
      context,
    )
  );
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
  const valueBindings: ProducedValueBinding[] = [];
  collectProvenValueBindings(resultExpression, createCall.range[1], context.scopes, valueBindings);
  const didFindGuaranteedRevoke = valueBindings.some((producedValue) => {
    const bindingSymbol = context.scopes.symbolFor(producedValue.binding);
    return bindingSymbol?.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const consumer = referenceRoot.parent;
      return Boolean(
        consumer &&
        isNodeOfType(consumer, "CallExpression") &&
        isRevokeOfProducedBinding(consumer, producedValue.binding, context.scopes) &&
        bindingValueRemainsCurrentAtConsumer(producedValue, createCall, consumer, context.scopes) &&
        isNodeReachableWithinFunction(consumer, context) &&
        (consumerIsGuaranteedAfterResult(
          consumer,
          createCall,
          producedValue,
          executionBoundary,
          context,
        ) ||
          isGuaranteedScheduledRevoke(
            consumer,
            createCall,
            producedValue,
            executionBoundary,
            context,
          )),
      );
    });
  });
  return (
    didFindGuaranteedRevoke ||
    boundaryHasExhaustiveDisposal(createCall, valueBindings, executionBoundary, context)
  );
};

interface ProgramDisposalIndex {
  readonly cacheEvictionsBySymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
  readonly cacheStoresByRetainedSymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
  readonly callsByInitializer: Map<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>;
  readonly callExpressions: EsTreeNodeOfType<"CallExpression">[];
  readonly forOfStatements: EsTreeNodeOfType<"ForOfStatement">[];
  readonly revokeCallsByArgumentSymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
}

const buildProgramDisposalIndex = (
  programRoot: EsTreeNode,
  context: RuleContext,
): ProgramDisposalIndex => {
  const { scopes } = context;
  const index: ProgramDisposalIndex = {
    cacheEvictionsBySymbolId: new Map(),
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
    const resolvedInitializer = resolveStaticLocalCallFunction(child, scopes);
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

const isPropertyPathPrefix = (
  prefix: readonly string[],
  propertyPath: readonly string[],
): boolean => prefix.every((propertyName, index) => propertyPath[index] === propertyName);

const getPatternPropertyName = (property: EsTreeNodeOfType<"Property">): string | null => {
  return getStaticPropertyKeyName(property, { allowComputedString: true });
};

const collectBindingPathAliasesFromPattern = (
  pattern: EsTreeNode,
  targetPath: readonly string[],
  patternPath: readonly string[],
  aliases: BindingPathAlias[],
): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    if (isPropertyPathPrefix(patternPath, targetPath)) {
      aliases.push({ binding: pattern, propertyPath: targetPath.slice(patternPath.length) });
    }
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectBindingPathAliasesFromPattern(pattern.left, targetPath, patternPath, aliases);
    return;
  }
  if (!isNodeOfType(pattern, "ObjectPattern")) return;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getPatternPropertyName(property);
    if (!propertyName) continue;
    collectBindingPathAliasesFromPattern(
      property.value,
      targetPath,
      [...patternPath, propertyName],
      aliases,
    );
  }
};

const bindingPathIsRevokedBefore = (
  currentValue: ProducedValueBinding,
  guardedValue: ProducedValueBinding,
  resultCall: EsTreeNodeOfType<"CallExpression">,
  beforeNode: EsTreeNode,
  propertyPath: readonly string[],
  context: RuleContext,
  visitedStates: Set<string>,
): boolean => {
  const symbol = context.scopes.symbolFor(currentValue.binding);
  if (!symbol) return false;
  const stateKey = `${symbol.id}:${JSON.stringify(propertyPath)}`;
  if (visitedStates.has(stateKey)) return false;
  visitedStates.add(stateKey);
  const executionBoundary = context.cfg.enclosingFunction(resultCall);
  return symbol.references.some((reference) => {
    if (reference.identifier.range[0] <= currentValue.acquiredAt) return false;
    let candidate = findTransparentExpressionRoot(reference.identifier);
    let consumedPathLength = 0;
    while (consumedPathLength < propertyPath.length) {
      const member = candidate.parent;
      if (
        !member ||
        !isNodeOfType(member, "MemberExpression") ||
        stripParenExpression(member.object) !== stripParenExpression(candidate) ||
        getStaticPropertyName(member) !== propertyPath[consumedPathLength]
      ) {
        break;
      }
      consumedPathLength++;
      candidate = findTransparentExpressionRoot(member);
    }
    const remainingPath = propertyPath.slice(consumedPathLength);
    const consumer = candidate.parent;
    if (
      remainingPath.length === 0 &&
      consumer &&
      isNodeOfType(consumer, "CallExpression") &&
      consumer.range[0] < beforeNode.range[0] &&
      isUrlMethodCall(consumer, "revokeObjectURL", context.scopes) &&
      isAstNode(consumer.arguments[0]) &&
      stripParenExpression(consumer.arguments[0]) === stripParenExpression(candidate) &&
      bindingValueRemainsCurrentAtConsumer(currentValue, resultCall, consumer, context.scopes) &&
      isNodeReachableWithinFunction(consumer, context) &&
      consumerIsGuaranteedAfterResult(
        consumer,
        resultCall,
        guardedValue,
        executionBoundary,
        context,
      )
    ) {
      return true;
    }
    if (
      !consumer ||
      !isNodeOfType(consumer, "VariableDeclarator") ||
      consumer.init !== candidate ||
      !consumer.parent ||
      !isNodeOfType(consumer.parent, "VariableDeclaration") ||
      consumer.parent.kind !== "const" ||
      !bindingValueRemainsCurrentAtConsumer(currentValue, resultCall, consumer, context.scopes)
    ) {
      return false;
    }
    const aliases: BindingPathAlias[] = [];
    collectBindingPathAliasesFromPattern(consumer.id, remainingPath, [], aliases);
    return aliases.some((alias) =>
      bindingPathIsRevokedBefore(
        { acquiredAt: consumer.range[1], binding: alias.binding },
        guardedValue,
        resultCall,
        beforeNode,
        alias.propertyPath,
        context,
        visitedStates,
      ),
    );
  });
};

const boundResultIsRevokedBefore = (
  resultCall: EsTreeNodeOfType<"CallExpression">,
  beforeNode: EsTreeNode,
  context: RuleContext,
  propertyPath: readonly string[] = [],
): boolean => {
  const resultExpression = findBoundCallResult(resultCall);
  if (!resultExpression) return false;
  const executionBoundary = context.cfg.enclosingFunction(resultCall);
  if (context.cfg.enclosingFunction(beforeNode) !== executionBoundary) return false;
  const producedValue = { acquiredAt: resultCall.range[1], binding: resultExpression };
  return bindingPathIsRevokedBefore(
    producedValue,
    producedValue,
    resultCall,
    beforeNode,
    propertyPath,
    context,
    new Set(),
  );
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
  propertyPath: readonly string[] = [],
): boolean =>
  index.callExpressions.some(
    (call) =>
      call.range[0] < beforeNode.range[0] &&
      cacheGetMatchesKey(call, cacheSymbolId, keyExpression, context.scopes) &&
      boundResultIsRevokedBefore(call, beforeNode, context, propertyPath),
  );

const expressionMatchesBindingPath = (
  expression: EsTreeNode,
  binding: EsTreeNode,
  propertyPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = stripParenExpression(expression);
  const observedPath: string[] = [];
  while (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    if (!propertyName) return false;
    observedPath.unshift(propertyName);
    candidate = stripParenExpression(candidate.object);
  }
  return (
    observedPath.length === propertyPath.length &&
    observedPath.every((propertyName, index) => propertyName === propertyPath[index]) &&
    expressionsReferToSameValue(candidate, binding, scopes)
  );
};

const statementAlwaysRevokesBindingPath = (
  statement: EsTreeNode,
  binding: EsTreeNode,
  propertyPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    for (const child of statement.body) {
      if (statementAlwaysRevokesBindingPath(child, binding, propertyPath, scopes)) return true;
      if (statementAlwaysExits(child) || statementCanBypassFollowingSibling(child)) return false;
    }
    return false;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return Boolean(
      statement.alternate &&
      statementAlwaysRevokesBindingPath(statement.consequent, binding, propertyPath, scopes) &&
      statementAlwaysRevokesBindingPath(statement.alternate, binding, propertyPath, scopes),
    );
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  const revokedExpression = isNodeOfType(expression, "CallExpression")
    ? expression.arguments[0]
    : null;
  return Boolean(
    isNodeOfType(expression, "CallExpression") &&
    isUrlMethodCall(expression, "revokeObjectURL", scopes) &&
    isAstNode(revokedExpression) &&
    expressionMatchesBindingPath(revokedExpression, binding, propertyPath, scopes),
  );
};

const callbackAlwaysRevokesRetention = (
  callback: EsTreeNode,
  retention: CacheRetention,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(callback);
  if (
    !isNodeOfType(candidate, "ArrowFunctionExpression") &&
    !isNodeOfType(candidate, "FunctionExpression")
  ) {
    return false;
  }
  const parameterIndex = retention.kind === "map-key" ? 1 : 0;
  const parameter = candidate.params[parameterIndex];
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const body = stripParenExpression(candidate.body);
  const revokedExpression = isNodeOfType(body, "CallExpression") ? body.arguments[0] : null;
  if (
    isNodeOfType(body, "CallExpression") &&
    isUrlMethodCall(body, "revokeObjectURL", scopes) &&
    isAstNode(revokedExpression)
  ) {
    return expressionMatchesBindingPath(
      revokedExpression,
      parameter,
      retention.propertyPath,
      scopes,
    );
  }
  return statementAlwaysRevokesBindingPath(body, parameter, retention.propertyPath, scopes);
};

const expressionIsRevokedBefore = (
  expression: EsTreeNode,
  beforeNode: EsTreeNode,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const executionBoundary = context.cfg.enclosingFunction(beforeNode);
  return index.callExpressions.some(
    (call) =>
      call.range[0] < beforeNode.range[0] &&
      context.cfg.enclosingFunction(call) === executionBoundary &&
      context.cfg.isUnconditionalFromEntry(call) &&
      isRevokeOfExpression(call, expression, context.scopes),
  );
};

const cacheClearIsSafe = (
  clearCall: EsTreeNodeOfType<"CallExpression">,
  store: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  retention: CacheRetention,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const executionBoundary = context.cfg.enclosingFunction(clearCall);
  const hasForEachProtocol = index.callExpressions.some((call) => {
    if (
      call.range[0] <= store.range[1] ||
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
      callbackAlwaysRevokesRetention(callback, retention, context.scopes) &&
      context.cfg.isUnconditionalFromEntry(call),
    );
  });
  if (hasForEachProtocol) return true;
  return index.forOfStatements.some((loop) => {
    if (
      loop.range[0] <= store.range[1] ||
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
    const expectedIterationMethod = retention.kind === "map-key" ? "keys" : "values";
    return Boolean(
      isNodeOfType(valuesCallee, "MemberExpression") &&
      getStaticPropertyName(valuesCallee) === expectedIterationMethod &&
      getModuleScopeCacheSymbolId(valuesCallee.object, context.scopes) === cacheSymbolId &&
      retention.propertyPath.length === 0 &&
      statementAlwaysRevokesResult(loop.body, declaration.id, context.scopes),
    );
  });
};

const cacheEvictionIsSafe = (
  eviction: EsTreeNodeOfType<"CallExpression">,
  store: EsTreeNodeOfType<"CallExpression">,
  cacheSymbolId: number,
  retention: CacheRetention,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(eviction.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (methodName === "clear") {
    return cacheClearIsSafe(eviction, store, cacheSymbolId, retention, index, context);
  }
  const keyExpression = eviction.arguments[0];
  if (retention.kind === "set-element" || retention.kind === "map-key") {
    return Boolean(
      methodName === "delete" &&
      isAstNode(keyExpression) &&
      expressionIsRevokedBefore(keyExpression, eviction, index, context),
    );
  }
  if (retention.kind !== "map-value") return false;
  return Boolean(
    methodName === "delete" &&
    isAstNode(keyExpression) &&
    cacheKeyIsRevokedBefore(
      cacheSymbolId,
      keyExpression,
      eviction,
      index,
      context,
      retention.propertyPath,
    ),
  );
};

const cacheStoreHasSafeOwnership = (
  store: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  cacheSymbolId: number,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const retention = getCacheRetention(store, expression, context.scopes);
  if (!retention) return false;
  const evictions = index.cacheEvictionsBySymbolId.get(cacheSymbolId) ?? [];
  if (
    !evictions.every((eviction) =>
      cacheEvictionIsSafe(eviction, store, cacheSymbolId, retention, index, context),
    )
  ) {
    return false;
  }
  const callee = stripParenExpression(store.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "set") {
    return true;
  }
  const keyExpression = store.arguments[0];
  if (!isAstNode(keyExpression)) return true;
  if (retention.kind === "map-key") return true;
  const executionBoundary = context.cfg.enclosingFunction(store);
  if (isNodeOfType(executionBoundary, "Program")) return true;
  return cacheKeyIsRevokedBefore(
    cacheSymbolId,
    keyExpression,
    store,
    index,
    context,
    retention.propertyPath,
  );
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
    const producedValues: ProducedValueBinding[] = [];
    const resultCandidate = stripParenExpression(resultExpression);
    if (isNodeOfType(resultCandidate, "Identifier") && scopes.symbolFor(resultCandidate)) {
      collectProvenValueBindings(resultCandidate, child.range[1], scopes, producedValues);
    } else {
      producedValues.push({ acquiredAt: child.range[1], binding: resultExpression });
    }
    for (const producedValue of producedValues) {
      if (didDisposeResult) break;
      const producedSymbol = scopes.symbolFor(producedValue.binding);
      const candidateConsumers = producedSymbol
        ? [
            ...(index.cacheStoresByRetainedSymbolId.get(producedSymbol.id) ?? []),
            ...(index.revokeCallsByArgumentSymbolId.get(producedSymbol.id) ?? []),
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
          bindingValueRemainsCurrentAtConsumer(producedValue, child, candidate, scopes) &&
          consumerIsGuaranteedAfterResult(
            candidate,
            child,
            producedValue,
            executionBoundary,
            context,
          )
        ) {
          if (isRevokeOfProducedBinding(candidate, producedValue.binding, scopes)) {
            didDisposeResult = true;
            continue;
          }
          if (!isCacheStoreOfExpression(candidate, producedValue.binding, scopes)) continue;
          const candidateCallee = stripParenExpression(candidate.callee);
          if (isNodeOfType(candidateCallee, "MemberExpression")) {
            const cacheSymbolId = getModuleScopeCacheSymbolId(candidateCallee.object, scopes);
            didDisposeResult =
              cacheSymbolId !== null &&
              cacheStoreHasSafeOwnership(
                candidate,
                producedValue.binding,
                cacheSymbolId,
                index,
                context,
              );
          }
        }
      }
    }
    if (
      !didDisposeResult &&
      boundaryHasExhaustiveDisposal(child, producedValues, executionBoundary, context)
    ) {
      didDisposeResult = true;
    }
    if (!didDisposeResult) {
      didFindUndisposedCall = true;
    }
  }
  return didFindCall && !didFindUndisposedCall;
};

const directCacheStoreHasSafeOwnership = (
  createCall: EsTreeNode,
  index: ProgramDisposalIndex,
  context: RuleContext,
): boolean => {
  const storedExpression = analyzeContainingExpression(createCall).expressionRoot;
  const store = storedExpression.parent;
  if (
    !store ||
    !isNodeOfType(store, "CallExpression") ||
    !isCacheStoreOfExpression(store, storedExpression, context.scopes)
  ) {
    return false;
  }
  const callee = stripParenExpression(store.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const cacheSymbolId = getModuleScopeCacheSymbolId(callee.object, context.scopes);
  return (
    cacheSymbolId !== null &&
    cacheStoreHasSafeOwnership(store, storedExpression, cacheSymbolId, index, context)
  );
};

const isStateSetterCallee = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(callee);
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      isStateSetterCallee(candidate.consequent, scopes, new Set(visitedSymbolIds)) &&
      isStateSetterCallee(candidate.alternate, scopes, new Set(visitedSymbolIds))
    );
  }
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
  if (isNodeOfType(candidate, "TemplateLiteral") && candidate.expressions.length === 0) {
    return candidate.quasis[0]?.value.cooked ?? candidate.quasis[0]?.value.raw ?? null;
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

const getResolvedMemberPropertyName = (
  member: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): string | null =>
  getStaticPropertyName(member) ??
  (member.computed && isAstNode(member.property)
    ? resolveStaticString(member.property, scopes)
    : null);

const isUrlSetAttributeCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  urlArgument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getResolvedMemberPropertyName(callee, scopes);
  if (methodName !== "setAttribute") return false;
  const [attributeName, attributeValue] = call.arguments;
  if (!isAstNode(attributeName) || !isAstNode(attributeValue)) return false;
  const resolvedAttributeName = resolveStaticString(attributeName, scopes);
  if (!resolvedAttributeName || !SET_ATTRIBUTE_URL_NAMES.has(resolvedAttributeName)) return false;
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
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(
        getResolvedMemberPropertyName(consumer.left, context.scopes) ?? "",
      )
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
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(
        getResolvedMemberPropertyName(target, context.scopes) ?? "",
      )
    ) {
      return true;
    }
    // The guarded creation assigned to a pre-declared variable is the same
    // "object URL for fetched data" leak as the guarded VariableDeclarator.
    if (isNodeOfType(target, "Identifier")) {
      return storedResultIsGuarded || boundValueHasHardEscape(target, context);
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
    if (isCacheStoreOfExpression(parent, topNode, context.scopes)) return true;
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
          if (directCacheStoreHasSafeOwnership(node, programDisposalIndex, context)) return;
          if (moduleDisposesEveryReturnedResult(node, programDisposalIndex, context)) return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
