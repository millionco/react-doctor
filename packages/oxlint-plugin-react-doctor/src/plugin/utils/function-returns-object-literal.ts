import { FUNCTION_LIKE_TYPES } from "../constants/js.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";

// Unwraps the TS / paren wrappers that can sit between `return` and the
// actual returned value (`return {} as Foo`, `return ({}) satisfies Bar`)
// so the underlying expression type is visible.
const unwrapExpression = (node: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = node;
  for (;;) {
    if (
      (current.type === "TSAsExpression" ||
        current.type === "TSSatisfiesExpression" ||
        current.type === "TSNonNullExpression") &&
      "expression" in current &&
      isAstNode((current as unknown as { expression: unknown }).expression)
    ) {
      current = (current as unknown as { expression: EsTreeNode }).expression;
      continue;
    }
    return current;
  }
};

// True when `functionNode` returns a plain object literal — the structural
// signature of a factory function (`const makeX = () => ({ ... })`,
// `function Adapter() { return { foo, bar } }`). A React component never
// returns a plain object (it returns a ReactNode), so this is used to
// reject PascalCase-named factories that would otherwise be mistaken for
// components. Walks like `functionBodyHasReturnWithValue`: arrow expression
// bodies ARE the return value, and block bodies are scanned without
// crossing into nested function boundaries (their returns belong to the
// inner function).
export const doesFunctionReturnsObjectLiteral = (functionNode: EsTreeNode): boolean => {
  if (functionNode.type === "ArrowFunctionExpression" && "body" in functionNode) {
    const body = functionNode.body;
    if (body && body.type !== "BlockStatement") {
      return unwrapExpression(body).type === "ObjectExpression";
    }
  }

  const body = (functionNode as unknown as { body?: EsTreeNode | null }).body;
  if (!body || body.type !== "BlockStatement") return false;

  let returnsObject = false;
  const visit = (node: EsTreeNode): void => {
    if (returnsObject) return;
    if (node.type === "ReturnStatement" && "argument" in node && node.argument != null) {
      if (unwrapExpression(node.argument).type === "ObjectExpression") {
        returnsObject = true;
      }
      return;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (!isAstNode(item)) continue;
          if (FUNCTION_LIKE_TYPES.has(item.type)) continue;
          visit(item);
          if (returnsObject) return;
        }
      } else if (isAstNode(child)) {
        if (FUNCTION_LIKE_TYPES.has(child.type)) continue;
        visit(child);
      }
    }
  };
  visit(body);
  return returnsObject;
};
