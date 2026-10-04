import { z } from "zod";

export const solJudgmentSchema = z.object({
  judgment: z.enum(["valid", "violation", "insufficient_context"]),
  reason: z.string().min(1),
  evidence: z.array(
    z.object({
      filePath: z.string().min(1),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      quote: z.string().min(1),
    }),
  ),
  missingEvidence: z.array(z.string()),
});

export interface SolJudgment extends z.infer<typeof solJudgmentSchema> {}

export interface SolSource {
  filePath: string;
  code: string;
  sha256: string;
}

export const solReviewSchema = z.object({
  id: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  judgment: solJudgmentSchema,
  originalJudgment: solJudgmentSchema.optional(),
  verdict: z.enum(["fp", "fn", "rejected", "unresolved"]),
  citationIssues: z.array(z.string()),
  sources: z.array(z.object({ filePath: z.string(), code: z.string(), sha256: z.string() })),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable().optional(),
  provenance: z.json(),
});

export interface SolReview extends z.infer<typeof solReviewSchema> {}
