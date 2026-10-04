import type { ClassificationResult } from "./classification-schema.js";
import type { SolReview } from "./sol-review-schema.js";
import { SOL_REVIEW_SNIPPET_LINES, SOL_REVIEW_SNIPPET_CONTEXT_LINES } from "./constants.js";

export const renderSolAudit = (
  screenings: ClassificationResult[],
  reviews: SolReview[],
  summary: unknown,
): string => {
  const candidatesById = new Map(
    screenings.map((screening) => [screening.id, screening.candidate]),
  );
  const sections = [
    "# Jev → Sol FP/FN audit",
    "",
    "These are independent model judgments with checked source citations. Detector presence or absence comes from the saved pinned scan. These are not fresh runtime reproductions.",
    "Five reported file/rule groups and five silent file/rule pairs were selected per repository where available. Only the representative reported location was reviewed. FN sampling does not measure full recall.",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ];
  for (const review of reviews.toSorted(
    (left, right) => left.verdict.localeCompare(right.verdict) || left.id.localeCompare(right.id),
  )) {
    const candidate = candidatesById.get(review.id);
    if (!candidate) continue;
    const evidence = review.judgment.evidence.find(
      (entry) =>
        entry.filePath === candidate.filePath &&
        (candidate.line === null ||
          (entry.startLine <= candidate.line && entry.endLine >= candidate.line)),
    );
    const startLine = Math.max(
      evidence?.startLine ?? candidate.line ?? 1,
      candidate.line === null ? 1 : candidate.line - SOL_REVIEW_SNIPPET_CONTEXT_LINES,
    );
    const endLine = Math.min(
      evidence?.endLine ?? startLine,
      startLine + SOL_REVIEW_SNIPPET_LINES - 1,
    );
    const snippet = candidate.code
      .split("\n")
      .slice(startLine - 1, endLine)
      .join("\n");
    const url = `https://github.com/${candidate.repository.org}/${candidate.repository.name}/blob/${candidate.repository.ref}/${candidate.filePath.split("/").map(encodeURIComponent).join("/")}#L${startLine}-L${endLine}`;
    sections.push(
      `## ${review.verdict.toUpperCase()}: ${candidate.rule.key}`,
      "",
      `[${candidate.repository.org}/${candidate.repository.name} — ${candidate.filePath}:${startLine}](${url})`,
      "",
      `Case: ${review.id}`,
      `Detector: ${candidate.detectorCommit}; emitted: ${candidate.detected}.`,
      "",
      "````tsx",
      snippet,
      "````",
      "",
      review.judgment.reason,
      "",
      ...review.judgment.missingEvidence.map((missing) => `Missing: ${missing}`),
      ...review.citationIssues.map((issue) => `Citation error: ${issue}`),
      "",
    );
  }
  return sections.join("\n");
};
