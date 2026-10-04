import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  ClassificationCandidate,
  ClassificationResult,
} from "../src/classification-schema.js";
import type { SolJudgment, SolSource } from "../src/sol-review-schema.js";
import { validateSolCitations } from "../src/utils/validate-sol-citations.js";
import { resolveSolCitationLines } from "../src/utils/resolve-sol-citation-lines.js";
import { getClassificationCost } from "../src/utils/get-classification-cost.js";

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generateText,
}));
vi.mock("../src/utils/load-pinned-rule-source.js", () => ({
  loadPinnedRuleSource: async () => "No duplicate explicit props.",
}));

const candidate: ClassificationCandidate = {
  schemaVersion: 2,
  repository: { org: "example", name: "fixture", ref: "a".repeat(40), rootDir: "." },
  detectorCommit: "b".repeat(40),
  ruleSetHash: "c".repeat(64),
  rule: {
    key: "react-doctor/jsx-no-duplicate-props",
    description: "No duplicate props",
    exceptions: [],
  },
  filePath: "app.tsx",
  line: 2,
  detected: true,
  framework: "react",
  code: 'export const App = () => (\n  <div id="one" />\n);',
  contextComplete: true,
};
const sources: SolSource[] = [
  {
    filePath: candidate.filePath,
    code: candidate.code,
    sha256: createHash("sha256").update(candidate.code).digest("hex"),
  },
];
const judgment: SolJudgment = {
  judgment: "valid",
  reason: "The attribute occurs once.",
  evidence: [{ filePath: "app.tsx", startLine: 2, endLine: 2, quote: '  <div id="one" />' }],
  missingEvidence: [],
};

describe("independent Sol review", () => {
  it("sums each gateway step once without counting cost breakdowns twice", () => {
    expect(
      getClassificationCost([
        {
          providerMetadata: {
            gateway: { cost: "0.1", marketCost: "0.1", inputInferenceCost: "0.08" },
          },
        },
        { providerMetadata: { gateway: { cost: "0.2" } } },
      ]),
    ).toBeCloseTo(0.3);
    expect(getClassificationCost({ skipped: true })).toBeNull();
    expect(
      getClassificationCost({ providerMetadata: { gateway: { cost: "not-a-number" } } }),
    ).toBeNull();
  });
  it("relocates only an exact unique quote and preserves ambiguous quotes", () => {
    const misplaced = {
      ...judgment,
      evidence: [{ ...judgment.evidence[0], startLine: 1, endLine: 1 }],
    };
    expect(resolveSolCitationLines(misplaced, sources).evidence[0].startLine).toBe(2);
    const repeated = [{ ...sources[0], code: `${candidate.code}\n${candidate.code}` }];
    expect(resolveSolCitationLines(misplaced, repeated).evidence[0].startLine).toBe(1);
    expect(
      resolveSolCitationLines(
        { ...judgment, evidence: [{ ...judgment.evidence[0], quote: "invented source" }] },
        sources,
      ).evidence[0].quote,
    ).toBe("invented source");
  });
  it("checks exact source text, file identity, and focus coverage", () => {
    expect(validateSolCitations(judgment, sources, candidate)).toEqual([]);
    expect(
      validateSolCitations(
        { ...judgment, evidence: [{ ...judgment.evidence[0], quote: '<div id="one" />' }] },
        sources,
        candidate,
      ),
    ).toHaveLength(1);
    expect(
      validateSolCitations(
        { ...judgment, evidence: [{ ...judgment.evidence[0], filePath: "invented.tsx" }] },
        sources,
        candidate,
      ).length,
    ).toBeGreaterThan(0);
    expect(validateSolCitations({ ...judgment, evidence: [] }, sources, candidate)).toHaveLength(1);
    expect(
      validateSolCitations(
        { ...judgment, judgment: "insufficient_context", evidence: [] },
        sources,
        candidate,
      ),
    ).toEqual([]);
  });

  it("withholds Jev answers and downgrades invalid evidence", async () => {
    const { reviewWithSol } = await import("../src/review-with-sol.js");
    const screening: ClassificationResult = {
      schemaVersion: 2,
      id: "d".repeat(64),
      candidate,
      model: "typesafe-ai/jev",
      promptVersion: "test",
      threshold: 0.9,
      verdict: "candidate_fp",
      assessment: null,
    };
    mocks.generateText.mockResolvedValue({
      output: judgment,
      totalUsage: { inputTokens: 10, outputTokens: 5 },
      steps: [],
    });
    expect((await reviewWithSol(screening)).verdict).toBe("fp");
    const request = mocks.generateText.mock.calls.at(-1)?.[0];
    expect(request.prompt).not.toContain("candidate_fp");
    expect(request.prompt).not.toContain('"detected"');
    expect(request.prompt).not.toContain('"assessment"');
    mocks.generateText.mockResolvedValue({
      output: { ...judgment, evidence: [] },
      totalUsage: {},
      steps: [],
    });
    expect((await reviewWithSol(screening)).verdict).toBe("unresolved");
    const previousCalls = mocks.generateText.mock.calls.length;
    const missingSource = await reviewWithSol({
      ...screening,
      candidate: {
        ...candidate,
        code: "",
        contextComplete: false,
        contextIssue: "Source is unavailable",
      },
    });
    expect(missingSource.judgment.judgment).toBe("insufficient_context");
    expect(mocks.generateText.mock.calls.length).toBe(previousCalls);
  });
});
