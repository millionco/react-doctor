import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { resolveConstIdentifierRootSymbol } from "../../utils/resolve-const-identifier-root-symbol.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "This mutates the same object React already holds and hands it back, so Object.is sees no change and skips the re-render. Copy it first and update the copy.";

const MUTATING_METHOD_NAMES = new Set([...MUTATING_ARRAY_METHODS, ...MUTATING_COLLECTION_METHODS]);

const SELF_RETURNING_METHOD_KIND = new Map([
  ["add", "set"],
  ["set", "map"],
  ["sort", "array"],
  ["reverse", "array"],
  ["fill", "array"],
  ["copyWithin", "array"],
]);

const FRESH_ARRAY_METHOD_NAMES = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "slice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const reachableBlockIdsByCfg = new WeakMap<FunctionCfg, Map<number, ReadonlySet<number>>>();

interface MutationFact {
  readonly node: EsTreeNode;
  readonly call: EsTreeNodeOfType<"CallExpression"> | null;
  readonly referenceSymbol: SymbolDescriptor;
}

const expressionBaseSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") ? context.scopes.symbolFor(current) : null;
};

const getExactObjectAssignTarget = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "assign") {
    return null;
  }
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    !context.scopes.isGlobalReference(receiver)
  ) {
    return null;
  }
  const target = call.arguments?.[0];
  return target && !isNodeOfType(target, "SpreadElement") ? target : null;
};

const nodePrecedesOnReachablePath = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
  context: RuleContext,
): boolean => {
  if (!nodesCanCoExecute(sourceNode, targetNode, context)) return false;
  const sourceBlock = functionCfg.blockOf(sourceNode);
  const targetBlock = functionCfg.blockOf(targetNode);
  if (!sourceBlock || !targetBlock) return false;
  if (sourceBlock === targetBlock) {
    return (sourceNode.range?.[0] ?? 0) < (targetNode.range?.[0] ?? 0);
  }
  const reachableBlockIdsBySource = reachableBlockIdsByCfg.get(functionCfg) ?? new Map();
  reachableBlockIdsByCfg.set(functionCfg, reachableBlockIdsBySource);
  const cachedReachableBlockIds = reachableBlockIdsBySource.get(sourceBlock.id);
  if (cachedReachableBlockIds) return cachedReachableBlockIds.has(targetBlock.id);
  const pendingBlocks = [sourceBlock];
  const visitedBlockIds = new Set([sourceBlock.id]);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (visitedBlockIds.has(edge.to.id)) continue;
      visitedBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  reachableBlockIdsBySource.set(sourceBlock.id, visitedBlockIds);
  return visitedBlockIds.has(targetBlock.id);
};

const expressionIsDefinitelyFreshReference = (
  expression: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "ArrayExpression") || isNodeOfType(value, "ObjectExpression")) {
    return true;
  }
  if (isNodeOfType(value, "NewExpression")) {
    const constructor = stripParenExpression(value.callee);
    return Boolean(
      isNodeOfType(constructor, "Identifier") &&
      ["Array", "Map", "Set", "WeakMap", "WeakSet"].includes(constructor.name) &&
      context.scopes.isGlobalReference(constructor),
    );
  }
  if (isNodeOfType(value, "Identifier")) {
    const symbol = context.scopes.symbolFor(value);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return false;
    }
    return expressionIsDefinitelyFreshReference(
      symbol.initializer,
      expectedSymbol,
      collectionKind,
      context,
      new Set([...visitedSymbolIds, symbol.id]),
    );
  }
  if (isNodeOfType(value, "ConditionalExpression")) {
    return (
      expressionIsDefinitelyFreshReference(
        value.consequent,
        expectedSymbol,
        collectionKind,
        context,
        new Set(visitedSymbolIds),
      ) &&
      expressionIsDefinitelyFreshReference(
        value.alternate,
        expectedSymbol,
        collectionKind,
        context,
        new Set(visitedSymbolIds),
      )
    );
  }
  if (!isNodeOfType(value, "CallExpression")) return false;
  const callee = stripParenExpression(value.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      (callee.name === "structuredClone" || callee.name === "Array") &&
      context.scopes.isGlobalReference(callee)
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (
    collectionKind === "array" &&
    methodName &&
    FRESH_ARRAY_METHOD_NAMES.has(methodName) &&
    expressionRootSymbol(callee.object, context)?.id === expectedSymbol.id
  ) {
    return true;
  }
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    methodName === "from" &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Array" &&
    context.scopes.isGlobalReference(receiver),
  );
};

