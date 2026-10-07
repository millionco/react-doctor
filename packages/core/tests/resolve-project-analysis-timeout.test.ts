import { describe, expect, it } from "vite-plus/test";
import {
  PROJECT_ANALYSIS_WORKER_TIMEOUT_CEILING_MS,
  PROJECT_ANALYSIS_WORKER_TIMEOUT_MS,
  PROJECT_ANALYSIS_WORKER_TIMEOUT_MS_PER_SOURCE_FILE,
} from "../src/constants.js";
import { resolveProjectAnalysisTimeout } from "../src/utils/resolve-project-analysis-timeout.js";

describe("resolveProjectAnalysisTimeout", () => {
  it("uses the minimum timeout for small projects", () => {
    expect(resolveProjectAnalysisTimeout(50)).toBe(PROJECT_ANALYSIS_WORKER_TIMEOUT_MS);
  });

  it("scales with the source file count", () => {
    const sourceFileCount = 8_866;
    expect(resolveProjectAnalysisTimeout(sourceFileCount)).toBe(
      sourceFileCount * PROJECT_ANALYSIS_WORKER_TIMEOUT_MS_PER_SOURCE_FILE,
    );
  });

  it("caps the timeout for pathologically large projects", () => {
    expect(resolveProjectAnalysisTimeout(10_000_000)).toBe(
      PROJECT_ANALYSIS_WORKER_TIMEOUT_CEILING_MS,
    );
  });
});
