import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type {
  BasicBlock,
  ControlFlowAnalysis,
  FunctionCfg,
} from "../semantic/control-flow-graph.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAssignedExpressionForWrite } from "./get-assigned-expression-for-write.js";
import { getRangeStart } from "./get-range-start.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { statementAlwaysExits } from "./statement-always-exits.js";
import { walkAst } from "./walk-ast.js";

const REASSIGNABLE_BINDING_KINDS: ReadonlySet<string> = new Set(["let", "var"]);
const CONDITIONAL_EXPRESSION_TYPES: ReadonlySet<string> = new Set([
  "ConditionalExpression",
  "LogicalExpression",
]);

interface AssignedExpressionDefinition {
  readonly expression: EsTreeNode;
  readonly position: number;
  readonly isConditionalWithinBlock: boolean;
}

const collectReturnedExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode) || !functionNode.body) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body];
  return collectFunctionReturnStatements(functionNode).flatMap((returnStatement) =>
    returnStatement.argument ? [returnStatement.argument] : [],
  );
};

const isConditionalWithinBlock = (
  node: EsTreeNode,
  block: BasicBlock,
  functionControlFlow: FunctionCfg,
): boolean => {
  let current = node.parent ?? null;
  while (current && functionControlFlow.blockOf(current) === block) {
    if (CONDITIONAL_EXPRESSION_TYPES.has(current.type)) return true;
    current = current.parent ?? null;
  }
  return false;
};

const haveSameDefinitions = (
  left: ReadonlySet<AssignedExpressionDefinition>,
  right: ReadonlySet<AssignedExpressionDefinition>,
): boolean => left.size === right.size && [...left].every((definition) => right.has(definition));

const applyDefinitions = (
  incomingDefinitions: ReadonlySet<AssignedExpressionDefinition>,
  definitions: ReadonlyArray<AssignedExpressionDefinition>,
): Set<AssignedExpressionDefinition> => {
  let currentDefinitions = new Set(incomingDefinitions);
  for (const definition of definitions) {
    if (!definition.isConditionalWithinBlock) currentDefinitions = new Set();
    currentDefinitions.add(definition);
  }
  return currentDefinitions;
};

