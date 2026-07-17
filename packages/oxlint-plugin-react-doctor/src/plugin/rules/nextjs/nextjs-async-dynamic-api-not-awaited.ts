import { PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";

const DYNAMIC_API_NAMES: ReadonlySet<string> = new Set(["cookies", "headers", "draftMode"]);
const UNSAFE_UNWRAPPED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "UnsafeUnwrappedCookies",
  "UnsafeUnwrappedHeaders",
  "UnsafeUnwrappedDraftMode",
]);
const OBJECT_ENUMERATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "entries",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "keys",
  "values",
]);
const ITERABLE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
]);

const MESSAGE =
  "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.";

interface PendingSymbolCandidate {
  sourceExpression: EsTreeNode;
  symbol: SymbolDescriptor;
}

interface PendingSymbolFlow {
  isClearedBefore: (referenceIdentifier: EsTreeNode) => boolean;
}

const resolvesToImportBinding = (context: RuleContext, identifier: EsTreeNode): boolean => {
  const referenceSymbol = context.scopes.symbolFor(identifier);
  if (referenceSymbol) return referenceSymbol.kind === "import";
  if (!isNodeOfType(identifier, "Identifier")) return false;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(identifier);
  while (scope) {
    const lexicalSymbol = scope.symbolsByName.get(identifier.name);
    if (lexicalSymbol) return lexicalSymbol.kind === "import";
    scope = scope.parent;
  }
  return false;
};

const isNextHeadersDynamicCall = (context: RuleContext, expression: EsTreeNode): boolean => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (!resolvesToImportBinding(context, callee)) return false;
    const importedName = getImportedNameFromModule(node, callee.name, "next/headers");
    return importedName !== null && DYNAMIC_API_NAMES.has(importedName);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const namespaceObject = stripParenExpression(callee.object);
  const memberName = getStaticPropertyName(callee);
  if (
    !isNodeOfType(namespaceObject, "Identifier") ||
    memberName === null ||
    !DYNAMIC_API_NAMES.has(memberName) ||
    !resolvesToImportBinding(context, namespaceObject)
  ) {
    return false;
  }
  return isNamespaceImportFromModule(node, namespaceObject.name, "next/headers");
};

const isUnsafeUnwrappedType = (context: RuleContext, typeNode: EsTreeNode): boolean => {
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (isNodeOfType(typeName, "Identifier")) {
    if (!resolvesToImportBinding(context, typeName)) return false;
    const importedName = getImportedNameFromModule(typeNode, typeName.name, "next/headers");
    return importedName !== null && UNSAFE_UNWRAPPED_TYPE_NAMES.has(importedName);
  }
  if (
    !isNodeOfType(typeName, "TSQualifiedName") ||
    !isNodeOfType(typeName.left, "Identifier") ||
    !isNodeOfType(typeName.right, "Identifier") ||
    !UNSAFE_UNWRAPPED_TYPE_NAMES.has(typeName.right.name) ||
    !resolvesToImportBinding(context, typeName.left)
  ) {
    return false;
  }
  return isNamespaceImportFromModule(typeNode, typeName.left.name, "next/headers");
};

const castChainAssertsUnsafeUnwrapped = (context: RuleContext, expression: EsTreeNode): boolean => {
  let current: EsTreeNode | null = expression;
  while (current) {
    if (
      (isNodeOfType(current, "TSAsExpression") || isNodeOfType(current, "TSTypeAssertion")) &&
      isUnsafeUnwrappedType(context, current.typeAnnotation)
    ) {
      return true;
    }
    if (
      !TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(current.type) ||
      !("expression" in current) ||
      !isAstNode(current.expression)
    ) {
      return false;
    }
    current = current.expression;
  }
  return false;
};

const isPromiseSettleAccess = (memberExpression: EsTreeNodeOfType<"MemberExpression">): boolean => {
  const propertyName = getStaticPropertyName(memberExpression);
  return propertyName !== null && PROMISE_SETTLE_METHODS.has(propertyName);
};

interface StaticLogicalValue {
  isNullish: boolean;
  isTruthy: boolean;
}

const getStaticLogicalValue = (expression: EsTreeNode): StaticLogicalValue | null => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "Literal")) return null;
  return { isNullish: node.value === null, isTruthy: Boolean(node.value) };
};

const logicalRightCanBecomeResult = (
  operator: EsTreeNodeOfType<"LogicalExpression">["operator"],
  leftValue: StaticLogicalValue,
): boolean => {
  if (operator === "&&") return leftValue.isTruthy;
  if (operator === "||") return !leftValue.isTruthy;
  return leftValue.isNullish;
};

