import type { ClassificationCandidate } from "../classification-schema.js";
import type { SolReview } from "../sol-review-schema.js";
import { resolveSolCitationLines } from "./resolve-sol-citation-lines.js";
import { validateSolCitations } from "./validate-sol-citations.js";

export const finalizeSolReview = (
  review: SolReview,
  candidate: ClassificationCandidate,
): SolReview => {
  const originalJudgment = review.originalJudgment ?? review.judgment;
  const judgment = resolveSolCitationLines(originalJudgment, review.sources);
  const citationIssues = validateSolCitations(judgment, review.sources, candidate);
  let verdict: SolReview["verdict"] =
    judgment.judgment === "insufficient_context" ||
    judgment.missingEvidence.length > 0 ||
    citationIssues.length > 0
      ? "unresolved"
      : candidate.detected
        ? judgment.judgment === "valid"
          ? "fp"
          : "rejected"
        : judgment.judgment === "violation"
          ? "fn"
          : "rejected";
  if (judgment.detectorAssessment && verdict !== "unresolved") {
    if (judgment.detectorAssessment === "uncertain") verdict = "unresolved";
    else if (judgment.detectorAssessment === "correct") verdict = "rejected";
    else if (verdict === "rejected") verdict = "unresolved";
  }
  return { ...review, originalJudgment, judgment, citationIssues, verdict };
};
