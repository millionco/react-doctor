import type { FunctionCfg } from "../../semantic/control-flow-graph.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
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

interface MutationFact {
  readonly node: EsTreeNode;
  readonly call: EsTreeNodeOfType<"CallExpression"> | null;
}

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
  const pendingBlocks = [sourceBlock];
  const visitedBlockIds = new Set([sourceBlock.id]);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlockIds.has(edge.to.id)) continue;
      visitedBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
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
      facts.push({ node: child, call: child });
      return;
    }
    if (isNodeOfType(child, "AssignmentExpression")) {
      const left = stripParenExpression(child.left);
      if (
        isNodeOfType(left, "MemberExpression") &&
        expressionRootSymbol(left, context)?.id === expectedSymbol.id
      ) {
        facts.push({ node: child, call: null });
      }
      return;
    }
    if (isNodeOfType(child, "UpdateExpression")) {
      const argument = stripParenExpression(child.argument);
      if (
        isNodeOfType(argument, "MemberExpression") &&
        expressionRootSymbol(argument, context)?.id === expectedSymbol.id
      ) {
        facts.push({ node: child, call: null });
      }
      return;
    }
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "delete" &&
      isNodeOfType(stripParenExpression(child.argument), "MemberExpression") &&
      expressionRootSymbol(stripParenExpression(child.argument), context)?.id === expectedSymbol.id
    ) {
      facts.push({ node: child, call: null });
    }
  });
  return facts;
};

const expressionReturnsSymbol = (
  expression: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  collectionKind: string | null,
  context: RuleContext,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    resolveConstIdentifierRootSymbol(unwrappedExpression, context.scopes)?.id === expectedSymbol.id
  ) {
    return true;
  }
  if (isSelfReturningMutationCall(unwrappedExpression, expectedSymbol, collectionKind, context)) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return (
      expressionReturnsSymbol(
        unwrappedExpression.consequent,
        expectedSymbol,
        collectionKind,
        context,
      ) ||
      expressionReturnsSymbol(
        unwrappedExpression.alternate,
        expectedSymbol,
        collectionKind,
        context,
      )
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    return (
      expressionReturnsSymbol(unwrappedExpression.left, expectedSymbol, collectionKind, context) ||
      expressionReturnsSymbol(unwrappedExpression.right, expectedSymbol, collectionKind, context)
    );
  }
  if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    const lastExpression = unwrappedExpression.expressions.at(-1);
    return Boolean(
      lastExpression &&
      expressionReturnsSymbol(lastExpression, expectedSymbol, collectionKind, context),
    );
  }
  return false;
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

const nodeIsInside = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const hasFreshReassignmentBefore = (
  functionNode: EsTreeNode,
  expectedSymbol: SymbolDescriptor,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
  context: RuleContext,
): boolean => {
  let lastReassignmentRight: EsTreeNode | null = null;
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
            isNodeOfType(ancestor, "TryStatement") ||
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
        return false;
      })() ||
      !nodePrecedesOnReachablePath(child, targetNode, functionCfg, context)
    ) {
      return;
    }
    const assignmentStart = child.range?.[0] ?? 0;
    if (assignmentStart > lastReassignmentStart) {
      lastReassignmentRight = child.right;
      lastReassignmentStart = assignmentStart;
    }
  });
  return Boolean(
    lastReassignmentRight &&
    !expressionReturnsSymbol(lastReassignmentRight, expectedSymbol, null, context),
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
  if (!isNodeOfType(updaterFunction.body, "BlockStatement")) {
    return isSelfReturningMutationCall(
      updaterFunction.body,
      parameterSymbol,
      collectionKind,
      context,
    );
  }
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
  let didFindPath = false;
  walkAst(updaterFunction.body, (child: EsTreeNode) => {
    if (didFindPath || (child !== updaterFunction.body && isFunctionLike(child))) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) {
      return;
    }
    const reachableMutationFacts = mutationFacts.filter(
      (mutationFact) =>
        nodeIsInside(mutationFact.node, child) ||
        nodePrecedesOnReachablePath(mutationFact.node, child, functionCfg, context),
    );
    if (reachableMutationFacts.length === 0) return;
    const sameReferenceResults = collectSameReferenceResultExpressions(
      child.argument,
      parameterSymbol,
      collectionKind,
      context,
    );
    for (const sameReferenceResult of sameReferenceResults) {
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
            context,
          )
        ) {
          didFindPath = true;
          return false;
        }
      }
    }
  });
  return didFindPath;
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
    ): boolean => {
      const cachedResult = freshReassignmentByMutation.get(mutationNode);
      if (cachedResult !== undefined) return cachedResult;
      const result = hasFreshReassignmentBefore(
        functionNode,
        expectedSymbol,
        mutationNode,
        functionCfg,
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
        if (
          isNodeOfType(argument, "Identifier") &&
          pair.stateSymbol &&
          resolveConstIdentifierRootSymbol(argument, context.scopes)?.id === pair.stateSymbol.id
        ) {
          const stateSymbol = pair.stateSymbol;
          const enclosingFunction = findEnclosingFunction(node);
          const functionCfg = enclosingFunction ? context.cfg.cfgFor(enclosingFunction) : null;
          if (enclosingFunction && functionCfg) {
            const mutationFacts = getMutationFacts(enclosingFunction, stateSymbol, collectionKind);
            if (
              mutationFacts.some(
                (mutationFact) =>
                  nodePrecedesOnReachablePath(mutationFact.node, node, functionCfg, context) &&
                  !mutationHasFreshReassignment(
                    enclosingFunction,
                    stateSymbol,
                    mutationFact.node,
                    functionCfg,
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