const findPendingDynamicApiSource = (
  context: RuleContext,
  expression: EsTreeNode,
): EsTreeNode | null => {
  if (castChainAssertsUnsafeUnwrapped(context, expression)) return null;
  const pendingExpressions: EsTreeNode[] = [expression];
  while (pendingExpressions.length > 0) {
    const currentExpression = pendingExpressions.pop();
    if (!currentExpression) continue;
    const node = stripParenExpression(currentExpression);
    if (isNextHeadersDynamicCall(context, node)) return node;
    if (isNodeOfType(node, "ConditionalExpression")) {
      const staticTestValue = getStaticLogicalValue(node.test);
      if (staticTestValue) {
        pendingExpressions.push(staticTestValue.isTruthy ? node.consequent : node.alternate);
        continue;
      }
      pendingExpressions.push(node.consequent, node.alternate);
      continue;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
      const leftSource = findPendingDynamicApiSource(context, node.left);
      if (leftSource) {
        if (node.operator !== "&&") return leftSource;
        pendingExpressions.push(node.right);
        continue;
      }
      const staticLeftValue = getStaticLogicalValue(node.left);
      if (staticLeftValue) {
        pendingExpressions.push(
          logicalRightCanBecomeResult(node.operator, staticLeftValue) ? node.right : node.left,
        );
        continue;
      }
      pendingExpressions.push(node.left, node.right);
      continue;
    }
    if (isNodeOfType(node, "SequenceExpression")) {
      const finalExpression = node.expressions.at(-1);
      if (finalExpression) pendingExpressions.push(finalExpression);
      continue;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      pendingExpressions.push(node.right);
      continue;
    }
    if (!isNodeOfType(node, "CallExpression")) continue;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "MemberExpression") && isPromiseSettleAccess(callee)) {
      pendingExpressions.push(callee.object);
    }
  }
  return null;
};

const patternReadsDynamicApiValue = (pattern: EsTreeNode): boolean => {
  if (isNodeOfType(pattern, "ArrayPattern")) return true;
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return pattern.properties.some(
    (property) =>
      isNodeOfType(property, "RestElement") ||
      (isNodeOfType(property, "Property") &&
        !PROMISE_SETTLE_METHODS.has(
          getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
        )),
  );
};

const isObjectDestructureOfExpression = (parent: EsTreeNode, expression: EsTreeNode): boolean => {
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expression &&
    (isNodeOfType(parent.id, "ObjectPattern") || isNodeOfType(parent.id, "ArrayPattern"))
  ) {
    return patternReadsDynamicApiValue(parent.id);
  }
  return (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === expression &&
    (isNodeOfType(parent.left, "ObjectPattern") || isNodeOfType(parent.left, "ArrayPattern")) &&
    patternReadsDynamicApiValue(parent.left)
  );
};

const expressionMayRetainPendingSymbol = (
  context: RuleContext,
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
): boolean => {
  if (castChainAssertsUnsafeUnwrapped(context, expression)) return false;
  const pendingExpressions: EsTreeNode[] = [expression];
  while (pendingExpressions.length > 0) {
    const currentExpression = pendingExpressions.pop();
    if (!currentExpression) continue;
    const node = stripParenExpression(currentExpression);
    if (isNodeOfType(node, "Identifier")) {
      if (context.scopes.symbolFor(node)?.id === symbol.id) return true;
      continue;
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      const staticTestValue = getStaticLogicalValue(node.test);
      if (staticTestValue) {
        pendingExpressions.push(staticTestValue.isTruthy ? node.consequent : node.alternate);
        continue;
      }
      pendingExpressions.push(node.consequent, node.alternate);
      continue;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
      const leftMayRetain = expressionMayRetainPendingSymbol(context, node.left, symbol);
      if (leftMayRetain) {
        if (node.operator !== "&&") return true;
        pendingExpressions.push(node.right);
        continue;
      }
      const staticLeftValue = getStaticLogicalValue(node.left);
      if (staticLeftValue) {
        pendingExpressions.push(
          logicalRightCanBecomeResult(node.operator, staticLeftValue) ? node.right : node.left,
        );
        continue;
      }
      pendingExpressions.push(node.left, node.right);
      continue;
    }
    if (isNodeOfType(node, "SequenceExpression")) {
      const finalExpression = node.expressions.at(-1);
      if (finalExpression) pendingExpressions.push(finalExpression);
      continue;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      pendingExpressions.push(node.right);
      continue;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "MemberExpression") && isPromiseSettleAccess(callee)) {
        pendingExpressions.push(callee.object);
      }
    }
  }
  return false;
};

