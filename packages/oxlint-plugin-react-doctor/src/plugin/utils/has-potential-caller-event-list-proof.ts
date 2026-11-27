import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export const mayHaveCallerEventListProof = (sourceText: string): boolean =>
  sourceText.includes("for") &&
  sourceText.includes("of") &&
  sourceText.includes("=") &&
  (sourceText.includes("EventListener") || sourceText.includes("\\"));

// Cache-only overapproximation. The rule must separately prove ownership,
// listener identity, and the external caller domain before using a default.
export const hasPotentialCallerEventListProof = (program: EsTreeNode): boolean => {
  if (!isNodeOfType(program, "Program")) return true;
  const defaultParameterNames = new Set<string>();
  const iteratedNames = new Set<string>();
  walkAst(program, (node) => {
    if (isFunctionLike(node)) {
      for (const param of node.params) {
        if (isNodeOfType(param, "AssignmentPattern") && isNodeOfType(param.left, "Identifier")) {
          defaultParameterNames.add(param.left.name);
        }
      }
    }
    if (isNodeOfType(node, "ForOfStatement")) {
      const collection = stripParenExpression(node.right);
      if (isNodeOfType(collection, "Identifier")) iteratedNames.add(collection.name);
    }
  });
  return [...iteratedNames].some((name) => defaultParameterNames.has(name));
};

export const hasPotentialCallerEventListSource = (
  filename: string,
  sourceText: string,
): boolean => {
  if (!mayHaveCallerEventListProof(sourceText)) return false;
  const program = parseSourceText({ filename, sourceText });
  return program === null || hasPotentialCallerEventListProof(program);
};
