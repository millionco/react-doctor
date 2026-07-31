import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { walkAst } from "./walk-ast.js";

interface ProgramBrowserGlobalSyntax {
  readonly mayContainDocumentReference: boolean;
  readonly mayContainLocationReference: boolean;
}

const syntaxByProgram = new WeakMap<EsTreeNodeOfType<"Program">, ProgramBrowserGlobalSyntax>();

export const getProgramBrowserGlobalSyntax = (node: EsTreeNode): ProgramBrowserGlobalSyntax => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) {
    return {
      mayContainDocumentReference: true,
      mayContainLocationReference: true,
    };
  }
  const cachedSyntax = syntaxByProgram.get(programRoot);
  if (cachedSyntax) return cachedSyntax;
  let mayContainDocumentReference = false;
  let mayContainLocationReference = false;
  walkAst(programRoot, (visitedNode) => {
    if (visitedNode.type === "Identifier") {
      if (visitedNode.name === "document") {
        mayContainDocumentReference = true;
      } else if (visitedNode.name === "location") {
        mayContainLocationReference = true;
      }
    } else if (
      (visitedNode.type === "Literal" && visitedNode.value === "location") ||
      (visitedNode.type === "TemplateLiteral" &&
        visitedNode.expressions.length === 0 &&
        (visitedNode.quasis[0]?.value.cooked ?? visitedNode.quasis[0]?.value.raw) === "location")
    ) {
      mayContainLocationReference = true;
    }
    if (mayContainDocumentReference && mayContainLocationReference) return false;
  });
  const syntax = {
    mayContainDocumentReference,
    mayContainLocationReference,
  };
  syntaxByProgram.set(programRoot, syntax);
  return syntax;
};
