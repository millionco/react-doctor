import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleVisitors } from "./rule-visitors.js";

interface CreateProgramGatedVisitorsInput {
  readonly createVisitors: () => RuleVisitors;
  readonly shouldAnalyzeProgram: (programNode: EsTreeNodeOfType<"Program">) => boolean;
}

export const createProgramGatedVisitors = ({
  createVisitors,
  shouldAnalyzeProgram,
}: CreateProgramGatedVisitorsInput): RuleVisitors => {
  const activeVisitors = createVisitors();
  const gatedVisitors: RuleVisitors = {};
  let shouldAnalyzeFile = false;

  for (const [selector, visitor] of Object.entries(activeVisitors)) {
    gatedVisitors[selector] = (node) => {
      if (shouldAnalyzeFile) visitor(node);
    };
  }

  const programVisitor = activeVisitors.Program;
  gatedVisitors.Program = (programNode: EsTreeNodeOfType<"Program">) => {
    shouldAnalyzeFile = shouldAnalyzeProgram(programNode);
    if (shouldAnalyzeFile && programVisitor) programVisitor(programNode);
  };

  return gatedVisitors;
};
