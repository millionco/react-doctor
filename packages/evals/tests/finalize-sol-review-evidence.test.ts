import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import type { ClassificationCandidate } from "../src/classification-schema.js";
import type { SolReview } from "../src/sol-review-schema.js";
import { finalizeSolReview } from "../src/utils/finalize-sol-review.js";

const code = "export const View = () => <main />;";
const candidate: ClassificationCandidate = {
  schemaVersion: 2,
  repository: { org: "example", name: "fixture", ref: "a".repeat(40), rootDir: "." },
  detectorCommit: "b".repeat(40),
  ruleSetHash: "c".repeat(64),
  rule: {
    key: "react-doctor/react-in-jsx-scope",
    description: "Classic JSX needs React in scope",
    exceptions: [],
    requiredEvidence: ["jsx-runtime"],
  },
  filePath: "view.tsx",
  line: 1,
  detected: true,
  framework: "react",
  code,
  contextComplete: false,
};
const review: SolReview = {
  id: "sample",
  model: "test",
  promptVersion: "test",
  verdict: "fp",
  citationIssues: [],
  judgment: {
    judgment: "valid",
    detectorAssessment: "incorrect",
    reason: "The model assumes an automatic runtime.",
    missingEvidence: [],
    evidence: [{ filePath: "view.tsx", startLine: 1, endLine: 1, quote: code }],
  },
  sources: [
    { filePath: "view.tsx", code, sha256: createHash("sha256").update(code).digest("hex") },
  ],
  inputTokens: 0,
  outputTokens: 0,
  provenance: null,
};
describe("independent review required evidence", () => {
  it.each([undefined, { jsxRuntime: "unknown" as const, files: [] }])(
    "does not confirm an FP without verified JSX runtime: %s",
    (buildEvidence) => {
      const result = finalizeSolReview(review, { ...candidate, buildEvidence });
      expect(result.verdict).toBe("unresolved");
      expect(result.judgment.missingEvidence).toContain(
        "Verified JSX runtime build evidence is required.",
      );
      expect(result.originalJudgment).toEqual(review.judgment);
      expect(review.judgment.judgment).toBe("valid");
    },
  );
  it("keeps an evidence-complete result eligible", () => {
    expect(
      finalizeSolReview(review, {
        ...candidate,
        buildEvidence: { jsxRuntime: "automatic", files: [] },
      }).verdict,
    ).toBe("fp");
  });
  it("requires a verified contract when the rule requests one", () => {
    const contractCandidate = {
      ...candidate,
      rule: { ...candidate.rule, requiredEvidence: ["verified-contract" as const] },
    };
    expect(finalizeSolReview(review, contractCandidate).verdict).toBe("unresolved");
    expect(
      finalizeSolReview(review, {
        ...contractCandidate,
        rule: { ...contractCandidate.rule, contractHash: "a".repeat(64) },
      }).verdict,
    ).toBe("fp");
  });
  it("also keeps potential false negatives unresolved without the required evidence", () => {
    expect(
      finalizeSolReview(
        { ...review, judgment: { ...review.judgment, judgment: "violation" } },
        { ...candidate, detected: false },
      ).verdict,
    ).toBe("unresolved");
  });
});
