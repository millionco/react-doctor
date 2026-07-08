import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const isReactModuleSource = (source: string): boolean =>
  source === "react" ||
  source === "react-dom" ||
  source.startsWith("react/") ||
  source.startsWith("react-dom/");

const cachedResultByProgram = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

// True when the module imports React (or a react-dom entry point) or renders
// JSX — the markers of code that participates in a browser-facing React tree.
export const moduleReferencesReact = (node: EsTreeNode): boolean => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) return false;
  const cached = cachedResultByProgram.get(programRoot);
  if (cached !== undefined) return cached;
  let referencesReact = false;
  walkAst(programRoot, (visitedNode) => {
    if (referencesReact) return false;
    if (isNodeOfType(visitedNode, "ImportDeclaration")) {
      const source = visitedNode.source?.value;
      if (typeof source === "string" && isReactModuleSource(source)) {
        referencesReact = true;
        return false;
      }
    }
    if (visitedNode.type === "JSXOpeningElement") {
      referencesReact = true;
      return false;
    }
  });
  cachedResultByProgram.set(programRoot, referencesReact);
  return referencesReact;
};
