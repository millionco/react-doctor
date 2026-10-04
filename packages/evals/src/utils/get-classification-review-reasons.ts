import type {
  ClassificationAssessment,
  ClassificationCandidate,
  ClassificationResult,
} from "../classification-schema.js";

export interface ClassificationReviewInput {
  candidate: ClassificationCandidate;
  assessment: ClassificationAssessment | null;
  threshold: number;
}

export const getClassificationReviewReasons = ({
  candidate,
  assessment,
  threshold,
}: ClassificationReviewInput): NonNullable<ClassificationResult["reviewReasons"]> => {
  const reasons: NonNullable<ClassificationResult["reviewReasons"]> = [];
  if (!candidate.contextComplete) reasons.push("incomplete_context");
  if (!assessment) return reasons;
  if (assessment.choice === "insufficient_context") reasons.push("model_insufficient_context");
  if (assessment.contextSufficient < threshold) reasons.push("context_confidence_below_threshold");
  if (assessment.probabilities[assessment.choice] < threshold)
    reasons.push("choice_confidence_below_threshold");
  return reasons;
};