const resolveLocalFunction = (expression: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return unwrappedExpression;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierRootSymbol(unwrappedExpression, context.scopes);
  if (!symbol) return null;
  if (isFunctionLike(symbol.declarationNode)) return symbol.declarationNode;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return initializer && isFunctionLike(initializer) ? initializer : null;
};

const expressionRootSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  let current = stripParenExpression(expression);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier")
    ? resolveConstIdentifierRootSymbol(current, context.scopes)
    : null;
};

const stateCollectionKind = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(declarator.init, "CallExpression")) return null;
  const stateType = declarator.init.typeArguments?.params[0];
  if (stateType) {
    const unwrappedStateType = stripParenExpression(stateType);
    if (
      isNodeOfType(unwrappedStateType, "TSArrayType") ||
      isNodeOfType(unwrappedStateType, "TSTupleType")
    ) {
      return "array";
    }
    if (
      isNodeOfType(unwrappedStateType, "TSTypeReference") &&
      isNodeOfType(unwrappedStateType.typeName, "Identifier")
    ) {
      if (
        unwrappedStateType.typeName.name === "Array" ||
        unwrappedStateType.typeName.name === "ReadonlyArray"
      ) {
        return "array";
      }
      if (unwrappedStateType.typeName.name === "Map") return "map";
      if (unwrappedStateType.typeName.name === "Set") return "set";
    }
  }
  const initializerArgument = declarator.init.arguments?.[0];
  if (!initializerArgument) return null;
  let initializer = stripParenExpression(initializerArgument);
  if (isFunctionLike(initializer) && !isNodeOfType(initializer.body, "BlockStatement")) {
    initializer = stripParenExpression(initializer.body);
  }
  if (isNodeOfType(initializer, "ArrayExpression")) return "array";
  if (
    !isNodeOfType(initializer, "NewExpression") ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    !context.scopes.isGlobalReference(initializer.callee)
  ) {
    return null;
  }
  if (initializer.callee.name === "Array") return "array";
  if (initializer.callee.name === "Map" || initializer.callee.name === "WeakMap") return "map";
  if (initializer.callee.name === "Set" || initializer.callee.name === "WeakSet") return "set";
  return null;
};

const isSelfReturningMutationCall = (
  expression: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression")) return false;
  const objectAssignTarget = getExactObjectAssignTarget(call, context);
  if (objectAssignTarget) {
    return expressionRootSymbol(objectAssignTarget, context)?.id === expectedSymbol.id;
  }
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    SELF_RETURNING_METHOD_KIND.get(methodName) === collectionKind &&
    expressionRootSymbol(callee.object, context)?.id === expectedSymbol.id,
  );
};

