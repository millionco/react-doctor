import { getFunctionBindingName } from "../utils/get-function-binding-name.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../utils/es-tree-node-of-type.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../utils/is-react-component-or-hook-name.js";
import { createSourcePositionResolver } from "../utils/create-source-position-resolver.js";

export interface ComplexityFunctionKind {
  readonly kind: "module" | "component" | "hook" | "method" | "arrow" | "function";
}

interface NodeWithStartOffset {
  readonly start?: number;
}

const MODULE_NAME = "<module>";

export const getNodeStartOffset = (node: EsTreeNode): number | undefined => {
  const nodeWithStartOffset = node as NodeWithStartOffset;
  return typeof nodeWithStartOffset.start === "number" ? nodeWithStartOffset.start : undefined;
};

const getKeyName = (node: EsTreeNode): string | null => {
  if (
    (isNodeOfType(node, "Property") ||
      isNodeOfType(node, "MethodDefinition") ||
      isNodeOfType(node, "PropertyDefinition")) &&
    node.key
  ) {
    if (isNodeOfType(node.key, "Identifier")) return node.key.name;
    if (isNodeOfType(node.key, "Literal")) return String(node.key.value);
  }
  return null;
};

const getAssignmentTargetName = (assignment: EsTreeNode): string | null => {
  if (!isNodeOfType(assignment, "AssignmentExpression")) return null;
  const left = assignment.left;
  if (isNodeOfType(left, "Identifier")) return left.name;
  if (isNodeOfType(left, "MemberExpression")) {
    if (!left.computed && isNodeOfType(left.property, "Identifier")) return left.property.name;
    if (isNodeOfType(left.property, "Literal")) return String(left.property.value);
  }
  return null;
};

export const getFunctionName = (node: EsTreeNode): string => {
  if (isNodeOfType(node, "FunctionDeclaration") && isNodeOfType(node.id, "Identifier")) {
    return node.id.name;
  }

  const bindingName = getFunctionBindingName(node);
  if (bindingName) return bindingName;

  const parent = node.parent;
  if (
    parent &&
    (isNodeOfType(parent, "Property") ||
      isNodeOfType(parent, "MethodDefinition") ||
      isNodeOfType(parent, "PropertyDefinition"))
  ) {
    const propertyName = getKeyName(parent);
    if (propertyName) return propertyName;
  }

  const assignmentName = parent ? getAssignmentTargetName(parent) : null;
  if (assignmentName) return assignmentName;

  return "<anonymous>";
};

const isMethodFunction = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (isNodeOfType(parent, "MethodDefinition")) return true;
  if (!isNodeOfType(parent, "Property")) return false;
  return parent.method === true;
};

export const getFunctionKind = (node: EsTreeNode, name: string): ComplexityFunctionKind["kind"] => {
  if (name === MODULE_NAME) return "module";
  if (isReactComponentOrHookName(name)) {
    return name.startsWith("use") ? "hook" : "component";
  }
  if (isMethodFunction(node)) return "method";
  if (isNodeOfType(node, "ArrowFunctionExpression")) return "arrow";
  return "function";
};

export const visitChildren = (node: EsTreeNode, visitor: (child: EsTreeNode) => void): void => {
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) visitor(item);
      }
    } else if (isAstNode(child)) {
      visitor(child);
    }
  }
};

export const walkAllNodes = (
  node: EsTreeNode,
  visitor: (child: EsTreeNode) => boolean | void,
): void => {
  const shouldDescend = visitor(node);
  if (shouldDescend === false) return;
  visitChildren(node, (child) => walkAllNodes(child, visitor));
};

export const collectFunctionNodes = (root: EsTreeNode): EsTreeNode[] => {
  const functionNodes: EsTreeNode[] = [];
  walkAllNodes(root, (node) => {
    if (isFunctionLike(node)) functionNodes.push(node);
  });
  return functionNodes;
};

export interface ComplexityFunctionKeyInput {
  readonly relativePath: string;
  readonly name: string;
  readonly kind: ComplexityFunctionKind["kind"];
  readonly line: number;
}

export const buildComplexityFunctionKey = (input: ComplexityFunctionKeyInput): string => {
  if (input.name === MODULE_NAME) return `${input.relativePath}|module`;
  if (input.name === "<anonymous>") return `${input.relativePath}|${input.kind}|${input.line}`;
  return `${input.relativePath}|${input.kind}|${input.name}`;
};

export const createComplexityPositionResolver = (
  sourceText: string,
): ((offset: number | undefined) => { line: number; column: number }) =>
  createSourcePositionResolver(sourceText).resolve;