const isGlobalEnumerationCallForArgument = (
  context: RuleContext,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  argumentExpression: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || !context.scopes.isGlobalReference(receiver)) {
    return false;
  }
  const methodName = getStaticPropertyName(callee);
  if (receiver.name === "Array") {
    return methodName === "from" && callExpression.arguments[0] === argumentExpression;
  }
  if (receiver.name === "Reflect") {
    return methodName === "ownKeys" && callExpression.arguments[0] === argumentExpression;
  }
  return (
    receiver.name === "Object" &&
    methodName !== null &&
    ((OBJECT_ENUMERATION_METHOD_NAMES.has(methodName) &&
      callExpression.arguments[0] === argumentExpression) ||
      (methodName === "fromEntries" && callExpression.arguments[0] === argumentExpression) ||
      (methodName === "assign" &&
        callExpression.arguments.slice(1).some((argument) => argument === argumentExpression)))
  );
};

const isGlobalIterableConstructorForArgument = (
  context: RuleContext,
  newExpression: EsTreeNodeOfType<"NewExpression">,
  argumentExpression: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(newExpression.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    ITERABLE_CONSTRUCTOR_NAMES.has(callee.name) &&
    context.scopes.isGlobalReference(callee) &&
    newExpression.arguments[0] === argumentExpression
  );
};

const isPromiseSettlementCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  calleeRoot: EsTreeNode,
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): boolean => callExpression.callee === calleeRoot && isPromiseSettleAccess(memberExpression);

const expressionIsSynchronouslyConsumed = (
  context: RuleContext,
  expression: EsTreeNode,
): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === current) {
      if (!isPromiseSettleAccess(parent)) return true;
      const memberRoot = findTransparentExpressionRoot(parent);
      const call = memberRoot.parent;
      if (
        !call ||
        !isNodeOfType(call, "CallExpression") ||
        !isPromiseSettlementCall(call, memberRoot, parent)
      ) {
        return false;
      }
      current = findTransparentExpressionRoot(call);
      continue;
    }
    if (isNodeOfType(parent, "SpreadElement") && parent.argument === current) return true;
    if (
      (isNodeOfType(parent, "ForOfStatement") || isNodeOfType(parent, "ForInStatement")) &&
      parent.right === current
    ) {
      return true;
    }
    if (isNodeOfType(parent, "YieldExpression") && parent.delegate && parent.argument === current) {
      return true;
    }
    if (isObjectDestructureOfExpression(parent, current)) return true;
    if (isNodeOfType(parent, "CallExpression")) {
      return isGlobalEnumerationCallForArgument(context, parent, current);
    }
    if (isNodeOfType(parent, "NewExpression")) {
      return isGlobalIterableConstructorForArgument(context, parent, current);
    }
    if (isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.test === current) return false;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      if (parent.expressions.at(-1) !== current) return false;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "AssignmentExpression") && parent.right === current) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const findRetainingAliasCandidate = (
  context: RuleContext,
  referenceIdentifier: EsTreeNode,
  sourceSymbol: SymbolDescriptor,
): PendingSymbolCandidate | null => {
  let current = findTransparentExpressionRoot(referenceIdentifier);
  while (current.parent) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === current &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      if (!expressionMayRetainPendingSymbol(context, parent.init, sourceSymbol)) return null;
      const symbol = context.scopes.symbolFor(parent.id);
      return symbol ? { sourceExpression: parent.init, symbol } : null;
    }
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      parent.right === current &&
      isNodeOfType(stripParenExpression(parent.left), "Identifier")
    ) {
      if (!expressionMayRetainPendingSymbol(context, parent.right, sourceSymbol)) return null;
      const symbol = context.scopes.symbolFor(stripParenExpression(parent.left));
      return symbol ? { sourceExpression: parent.right, symbol } : null;
    }
    if (
      parent.type.endsWith("Statement") ||
      isNodeOfType(parent, "AwaitExpression") ||
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression")
    ) {
      return null;
    }
    current = findTransparentExpressionRoot(parent);
  }
  return null;
};

const getProvenanceClearingAssignment = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  writeIdentifier: EsTreeNode,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  const assignmentTarget = findTransparentExpressionRoot(writeIdentifier);
  const assignment = assignmentTarget.parent;
  if (
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== assignmentTarget ||
    expressionMayRetainPendingSymbol(context, assignment.right, symbol)
  ) {
    return null;
  }
  return assignment;
};

