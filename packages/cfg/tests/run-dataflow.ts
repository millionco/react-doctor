import { analyzeControlFlow } from "../src/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../src/control-flow-graph.js";
import { analyzeDefiniteAssignment } from "../src/dataflow/definite-assignment.js";
import type { DefiniteAssignmentAnalysis } from "../src/dataflow/definite-assignment.js";
import { isAstNode } from "../src/ast/is-ast-node.js";
import { isNodeOfType } from "../src/ast/is-node-of-type.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";
import { analyzeSsa } from "../src/ssa.js";
import { ssaValueResolver } from "../src/path/ssa-value-atom.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";

export interface DataflowFixture {
  readonly program: EsTreeNode;
  readonly controlFlow: ControlFlowAnalysis;
  readonly definiteAssignment: DefiniteAssignmentAnalysis;
  // Same analysis, with the Layer D path-feasibility refinement wired in.
  readonly definiteAssignmentWithFeasibility: DefiniteAssignmentAnalysis;
  // The nth (`"x#2"`) source-order identifier named `x`; `"x"` is the first.
  readonly identifier: (spec: string) => EsTreeNode;
}

const collectIdentifiers = (root: EsTreeNode, name: string): EsTreeNode[] => {
  const matches: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "Identifier") && node.name === name) matches.push(node);
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return matches;
};

export const analyzeDataflowFixture = (code: string): DataflowFixture => {
  const parsed = parseFixture(code);
  if (parsed.errors.length > 0) {
    throw new Error(
      `dataflow fixture failed to parse: ${parsed.errors.map((error) => error.message).join("; ")}`,
    );
  }
  attachParentReferences(parsed.program);

  const identifier = (spec: string): EsTreeNode => {
    const hashIndex = spec.lastIndexOf("#");
    const name = hashIndex === -1 ? spec : spec.slice(0, hashIndex);
    const occurrence = hashIndex === -1 ? 1 : Number(spec.slice(hashIndex + 1));
    const matches = collectIdentifiers(parsed.program, name);
    const node = matches[occurrence - 1];
    if (!node) {
      throw new Error(
        `dataflow identifier "${spec}" not found — fixture has ${matches.length} "${name}" identifier(s)`,
      );
    }
    return node;
  };

  const resolveValue = ssaValueResolver(analyzeSsa(parsed.program));

  return {
    program: parsed.program,
    controlFlow: analyzeControlFlow(parsed.program),
    definiteAssignment: analyzeDefiniteAssignment(parsed.program),
    definiteAssignmentWithFeasibility: analyzeDefiniteAssignment(parsed.program, undefined, {
      resolveValue,
    }),
    identifier,
  };
};
