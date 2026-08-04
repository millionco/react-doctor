import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { calculateScore } from "@react-doctor/core";
import { SCORE_RETRY_MAX_CONCURRENCY } from "../src/cli/utils/constants.js";
import { retryMissingProjectScores } from "../src/cli/utils/retry-missing-project-scores.js";
import { buildDiagnostic, buildTestProject } from "./regressions/_helpers.js";

vi.mock("@react-doctor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-doctor/core")>()),
  calculateScore: vi.fn(),
}));

const buildResult = (overrides: Partial<InspectResult> = {}): InspectResult => ({
  diagnostics: [buildDiagnostic()],
  score: null,
  skippedChecks: [],
  project: buildTestProject({ rootDirectory: "/repo" }),
  elapsedMilliseconds: 1,
  ...overrides,
});

describe("retryMissingProjectScores", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retries an otherwise complete project after the scan pool settles", async () => {
    vi.mocked(calculateScore).mockResolvedValue({ score: 88, label: "Good" });

    const [projectScan] = await retryMissingProjectScores([
      { result: buildResult(), config: null, isScoreDisabled: false },
    ]);

    expect(projectScan?.result.score).toEqual({ score: 88, label: "Good" });
    expect(calculateScore).toHaveBeenCalledOnce();
  });

  it("does not retry deliberate opt-outs or incomplete scans", async () => {
    await retryMissingProjectScores([
      { result: buildResult(), config: null, isScoreDisabled: true },
      {
        result: buildResult({ skippedChecks: ["dead-code"] }),
        config: null,
        isScoreDisabled: false,
      },
      {
        result: buildResult({ score: { score: 95, label: "Excellent" } }),
        config: null,
        isScoreDisabled: false,
      },
    ]);

    expect(calculateScore).not.toHaveBeenCalled();
  });

  it("uses higher concurrency after CPU-heavy project scans settle", async () => {
    let activeRequestCount = 0;
    let peakRequestCount = 0;
    vi.mocked(calculateScore).mockImplementation(async () => {
      activeRequestCount += 1;
      peakRequestCount = Math.max(peakRequestCount, activeRequestCount);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeRequestCount -= 1;
      return { score: 88, label: "Good" };
    });

    await retryMissingProjectScores(
      Array.from({ length: SCORE_RETRY_MAX_CONCURRENCY + 1 }, () => ({
        result: buildResult(),
        config: null,
        isScoreDisabled: false,
      })),
    );

    expect(peakRequestCount).toBe(SCORE_RETRY_MAX_CONCURRENCY);
  });
});
