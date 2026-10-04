import type { ClassificationCandidate } from "../classification-schema.js";
import type { SolJudgment, SolSource } from "../sol-review-schema.js";

export const validateSolCitations = (
  judgment: SolJudgment,
  sources: SolSource[],
  candidate: ClassificationCandidate,
): string[] => {
  const issues: string[] = [];
  for (const evidence of judgment.evidence) {
    const source = sources.find((entry) => entry.filePath === evidence.filePath);
    const lines = source?.code.split("\n");
    if (
      !lines ||
      evidence.endLine < evidence.startLine ||
      evidence.endLine > lines.length ||
      lines.slice(evidence.startLine - 1, evidence.endLine).join("\n") !== evidence.quote
    ) {
      issues.push(
        `Invalid citation: ${evidence.filePath}:${evidence.startLine}-${evidence.endLine}`,
      );
    }
  }
  if (
    judgment.judgment !== "insufficient_context" &&
    !judgment.evidence.some(
      (evidence) =>
        evidence.filePath === candidate.filePath &&
        (!candidate.detected ||
          candidate.line === null ||
          (evidence.startLine <= candidate.line && evidence.endLine >= candidate.line)),
    )
  ) {
    issues.push("No target-source citation covers the assessed location");
  }
  return issues;
};
