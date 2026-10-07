import type { SolJudgment, SolSource } from "../sol-review-schema.js";

export const resolveSolCitationLines = (
  judgment: SolJudgment,
  sources: SolSource[],
): SolJudgment => ({
  ...judgment,
  evidence: judgment.evidence.map((evidence) => {
    const source = sources.find((entry) => entry.filePath === evidence.filePath);
    if (!source) return evidence;
    const lines = source.code.split("\n");
    if (lines.slice(evidence.startLine - 1, evidence.endLine).join("\n") === evidence.quote)
      return evidence;
    const quoteLines = evidence.quote.split("\n");
    const matches: number[] = [];
    for (let index = 0; index <= lines.length - quoteLines.length; index += 1) {
      if (lines.slice(index, index + quoteLines.length).join("\n") === evidence.quote)
        matches.push(index);
    }
    if (matches.length !== 1) return evidence;
    return { ...evidence, startLine: matches[0] + 1, endLine: matches[0] + quoteLines.length };
  }),
});
