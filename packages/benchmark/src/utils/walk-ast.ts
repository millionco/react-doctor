import type { AstVisitorNode } from "../types/index.js";

const isAstNode = (value: unknown): value is AstVisitorNode =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

// Depth-first walk over an oxc ESTree tree, invoking `visit` for every node
// that has a string `type`. The oxc AST has no parent back-references (we never
// attach them), so a plain recursive descent is cycle-free. Used by the AST
// checks, which match on `node.type` rather than a committed AST type surface.
export const walkAst = (root: unknown, visit: (node: AstVisitorNode) => void): void => {
  const visitValue = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const element of value) visitValue(element);
      return;
    }
    if (!isAstNode(value)) return;
    visit(value);
    for (const key of Object.keys(value)) {
      if (key === "type" || key === "start" || key === "end") continue;
      visitValue(value[key]);
    }
  };
  visitValue(root);
};
