import type { EsTreeNode } from "./es-tree-node.js";
import { hasDirective } from "./has-directive.js";

const REACT_COMPILER_OPT_OUT_DIRECTIVES = new Set(["use no memo", "use no forget"]);

export const hasReactCompilerOptOutDirective = (node: EsTreeNode): boolean =>
  [...REACT_COMPILER_OPT_OUT_DIRECTIVES].some((directive) => hasDirective(node, directive));