const collectPossibleAssignedExpressions = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  controlFlow: ControlFlowAnalysis | undefined,
): EsTreeNode[] => {
  if (!REASSIGNABLE_BINDING_KINDS.has(symbol.kind)) {
    return symbol.initializer ? [symbol.initializer] : [];
  }
  if (!controlFlow) return [];
  const referenceFunction = findEnclosingFunction(referenceNode);
  if (findEnclosingFunction(symbol.bindingIdentifier) !== referenceFunction) return [];
  if (!referenceFunction) return [];
  const functionControlFlow = controlFlow.cfgFor(referenceFunction);
  if (!functionControlFlow) return [];
  const referenceBlock = functionControlFlow.blockOf(referenceNode);
  if (!referenceBlock) return [];
  const referencePosition = getRangeStart(referenceNode);
  const bindingPosition = getRangeStart(symbol.bindingIdentifier);
  if (referencePosition === null || bindingPosition === null) return [];

  const definitionsByBlock = new Map<BasicBlock, AssignedExpressionDefinition[]>();
  const addDefinition = (
    expression: EsTreeNode,
    definitionNode: EsTreeNode,
    position: number,
  ): void => {
    const block = functionControlFlow.blockOf(definitionNode);
    if (!block) return;
    const definitions = definitionsByBlock.get(block) ?? [];
    definitions.push({
      expression,
      position,
      isConditionalWithinBlock: isConditionalWithinBlock(
        definitionNode,
        block,
        functionControlFlow,
      ),
    });
    definitionsByBlock.set(block, definitions);
  };

  if (symbol.initializer) {
    addDefinition(symbol.initializer, symbol.bindingIdentifier, bindingPosition);
  }
  for (const reference of symbol.references) {
    const writePosition = getRangeStart(reference.identifier);
    if (
      reference.flag === "read" ||
      findEnclosingFunction(reference.identifier) !== referenceFunction ||
      writePosition === null ||
      writePosition >= referencePosition
    ) {
      continue;
    }
    const assignedExpression = getAssignedExpressionForWrite(reference.identifier);
    if (!assignedExpression) continue;
    addDefinition(assignedExpression, reference.identifier, writePosition);
  }
  for (const definitions of definitionsByBlock.values()) {
    definitions.sort((left, right) => left.position - right.position);
  }

  const incomingDefinitionsByBlock = new Map<BasicBlock, Set<AssignedExpressionDefinition>>();
  const outgoingDefinitionsByBlock = new Map<BasicBlock, Set<AssignedExpressionDefinition>>();
  const reachableBlocks = new Set<BasicBlock>([functionControlFlow.entry]);
  const pendingBlocks = [functionControlFlow.entry];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (reachableBlocks.has(edge.to)) continue;
      reachableBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  if (!reachableBlocks.has(referenceBlock)) return [];
  let didDefinitionsChange = true;
  while (didDefinitionsChange) {
    didDefinitionsChange = false;
    for (const block of functionControlFlow.blocks) {
      if (!reachableBlocks.has(block)) continue;
      const incomingDefinitions = new Set<AssignedExpressionDefinition>();
      for (const predecessor of block.predecessors) {
        if (!reachableBlocks.has(predecessor.from)) continue;
        for (const definition of outgoingDefinitionsByBlock.get(predecessor.from) ?? []) {
          incomingDefinitions.add(definition);
        }
      }
      const outgoingDefinitions = applyDefinitions(
        incomingDefinitions,
        definitionsByBlock.get(block) ?? [],
      );
      const previousIncomingDefinitions = incomingDefinitionsByBlock.get(block) ?? new Set();
      const previousOutgoingDefinitions = outgoingDefinitionsByBlock.get(block) ?? new Set();
      if (
        !haveSameDefinitions(incomingDefinitions, previousIncomingDefinitions) ||
        !haveSameDefinitions(outgoingDefinitions, previousOutgoingDefinitions)
      ) {
        incomingDefinitionsByBlock.set(block, incomingDefinitions);
        outgoingDefinitionsByBlock.set(block, outgoingDefinitions);
        didDefinitionsChange = true;
      }
    }
  }

  const definitionsBeforeReference = (definitionsByBlock.get(referenceBlock) ?? []).filter(
    (definition) => definition.position < referencePosition,
  );
  return [
    ...applyDefinitions(
      incomingDefinitionsByBlock.get(referenceBlock) ?? new Set(),
      definitionsBeforeReference,
    ),
  ].map((definition) => definition.expression);
};

const functionHasBareReturn = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement")) {
    return false;
  }
  let didFindBareReturn = false;
  walkAst(functionNode.body, (node) => {
    if (didFindBareReturn) return false;
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && !node.argument) didFindBareReturn = true;
  });
  return didFindBareReturn;
};

interface FunctionReturnMatcher {
  readonly expressionMatches: (expression: EsTreeNode) => boolean;
  readonly functionMatches: (candidateFunction: EsTreeNode) => boolean;
}

