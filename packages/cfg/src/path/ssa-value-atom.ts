import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { SsaAnalysis } from "../ssa.js";
import { valueAtom } from "./literal-facts.js";
import type { ResolveValueAtom } from "./path-condition.js";

// Bridge SSA versions onto the path-feasibility atom domain: the SAME value
// read at two branches resolves to one atom, which is what lets the
// feasibility checker refute correlated-branch counterexamples. The seam every
// Layer D caller (the plugin context + the analyses' test harnesses) shares.
export const ssaValueResolver = (ssa: Pick<SsaAnalysis, "versionAt">): ResolveValueAtom => {
  return (identifier: EsTreeNode) => {
    const ssaIdentifier = ssa.versionAt(identifier);
    return ssaIdentifier ? valueAtom(`${ssaIdentifier.binding}#${ssaIdentifier.version}`) : null;
  };
};