const collectMutationFacts = (
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): MutationFact[] => {
  const facts: MutationFact[] = [];
  walkAst(functionNode, (child: EsTreeNode) => {
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const objectAssignTarget = getExactObjectAssignTarget(child, context);
      if (
        objectAssignTarget &&
        expressionRootSymbol(objectAssignTarget, context)?.id === expectedSymbol.id
      ) {
        const referenceSymbol = expressionBaseSymbol(objectAssignTarget, context);
        if (referenceSymbol) {
          facts.push({ node: child, call: child, referenceSymbol });
        }
        return;
      }
      const callee = stripParenExpression(child.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const methodName = getStaticPropertyName(callee);
      if (
        !methodName ||
        !MUTATING_METHOD_NAMES.has(methodName) ||
        expressionRootSymbol(callee.object, context)?.id !== expectedSymbol.id
      ) {
        return;
      }
      if (
        collectionKind === null &&
        (!isNodeOfType(stripParenExpression(callee.object), "MemberExpression") ||
          !isResultDiscardedCall(child))
      ) {
        return;
      }
      const referenceSymbol = expressionBaseSymbol(callee.object, context);
      if (referenceSymbol) {
        facts.push({ node: child, call: child, referenceSymbol });
      }
      return;
    }
    if (isNodeOfType(child, "AssignmentExpression")) {
      const left = stripParenExpression(child.left);
      if (
        isNodeOfType(left, "MemberExpression") &&
        expressionRootSymbol(left, context)?.id === expectedSymbol.id
      ) {
        const referenceSymbol = expressionBaseSymbol(left, context);
        if (referenceSymbol) {
          facts.push({ node: child, call: null, referenceSymbol });
        }
      }
      return;
    }
    if (isNodeOfType(child, "UpdateExpression")) {
      const argument = stripParenExpression(child.argument);
      if (
        isNodeOfType(argument, "MemberExpression") &&
        expressionRootSymbol(argument, context)?.id === expectedSymbol.id
      ) {
        const referenceSymbol = expressionBaseSymbol(argument, context);
        if (referenceSymbol) {
          facts.push({ node: child, call: null, referenceSymbol });
        }
      }
      return;
    }
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "delete" &&
      isNodeOfType(stripParenExpression(child.argument), "MemberExpression") &&
      expressionRootSymbol(stripParenExpression(child.argument), context)?.id === expectedSymbol.id
    ) {
      const referenceSymbol = expressionBaseSymbol(stripParenExpression(child.argument), context);
      if (referenceSymbol) {
        facts.push({ node: child, call: null, referenceSymbol });
      }
    }
  });
  return facts;
};

const collectSameReferenceResultExpressions = (
  expression: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): EsTreeNode[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    (isNodeOfType(unwrappedExpression, "Identifier") &&
      resolveConstIdentifierRootSymbol(unwrappedExpression, context.scopes)?.id ===
        expectedSymbol.id) ||
    isSelfReturningMutationCall(unwrappedExpression, expectedSymbol, collectionKind, context)
  ) {
    return [unwrappedExpression];
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return [
      ...collectSameReferenceResultExpressions(
        unwrappedExpression.consequent,
        expectedSymbol,
        collectionKind,
        context,
      ),
      ...collectSameReferenceResultExpressions(
        unwrappedExpression.alternate,
        expectedSymbol,
        collectionKind,
        context,
      ),
    ];
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    return [
      ...collectSameReferenceResultExpressions(
        unwrappedExpression.left,
        expectedSymbol,
        collectionKind,
        context,
      ),
      ...collectSameReferenceResultExpressions(
        unwrappedExpression.right,
        expectedSymbol,
        collectionKind,
        context,
      ),
    ];
  }
  if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    const lastExpression = unwrappedExpression.expressions.at(-1);
    return lastExpression
      ? collectSameReferenceResultExpressions(
          lastExpression,
          expectedSymbol,
          collectionKind,
          context,
        )
      : [];
  }
  return [];
};

const sameReferenceResultSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const result = stripParenExpression(expression);
  if (isNodeOfType(result, "Identifier")) {
    return context.scopes.symbolFor(result);
  }
  if (!isNodeOfType(result, "CallExpression")) return null;
  const objectAssignTarget = getExactObjectAssignTarget(result, context);
  if (objectAssignTarget) return expressionBaseSymbol(objectAssignTarget, context);
  const callee = stripParenExpression(result.callee);
  return isNodeOfType(callee, "MemberExpression")
    ? expressionBaseSymbol(callee.object, context)
    : null;
};

const assignmentTargetsSymbol = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  expectedSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const left = stripParenExpression(assignment.left);
  return Boolean(
    assignment.operator === "=" &&
    isNodeOfType(left, "Identifier") &&
    resolveConstIdentifierRootSymbol(left, context.scopes)?.id === expectedSymbol.id,
  );
};

const statementMayAssignSymbol = (
  statement: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let mayAssignSymbol = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (mayAssignSymbol || (child !== statement && isFunctionLike(child))) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      assignmentTargetsSymbol(child, expectedSymbol, context)
    ) {
      mayAssignSymbol = true;
      return false;
    }
  });
  return mayAssignSymbol;
};