const isConditionallyExecutedWithinExpression = (node: EsTreeNode): boolean => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === current) return true;
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test !== current) return true;
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      (parent.operator === "&&=" || parent.operator === "||=" || parent.operator === "??=") &&
      parent.right === current
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.optional &&
      parent.arguments.some((argument) => argument === current)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.optional &&
      parent.computed &&
      parent.property === current
    ) {
      return true;
    }
    if (parent.type.endsWith("Statement") || isNodeOfType(parent, "VariableDeclarator")) {
      return false;
    }
    current = parent;
  }
  return false;
};

const getCaughtTryHandlerExitStatus = (node: EsTreeNode): boolean | null => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "TryStatement") &&
      parent.block === current &&
      parent.handler &&
      parent.handler
    ) {
      return statementAlwaysExits(parent.handler.body);
    }
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "FunctionDeclaration")
    ) {
      return null;
    }
    current = parent;
  }
  return null;
};

const isClearingWriteSkippableThroughCatch = (node: EsTreeNode): boolean =>
  getCaughtTryHandlerExitStatus(node) === false;

const isClearingWriteProtectedByExitingCatch = (node: EsTreeNode): boolean =>
  getCaughtTryHandlerExitStatus(node) === true;

const createPendingSymbolFlow = (
  context: RuleContext,
  symbol: SymbolDescriptor,
  sourceExpression: EsTreeNode,
): PendingSymbolFlow => {
  const owner = context.cfg.enclosingFunction(sourceExpression);
  const sourceStart = getNodeStartIndex(sourceExpression);
  if (sourceStart < 0) return { isClearedBefore: () => false };

  const clearingAssignments: EsTreeNodeOfType<"AssignmentExpression">[] = [];
  for (const reference of symbol.references) {
    if (reference.flag === "read") continue;
    if (context.cfg.enclosingFunction(reference.identifier) !== owner) continue;
    const assignment = getProvenanceClearingAssignment(context, symbol, reference.identifier);
    if (
      !assignment ||
      isConditionallyExecutedWithinExpression(assignment) ||
      isClearingWriteSkippableThroughCatch(assignment)
    ) {
      continue;
    }
    const assignmentStart = getNodeStartIndex(assignment);
    if (assignmentStart <= sourceStart) continue;
    clearingAssignments.push(assignment);
  }
  if (clearingAssignments.length === 0) return { isClearedBefore: () => false };

  if (!owner) {
    const unconditionalAssignmentStarts = clearingAssignments
      .filter((assignment) => context.cfg.isUnconditionalFromEntry(assignment))
      .map(getNodeStartIndex);
    return {
      isClearedBefore: (referenceIdentifier) => {
        const referenceStart = getNodeStartIndex(referenceIdentifier);
        return unconditionalAssignmentStarts.some((start) => start < referenceStart);
      },
    };
  }
  const functionCfg = context.cfg.cfgFor(owner);
  const sourceBlock = functionCfg?.blockOf(sourceExpression);
  if (!functionCfg || !sourceBlock) return { isClearedBefore: () => false };

  const clearingStartsByBlock = new Map<number, number[]>();
  for (const assignment of clearingAssignments) {
    const assignmentBlock = functionCfg.blockOf(assignment);
    if (!assignmentBlock) continue;
    const starts = clearingStartsByBlock.get(assignmentBlock.id) ?? [];
    starts.push(getNodeStartIndex(assignment));
    clearingStartsByBlock.set(assignmentBlock.id, starts);
  }

  return {
    isClearedBefore: (referenceIdentifier) => {
      if (context.cfg.enclosingFunction(referenceIdentifier) !== owner) return false;
      const referenceStart = getNodeStartIndex(referenceIdentifier);
      const referenceBlock = functionCfg.blockOf(referenceIdentifier);
      if (referenceStart < 0 || !referenceBlock) return false;
      if (
        clearingAssignments.some(
          (assignment) =>
            getNodeStartIndex(assignment) < referenceStart &&
            isClearingWriteProtectedByExitingCatch(assignment) &&
            context.cfg.isUnconditionalFromEntry(assignment),
        )
      ) {
        return true;
      }

      const everyPathHasClearingWrite = (
        block: typeof referenceBlock,
        cutoff: number,
        visitedBlockIds: Set<number>,
      ): boolean => {
        const clearingStarts = clearingStartsByBlock.get(block.id) ?? [];
        if (clearingStarts.some((start) => start < cutoff)) return true;
        if (block === sourceBlock) return false;
        if (visitedBlockIds.has(block.id)) return false;
        if (block.predecessors.length === 0) return false;
        const nextVisitedBlockIds = new Set(visitedBlockIds);
        nextVisitedBlockIds.add(block.id);
        return block.predecessors.every((edge) =>
          everyPathHasClearingWrite(edge.from, Number.POSITIVE_INFINITY, nextVisitedBlockIds),
        );
      };

      return everyPathHasClearingWrite(referenceBlock, referenceStart, new Set());
    },
  };
};

