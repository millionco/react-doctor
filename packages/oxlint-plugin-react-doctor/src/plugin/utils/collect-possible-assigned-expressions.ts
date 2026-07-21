import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type {
  BasicBlock,
  ControlFlowAnalysis,
  FunctionCfg,
} from "../semantic/control-flow-graph.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAssignedExpressionForWrite } from "./get-assigned-expression-for-write.js";
import { getRangeStart } from "./get-range-start.js";
import type { EsTreeNode } from "./es-tree-node.js";

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

export const collectPossibleAssignedExpressions = (
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