const continuingCatchFreshness = (
  statement: EsTreeNode,
  incomingFreshness: ReadonlySet<boolean>,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): ReadonlySet<boolean> => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return new Set();
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    let continuingFreshness = incomingFreshness;
    for (const childStatement of statement.body) {
      continuingFreshness = continuingCatchFreshness(
        childStatement,
        continuingFreshness,
        expectedSymbol,
        collectionKind,
        context,
      );
      if (continuingFreshness.size === 0) break;
    }
    return continuingFreshness;
  }
  if (isNodeOfType(statement, "IfStatement")) {
    const consequentFreshness = continuingCatchFreshness(
      statement.consequent,
      incomingFreshness,
      expectedSymbol,
      collectionKind,
      context,
    );
    const alternateFreshness = statement.alternate
      ? continuingCatchFreshness(
          statement.alternate,
          incomingFreshness,
          expectedSymbol,
          collectionKind,
          context,
        )
      : incomingFreshness;
    return new Set([...consequentFreshness, ...alternateFreshness]);
  }
  if (isNodeOfType(statement, "ExpressionStatement")) {
    const expression = stripParenExpression(statement.expression);
    if (
      isNodeOfType(expression, "AssignmentExpression") &&
      assignmentTargetsSymbol(expression, expectedSymbol, context)
    ) {
      return new Set([
        expressionIsDefinitelyFreshReference(
          expression.right,
          expectedSymbol,
          collectionKind,
          context,
        ),
      ]);
    }
  }
  return statementMayAssignSymbol(statement, expectedSymbol, context)
    ? new Set([false])
    : incomingFreshness;
};

const catchPreservesFreshReference = (
  handler: EsTreeNodeOfType<"CatchClause">,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): boolean => {
  const continuingFreshness = continuingCatchFreshness(
    handler.body,
    new Set([false]),
    expectedSymbol,
    collectionKind,
    context,
  );
  return [...continuingFreshness].every(Boolean);
};

const expressionIsDefinitelyNonThrowingFreshReference = (expression: EsTreeNode): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "ArrayExpression")) {
    return value.elements.every(
      (element) =>
        element === null ||
        (!isNodeOfType(element, "SpreadElement") &&
          isNodeOfType(stripParenExpression(element), "Literal")),
    );
  }
  return isNodeOfType(value, "ObjectExpression") && value.properties.length === 0;
};

