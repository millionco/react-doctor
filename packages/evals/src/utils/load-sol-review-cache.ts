import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ClassificationResult } from "../classification-schema.js";
import { SOL_REVIEW_MODEL, SOL_REVIEW_PROMPT_VERSION } from "../constants.js";
import { solReviewSchema } from "../sol-review-schema.js";
import type { SolReview } from "../sol-review-schema.js";
import { validateSolCitations } from "./validate-sol-citations.js";

export const loadSolReviewCache = async (
  path: string,
  screening: ClassificationResult,
  promptVersion = SOL_REVIEW_PROMPT_VERSION,
): Promise<SolReview | null> => {
  if (!screening.candidate.code.trim()) return null;
  try {
    const review = solReviewSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (
      review.id !== screening.id ||
      review.model !== SOL_REVIEW_MODEL ||
      review.promptVersion !== promptVersion ||
      review.sources.some(
        (source) => createHash("sha256").update(source.code).digest("hex") !== source.sha256,
      ) ||
      !review.sources.some(
        (source) =>
          source.filePath === screening.candidate.filePath &&
          source.code === screening.candidate.code,
      ) ||
      JSON.stringify(validateSolCitations(review.judgment, review.sources, screening.candidate)) !==
        JSON.stringify(review.citationIssues)
    )
      return null;
    return review;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};
