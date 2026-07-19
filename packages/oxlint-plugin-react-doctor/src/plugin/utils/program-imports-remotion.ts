import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

const resultByProgram = new WeakMap<object, boolean>();

export const programImportsRemotion = (node: EsTreeNode): boolean => {
  const program = findProgramRoot(node);
  if (!program) return false;
  const cachedResult = resultByProgram.get(program);
  if (cachedResult !== undefined) return cachedResult;
  const importsRemotion = program.body.some(
    (statement) =>
      isNodeOfType(statement, "ImportDeclaration") &&
      statement.importKind !== "type" &&
      isNodeOfType(statement.source, "Literal") &&
      statement.source.value === "remotion",
  );
  resultByProgram.set(program, importsRemotion);
  return importsRemotion;
};