const tryRegionsPreserveReassignment = (
  reassignment: EsTreeNodeOfType<"AssignmentExpression">,
  targetNode: EsTreeNode,
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = reassignment.parent;
  while (ancestor && ancestor !== functionNode) {
    if (!isNodeOfType(ancestor, "TryStatement")) {
      ancestor = ancestor.parent;
      continue;
    }
    const sharedRegion = [ancestor.block, ancestor.handler, ancestor.finalizer].some(
      (region) =>
        region !== null &&
        isAstDescendant(reassignment, region) &&
        isAstDescendant(targetNode, region),
    );
    if (sharedRegion) {
      ancestor = ancestor.parent;
      continue;
    }
    if (
      !isAstDescendant(reassignment, ancestor.block) ||
      isAstDescendant(targetNode, ancestor) ||
      ancestor.finalizer
    ) {
      return false;
    }
    const isOnlyTryStatement =
      ancestor.block.body.length === 1 &&
      isNodeOfType(ancestor.block.body[0], "ExpressionStatement") &&
      stripParenExpression(ancestor.block.body[0].expression) === reassignment;
    if (
      ancestor.handler &&
      !catchPreservesFreshReference(ancestor.handler, expectedSymbol, collectionKind, context) &&
      !(isOnlyTryStatement && expressionIsDefinitelyNonThrowingFreshReference(reassignment.right))
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return true;
};

const lastUnconditionalReassignmentBefore = (
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
  collectionKind: string | null,
  context: RuleContext,
  lowerBoundNode: EsTreeNode | null = null,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  let lastReassignment: EsTreeNodeOfType<"AssignmentExpression"> | null = null;
  let lastReassignmentStart = Number.NEGATIVE_INFINITY;
  walkAst(functionNode, (child: EsTreeNode) => {
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AssignmentExpression") || child.operator !== "=") return;
    const left = stripParenExpression(child.left);
    if (
      !isNodeOfType(left, "Identifier") ||
      resolveConstIdentifierRootSymbol(left, context.scopes)?.id !== expectedSymbol.id ||
      (() => {
        let ancestor: EsTreeNode | null | undefined = child.parent;
        while (ancestor && ancestor !== functionNode) {
          if (
            isNodeOfType(ancestor, "IfStatement") ||
            isNodeOfType(ancestor, "ConditionalExpression") ||
            isNodeOfType(ancestor, "LogicalExpression") ||
            isNodeOfType(ancestor, "SwitchCase") ||
            isNodeOfType(ancestor, "ForStatement") ||
            isNodeOfType(ancestor, "ForInStatement") ||
            isNodeOfType(ancestor, "ForOfStatement") ||
            isNodeOfType(ancestor, "WhileStatement") ||
            isNodeOfType(ancestor, "DoWhileStatement")
          ) {
            return true;
          }
          ancestor = ancestor.parent;
        }
        return !tryRegionsPreserveReassignment(
          child,
          targetNode,
          functionNode,
          expectedSymbol,
          collectionKind,
          context,
        );
      })() ||
      (lowerBoundNode !== null &&
        !nodePrecedesOnReachablePath(lowerBoundNode, child, functionCfg, context)) ||
      !nodePrecedesOnReachablePath(child, targetNode, functionCfg, context)
    ) {
      return;
    }
    const assignmentStart = child.range?.[0] ?? 0;
    if (assignmentStart > lastReassignmentStart) {
      lastReassignment = child;
      lastReassignmentStart = assignmentStart;
    }
  });
  return lastReassignment;
};

const reassignmentChangesReference = (
  reassignment: EsTreeNodeOfType<"AssignmentExpression">,
  expectedSymbol: SymbolDescriptor,
  referenceSymbol: SymbolDescriptor,
): boolean => {
  if (referenceSymbol.id === expectedSymbol.id) return true;
  return Boolean(
    (referenceSymbol.bindingIdentifier.range?.[0] ?? 0) > (reassignment.range?.[0] ?? 0),
  );
};

const hasFreshReassignmentBefore = (
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
  collectionKind: string | null,
  referenceSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const reassignment = lastUnconditionalReassignmentBefore(
    functionNode,
    expectedSymbol,
    targetNode,
    functionCfg,
    collectionKind,
    context,
  );
  return Boolean(
    reassignment &&
    reassignmentChangesReference(reassignment, expectedSymbol, referenceSymbol) &&
    expressionIsDefinitelyFreshReference(
      reassignment.right,
      expectedSymbol,
      collectionKind,
      context,
    ),
  );
};

const hasFreshReassignmentBetween = (
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
  collectionKind: string | null,
  referenceSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const reassignment = lastUnconditionalReassignmentBefore(
    functionNode,
    expectedSymbol,
    targetNode,
    functionCfg,
    collectionKind,
    context,
    sourceNode,
  );
  return Boolean(
    reassignment &&
    reassignmentChangesReference(reassignment, expectedSymbol, referenceSymbol) &&
    expressionIsDefinitelyFreshReference(
      reassignment.right,
      expectedSymbol,
      collectionKind,
      context,
    ),
  );
};

const deduplicateMutationFactsByBlockWhenParameterIsStable = (
  mutationFacts: MutationFact[],
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  functionCfg: FunctionCfg,
  context: RuleContext,
): MutationFact[] => {
  let doesReassignParameter = false;
  walkAst(functionNode, (child: EsTreeNode) => {
    if (doesReassignParameter || (child !== functionNode && isFunctionLike(child))) return false;
    if (!isNodeOfType(child, "AssignmentExpression")) return;
    const left = stripParenExpression(child.left);
    if (
      isNodeOfType(left, "Identifier") &&
      resolveConstIdentifierRootSymbol(left, context.scopes)?.id === expectedSymbol.id
    ) {
      doesReassignParameter = true;
      return false;
    }
  });
  if (doesReassignParameter) return mutationFacts;
  const mutationFactByBlockId = new Map<number, MutationFact>();
  const factsWithoutBlock: MutationFact[] = [];
  for (const mutationFact of mutationFacts) {
    const block = functionCfg.blockOf(mutationFact.node);
    if (!block) {
      factsWithoutBlock.push(mutationFact);
      continue;
    }
    const previousFact = mutationFactByBlockId.get(block.id);
    if (
      !previousFact ||
      (mutationFact.node.range?.[0] ?? 0) < (previousFact.node.range?.[0] ?? 0)
    ) {
      mutationFactByBlockId.set(block.id, mutationFact);
    }
  }
  return [...mutationFactByBlockId.values(), ...factsWithoutBlock];
};

const updaterMutatesThenReturnsSameReference = (
  updaterFunction: EsTreeNode,
  collectionKind: string | null,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(updaterFunction)) return false;
  const firstParameter = updaterFunction.params?.[0];
  if (!isNodeOfType(firstParameter, "Identifier")) return false;
  const parameterSymbol = context.scopes.symbolFor(firstParameter);
  if (!parameterSymbol) return false;
  const functionCfg = context.cfg.cfgFor(updaterFunction);
  if (!functionCfg) return false;
  const mutationFacts = deduplicateMutationFactsByBlockWhenParameterIsStable(
    collectMutationFacts(updaterFunction, parameterSymbol, collectionKind, context),
    updaterFunction,
    parameterSymbol,
    functionCfg,
    context,
  );
  if (mutationFacts.length === 0) return false;
  const resultExpressions: EsTreeNode[] = [];
  if (!isNodeOfType(updaterFunction.body, "BlockStatement")) {
    resultExpressions.push(updaterFunction.body);
  }
  walkAst(updaterFunction.body, (child: EsTreeNode) => {
    if (child !== updaterFunction.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) {
      return;
    }
    resultExpressions.push(child.argument);
  });
  for (const resultExpression of resultExpressions) {
    const reachableMutationFacts = mutationFacts.filter(
      (mutationFact) =>
        isAstDescendant(mutationFact.node, resultExpression) ||
        nodePrecedesOnReachablePath(mutationFact.node, resultExpression, functionCfg, context),
    );
    if (reachableMutationFacts.length === 0) continue;
    const sameReferenceResults = collectSameReferenceResultExpressions(
      resultExpression,
      parameterSymbol,
      collectionKind,
      context,
    );
    for (const sameReferenceResult of sameReferenceResults) {
      const resultReferenceSymbol = sameReferenceResultSymbol(sameReferenceResult, context);
      if (!resultReferenceSymbol) continue;
      for (const mutationFact of reachableMutationFacts) {
        if (
          (mutationFact.node === sameReferenceResult ||
            nodePrecedesOnReachablePath(
              mutationFact.node,
              sameReferenceResult,
              functionCfg,
              context,
            )) &&
          !hasFreshReassignmentBefore(
            updaterFunction,
            parameterSymbol,
            mutationFact.node,
            functionCfg,
            collectionKind,
            mutationFact.referenceSymbol,
            context,
          ) &&
          !hasFreshReassignmentBetween(
            updaterFunction,
            parameterSymbol,
            mutationFact.node,
            sameReferenceResult,
            functionCfg,
            collectionKind,
            resultReferenceSymbol,
            context,
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

export const noMutateThenSetOrReturnSameReference = defineRule({
  id: "no-mutate-then-set-or-return-same-reference",
  title: "State mutated in place then set by same reference",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Copy state before mutating it, then pass the fresh reference to the matching useState setter.",
  create: (context: RuleContext) => {
    const mutationFactsByFunction = new WeakMap<EsTreeNode, Map<number, MutationFact[]>>();
    const freshReassignmentByMutation = new WeakMap<EsTreeNode, boolean>();
    const updaterResultByFunction = new WeakMap<EsTreeNode, Map<string, boolean>>();
    const getMutationFacts = (
      functionNode: EsTreeNode,
      expectedSymbol: SymbolDescriptor,
      collectionKind: string | null,
    ): MutationFact[] => {
      const cachedBySymbol = mutationFactsByFunction.get(functionNode) ?? new Map();
      mutationFactsByFunction.set(functionNode, cachedBySymbol);
      const cachedFacts = cachedBySymbol.get(expectedSymbol.id);
      if (cachedFacts) return cachedFacts;
      const facts = collectMutationFacts(functionNode, expectedSymbol, collectionKind, context);
      cachedBySymbol.set(expectedSymbol.id, facts);
      return facts;
    };
    const mutationHasFreshReassignment = (
      functionNode: EsTreeNode,
      expectedSymbol: SymbolDescriptor,
      mutationNode: EsTreeNode,
      functionCfg: FunctionCfg,
      collectionKind: string | null,
      referenceSymbol: SymbolDescriptor,
    ): boolean => {
      const cachedResult = freshReassignmentByMutation.get(mutationNode);
      if (cachedResult !== undefined) return cachedResult;
      const result = hasFreshReassignmentBefore(
        functionNode,
        expectedSymbol,
        mutationNode,
        functionCfg,
        collectionKind,
        referenceSymbol,
        context,
      );
      freshReassignmentByMutation.set(mutationNode, result);
      return result;
    };
    const updaterHasViolation = (
      updaterFunction: EsTreeNode,
      collectionKind: string | null,
    ): boolean => {
      const cacheKey = collectionKind ?? "unknown";
      const cachedByKind = updaterResultByFunction.get(updaterFunction) ?? new Map();
      updaterResultByFunction.set(updaterFunction, cachedByKind);
      const cachedResult = cachedByKind.get(cacheKey);
      if (cachedResult !== undefined) return cachedResult;
      const result = updaterMutatesThenReturnsSameReference(
        updaterFunction,
        collectionKind,
        context,
      );
      cachedByKind.set(cacheKey, result);
      return result;
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "Identifier")) return;
        const pair = resolveReactUseStatePair(callee, context.scopes);
        if (!pair) return;
        const firstArgument = node.arguments?.[0];
        if (!firstArgument) return;
        const argument = stripParenExpression(firstArgument);
        const collectionKind = stateCollectionKind(pair.declarator, context);
        if (
          pair.stateSymbol &&
          isSelfReturningMutationCall(argument, pair.stateSymbol, collectionKind, context)
        ) {
          context.report({ node, message: MESSAGE });
          return;
        }
        if (pair.stateSymbol) {
          const stateSymbol = pair.stateSymbol;
          const sameReferenceResults = collectSameReferenceResultExpressions(
            argument,
            stateSymbol,
            collectionKind,
            context,
          );
          if (sameReferenceResults.length === 0) {
            const updaterFunction = resolveLocalFunction(argument, context);
            if (updaterFunction && updaterHasViolation(updaterFunction, collectionKind)) {
              context.report({ node, message: MESSAGE });
            }
            return;
          }
          const enclosingFunction = findEnclosingFunction(node);
          const functionCfg = enclosingFunction ? context.cfg.cfgFor(enclosingFunction) : null;
          if (enclosingFunction && functionCfg) {
            const mutationFacts = getMutationFacts(enclosingFunction, stateSymbol, collectionKind);
            if (
              mutationFacts.some(
                (mutationFact) =>
                  sameReferenceResults.some((sameReferenceResult) =>
                    nodePrecedesOnReachablePath(
                      mutationFact.node,
                      sameReferenceResult,
                      functionCfg,
                      context,
                    ),
                  ) &&
                  !mutationHasFreshReassignment(
                    enclosingFunction,
                    stateSymbol,
                    mutationFact.node,
                    functionCfg,
                    collectionKind,
                    mutationFact.referenceSymbol,
                  ),
              )
            ) {
              context.report({ node, message: MESSAGE });
            }
          }
          return;
        }
        const updaterFunction = resolveLocalFunction(argument, context);
        if (updaterFunction && updaterHasViolation(updaterFunction, collectionKind)) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