const symbolHasSynchronousAccess = (
  context: RuleContext,
  initialSymbol: SymbolDescriptor,
  initialSourceExpression: EsTreeNode,
): boolean => {
  const pendingCandidates: PendingSymbolCandidate[] = [
    { sourceExpression: initialSourceExpression, symbol: initialSymbol },
  ];
  const visitedSymbolIds = new Set<number>();

  while (pendingCandidates.length > 0) {
    const candidate = pendingCandidates.pop();
    if (!candidate || visitedSymbolIds.has(candidate.symbol.id)) continue;
    visitedSymbolIds.add(candidate.symbol.id);
    const owner = context.cfg.enclosingFunction(candidate.sourceExpression);
    const hasAnyWrite = candidate.symbol.references.some((reference) => reference.flag !== "read");
    const flow = createPendingSymbolFlow(context, candidate.symbol, candidate.sourceExpression);

    for (const reference of candidate.symbol.references) {
      if (reference.flag === "write") continue;
      if (context.cfg.enclosingFunction(reference.identifier) !== owner && hasAnyWrite) continue;
      if (flow.isClearedBefore(reference.identifier)) continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      if (expressionIsSynchronouslyConsumed(context, referenceRoot)) return true;
      const aliasCandidate = findRetainingAliasCandidate(
        context,
        reference.identifier,
        candidate.symbol,
      );
      if (aliasCandidate) pendingCandidates.push(aliasCandidate);
    }
  }
  return false;
};

const reportDirectDestructure = (
  context: RuleContext,
  expression: EsTreeNode,
  pattern: EsTreeNode,
): void => {
  if (!patternReadsDynamicApiValue(pattern)) return;
  const source = findPendingDynamicApiSource(context, expression);
  if (!source) return;
  context.report({ node: source, message: MESSAGE });
};

const reportAssignedPendingExpression = (
  context: RuleContext,
  expression: EsTreeNode,
  identifier: EsTreeNode,
): void => {
  const source = findPendingDynamicApiSource(context, expression);
  if (!source) return;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || !symbolHasSynchronousAccess(context, symbol, expression)) return;
  context.report({ node: source, message: MESSAGE });
};

const reportDirectSynchronousConsumption = (context: RuleContext, expression: EsTreeNode): void => {
  const source = findPendingDynamicApiSource(context, expression);
  if (source) context.report({ node: source, message: MESSAGE });
};

export const nextjsAsyncDynamicApiNotAwaited = defineRule({
  id: "nextjs-async-dynamic-api-not-awaited",
  title: "Un-awaited async next/headers API",
  tags: ["test-noise"],
  requires: ["nextjs:15"],
  severity: "error",
  recommendation:
    "Await `cookies()`, `headers()`, and `draftMode()` from `next/headers`, or unwrap their promises with React `use()`, before reading properties.",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const source = findPendingDynamicApiSource(context, node.object);
      if (!source) return;
      if (isPromiseSettleAccess(node)) return;
      context.report({ node: source, message: MESSAGE });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      reportDirectDestructure(context, node.init, node.id);
      if (!isNodeOfType(node.id, "Identifier")) return;
      reportAssignedPendingExpression(context, node.init, node.id);
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      reportDirectDestructure(context, node.right, node.left);
      const assignmentTarget = stripParenExpression(node.left);
      if (!isNodeOfType(assignmentTarget, "Identifier")) return;
      reportAssignedPendingExpression(context, node.right, assignmentTarget);
    },
    SpreadElement(node: EsTreeNodeOfType<"SpreadElement">) {
      reportDirectSynchronousConsumption(context, node.argument);
    },
    ForInStatement(node: EsTreeNodeOfType<"ForInStatement">) {
      reportDirectSynchronousConsumption(context, node.right);
    },
    ForOfStatement(node: EsTreeNodeOfType<"ForOfStatement">) {
      reportDirectSynchronousConsumption(context, node.right);
    },
    YieldExpression(node: EsTreeNodeOfType<"YieldExpression">) {
      if (!node.delegate || !node.argument) return;
      reportDirectSynchronousConsumption(context, node.argument);
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        if (!isGlobalEnumerationCallForArgument(context, node, argument)) continue;
        reportDirectSynchronousConsumption(context, argument);
      }
    },
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        if (!isGlobalIterableConstructorForArgument(context, node, argument)) continue;
        reportDirectSynchronousConsumption(context, argument);
      }
    },
  }),
});
