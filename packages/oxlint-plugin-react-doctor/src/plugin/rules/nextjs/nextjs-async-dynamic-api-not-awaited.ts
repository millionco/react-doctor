import { PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
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
  const symbol = context.scopes.symbolFor(identifier);
  return symbol !== null && symbol.kind === "import";
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
    const importedName = getImportedNameFromModule(typeNode, typeName.name, "next/headers");
    return importedName !== null && UNSAFE_UNWRAPPED_TYPE_NAMES.has(importedName);
  }
  if (
    !isNodeOfType(typeName, "TSQualifiedName") ||
    !isNodeOfType(typeName.left, "Identifier") ||
    !isNodeOfType(typeName.right, "Identifier") ||
    !UNSAFE_UNWRAPPED_TYPE_NAMES.has(typeName.right.name)
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

const objectPatternReadsDynamicApiValue = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean =>
  pattern.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !PROMISE_SETTLE_METHODS.has(
        getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
      ),
  );

const isObjectDestructureOfExpression = (parent: EsTreeNode, expression: EsTreeNode): boolean => {
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expression &&
    isNodeOfType(parent.id, "ObjectPattern")
  ) {
    return objectPatternReadsDynamicApiValue(parent.id);
  }
  return (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === expression &&
    isNodeOfType(parent.left, "ObjectPattern") &&
    objectPatternReadsDynamicApiValue(parent.left)
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
      pendingExpressions.push(node.consequent, node.alternate);
      continue;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
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
    }
  }
  return false;
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
    (isNextHeadersDynamicCall(context, assignment.right) &&
      !castChainAssertsUnsafeUnwrapped(context, assignment.right)) ||
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
    if (parent.type.endsWith("Statement") || isNodeOfType(parent, "VariableDeclarator")) {
      return false;
    }
    current = parent;
  }
  return false;
};

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
    if (!assignment || isConditionallyExecutedWithinExpression(assignment)) continue;
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
      const parent = referenceRoot.parent;
      if (!parent) continue;
      if (isObjectDestructureOfExpression(parent, referenceRoot)) return true;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === referenceRoot &&
        !isPromiseSettleAccess(parent)
      ) {
        return true;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier") &&
        !castChainAssertsUnsafeUnwrapped(context, parent.init)
      ) {
        const aliasSymbol = context.scopes.symbolFor(parent.id);
        if (aliasSymbol) {
          pendingCandidates.push({ sourceExpression: parent.init, symbol: aliasSymbol });
        }
      }
    }
  }
  return false;
};

const reportDirectDestructure = (
  context: RuleContext,
  expression: EsTreeNode,
  pattern: EsTreeNode,
): void => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return;
  if (!objectPatternReadsDynamicApiValue(pattern)) return;
  if (!isNextHeadersDynamicCall(context, expression)) return;
  if (castChainAssertsUnsafeUnwrapped(context, expression)) return;
  context.report({ node: stripParenExpression(expression), message: MESSAGE });
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
      if (!isNextHeadersDynamicCall(context, node.object)) return;
      if (isPromiseSettleAccess(node)) return;
      if (castChainAssertsUnsafeUnwrapped(context, node.object)) return;
      context.report({ node: stripParenExpression(node.object), message: MESSAGE });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      reportDirectDestructure(context, node.init, node.id);
      if (!isNodeOfType(node.id, "Identifier")) return;
      if (!isNextHeadersDynamicCall(context, node.init)) return;
      if (castChainAssertsUnsafeUnwrapped(context, node.init)) return;
      const symbol = context.scopes.symbolFor(node.id);
      if (!symbol) return;
      if (!symbolHasSynchronousAccess(context, symbol, node.init)) return;
      context.report({ node: stripParenExpression(node.init), message: MESSAGE });
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      reportDirectDestructure(context, node.right, node.left);
    },
  }),
});
