import { expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { getExecutionReferenceOffset } from "./get-execution-reference-offset.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

it("uses normalized starts for nodes and the normalized end for a Program", () => {
  const sourceText = "const destination = source;";
  const program = parseSourceText({ filename: "/tmp/reference.ts", sourceText });
  expect(program).not.toBeNull();
  if (!program) return;

  let sourceIdentifier: EsTreeNode | null = null;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "Identifier") && node.name === "source") {
      sourceIdentifier = node;
    }
  });

  expect(program.range).toEqual([0, sourceText.length]);
  expect(sourceIdentifier).not.toBeNull();
  if (!sourceIdentifier) return;
  expect(getExecutionReferenceOffset(sourceIdentifier)).toBe(sourceText.indexOf("source"));
  expect(getExecutionReferenceOffset(program)).toBe(sourceText.length);
});