const createFunctionReturnMatcher = (
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow?: ControlFlowAnalysis,
  matchMode: "some" | "every" = "some",
): FunctionReturnMatcher => {
  const visitedExpressions = new Set<EsTreeNode>();
  const visitedFunctions = new Set<EsTreeNode>();
  let expressionMatches: (expression: EsTreeNode) => boolean;

  const functionMatches = (candidateFunction: EsTreeNode): boolean => {
    if (visitedFunctions.has(candidateFunction)) return false;
    visitedFunctions.add(candidateFunction);
    const returnedExpressions = collectReturnedExpressions(candidateFunction);
    if (
      matchMode === "every" &&
      isFunctionLike(candidateFunction) &&
      isNodeOfType(candidateFunction.body, "BlockStatement") &&
      (!statementAlwaysExits(candidateFunction.body) || functionHasBareReturn(candidateFunction))
    ) {
      return false;
    }
    return (
      returnedExpressions.length > 0 &&
      (matchMode === "every"
        ? returnedExpressions.every(expressionMatches)
        : returnedExpressions.some(expressionMatches))
    );
  };

  expressionMatches = (expression: EsTreeNode): boolean => {
    const unwrappedExpression = stripParenExpression(expression);
    if (visitedExpressions.has(unwrappedExpression)) return false;
    visitedExpressions.add(unwrappedExpression);
    if (matchesExpression(unwrappedExpression)) return true;

    if (isNodeOfType(unwrappedExpression, "Identifier")) {
      const symbol = scopes.symbolFor(unwrappedExpression);
      if (!symbol || (symbol.kind !== "const" && !REASSIGNABLE_BINDING_KINDS.has(symbol.kind))) {
        return false;
      }
      return collectPossibleAssignedExpressions(symbol, unwrappedExpression, controlFlow).some(
        (assignedExpression) => {
          const assignedValue = stripParenExpression(assignedExpression);
          return !isFunctionLike(assignedValue) && expressionMatches(assignedValue);
        },
      );
    }

    if (isNodeOfType(unwrappedExpression, "CallExpression")) {
      if (unwrappedExpression.arguments.length !== 0) return false;
      if (!isNodeOfType(unwrappedExpression.callee, "Identifier")) return false;
      const symbol = scopes.symbolFor(unwrappedExpression.callee);
      if (!symbol || (symbol.kind !== "const" && symbol.kind !== "function")) return false;
      const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
      const candidateFunction = isFunctionLike(initializer)
        ? initializer
        : isFunctionLike(symbol.declarationNode)
          ? symbol.declarationNode
          : null;
      if (
        !candidateFunction ||
        candidateFunction.async ||
        candidateFunction.generator ||
        candidateFunction.params.length !== 0
      ) {
        return false;
      }
      return functionMatches(candidateFunction);
    }

    if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
      return branchesMatch(unwrappedExpression.consequent, unwrappedExpression.alternate);
    }
    if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
      return branchesMatch(unwrappedExpression.left, unwrappedExpression.right);
    }
    return false;
  };

  const branchesMatch = (firstBranch: EsTreeNode, secondBranch: EsTreeNode): boolean => {
    const didBranchMatch = [expressionMatches(firstBranch), expressionMatches(secondBranch)];
    return matchMode === "every" ? didBranchMatch.every(Boolean) : didBranchMatch.some(Boolean);
  };

  return { expressionMatches, functionMatches };
};

export const functionReturnsMatchingExpression = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow?: ControlFlowAnalysis,
  matchMode: "some" | "every" = "some",
): boolean =>
  createFunctionReturnMatcher(scopes, matchesExpression, controlFlow, matchMode).functionMatches(
    functionNode,
  );

export const functionReturnsMatchingExpressionOnEveryPathAfterNode = (
  functionNode: EsTreeNode,
  pathStartNode: EsTreeNode,
  scopes: ScopeAnalysis,
  matchesExpression: (expression: EsTreeNode) => boolean,
  controlFlow: ControlFlowAnalysis,
): boolean => {
  const functionControlFlow = controlFlow.cfgFor(functionNode);
  const startBlock = functionControlFlow?.blockOf(pathStartNode);
  if (!functionControlFlow || !startBlock) return false;
  const matchingReturnBlocks = new Set(
    collectFunctionReturnStatements(functionNode).flatMap((returnStatement) => {
      if (!returnStatement.argument) return [];
      const matcher = createFunctionReturnMatcher(scopes, matchesExpression, controlFlow, "every");
      if (!matcher.expressionMatches(returnStatement.argument)) return [];
      const returnBlock = functionControlFlow.blockOf(returnStatement.argument);
      return returnBlock ? [returnBlock] : [];
    }),
  );
  if (matchingReturnBlocks.size === 0) return false;
  const visitedBlocks = new Set([startBlock]);
  const pendingBlocks = [startBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingReturnBlocks.has(currentBlock)) continue;
    for (const edge of currentBlock.successors) {
      if (edge.to === functionControlFlow.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};
