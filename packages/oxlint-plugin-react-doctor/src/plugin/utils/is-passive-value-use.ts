import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";

export interface PassiveValueUseInput {
  readonly node: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly maximumDepth: number;
}

interface PassiveValueUseContext {
  readonly scopes: ScopeAnalysis;
  readonly maximumDepth: number;
  readonly resultsByNodeAndDepth: Map<EsTreeNode, Map<number, boolean>>;
}

const evaluatePassiveUse = (
  node: EsTreeNode,
  context: PassiveValueUseContext,
  depth: number,
): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "ExpressionStatement" && parent.expression === node) return true;
  if (
    (parent.type === "IfStatement" ||
      parent.type === "WhileStatement" ||
      parent.type === "DoWhileStatement" ||
      parent.type === "ConditionalExpression") &&
    parent.test === node
  )
    return true;
  if (parent.type === "UnaryExpression" && ["!", "typeof", "void"].includes(parent.operator))
    return true;
  if (parent.type === "BinaryExpression" && ["===", "!=="].includes(parent.operator)) return true;
  if (parent.type === "LogicalExpression" || parent.type === "ConditionalExpression")
    return hasPassiveUse(parent, context, depth + 1);
  if (parent.type === "SequenceExpression")
    return parent.expressions.at(-1) !== node || hasPassiveUse(parent, context, depth + 1);
  if (
    parent.type === "JSXExpressionContainer" &&
    parent.parent?.type === "JSXElement" &&
    parent.parent.children.some((child) => child === parent) &&
    parent.parent.openingElement.name.type === "JSXIdentifier" &&
    /^[a-z]/.test(parent.parent.openingElement.name.name)
  )
    return true;
  if (
    parent.type !== "VariableDeclarator" ||
    parent.init !== node ||
    parent.id.type !== "Identifier" ||
    parent.parent?.type !== "VariableDeclaration" ||
    parent.parent.parent?.type === "ExportNamedDeclaration"
  )
    return false;
  const symbol = context.scopes.symbolFor(parent.id);
  return Boolean(
    symbol &&
    getDirectUnreassignedInitializer(symbol) === node &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" && hasPassiveUse(reference.identifier, context, depth + 1),
    ),
  );
};

const hasPassiveUse = (
  node: EsTreeNode,
  context: PassiveValueUseContext,
  depth: number,
): boolean => {
  if (depth > context.maximumDepth) return false;
  const previous = context.resultsByNodeAndDepth.get(node)?.get(depth);
  if (previous !== undefined) return previous;
  const result = evaluatePassiveUse(node, context, depth);
  let resultsByDepth = context.resultsByNodeAndDepth.get(node);
  if (!resultsByDepth) {
    resultsByDepth = new Map();
    context.resultsByNodeAndDepth.set(node, resultsByDepth);
  }
  resultsByDepth.set(depth, result);
  return result;
};

export const isPassiveValueUse = ({ node, scopes, maximumDepth }: PassiveValueUseInput): boolean =>
  hasPassiveUse(node, { scopes, maximumDepth, resultsByNodeAndDepth: new Map() }, 0);
