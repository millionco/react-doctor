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
  const requiredEvidence = candidate.rule.requiredEvidence ?? [];
  const missingRequiredEvidence: string[] = [];
  if (
    requiredEvidence.includes("jsx-runtime") &&
    (!candidate.buildEvidence || candidate.buildEvidence.jsxRuntime === "unknown")
  ) {
    missingRequiredEvidence.push("Verified JSX runtime build evidence is required.");
  }
  if (
    requiredEvidence.includes("verified-contract") &&
    (!candidate.rule.contractHash || candidate.rule.contractIssue)
  ) {
    missingRequiredEvidence.push("A verified rule contract is required.");
  }
  if (missingRequiredEvidence.length > 0) {
    judgment.judgment = "insufficient_context";
    judgment.missingEvidence = [
      ...new Set([...judgment.missingEvidence, ...missingRequiredEvidence]),
    ];
  }
  const citationIssues = validateSolCitations(judgment, review.sources, candidate);
  let verdict: SolReview["verdict"] = "unresolved";
  if (
    judgment.judgment !== "insufficient_context" &&
    judgment.missingEvidence.length === 0 &&
    citationIssues.length === 0
  ) {
    if (candidate.detected) verdict = judgment.judgment === "valid" ? "fp" : "rejected";
    else verdict = judgment.judgment === "violation" ? "fn" : "rejected";
  }
  if (judgment.detectorAssessment && verdict !== "unresolved") {
    if (judgment.detectorAssessment === "uncertain") verdict = "unresolved";
    else if (judgment.detectorAssessment === "correct") verdict = "rejected";
    else if (verdict === "rejected") verdict = "unresolved";
  }
  return { ...review, originalJudgment, judgment, citationIssues, verdict };
};
