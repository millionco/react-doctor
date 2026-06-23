import { describe, expect, it } from "vite-plus/test";
import {
  DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS,
  DEAD_CODE_TIMEOUT_CEILING_MS,
  DEAD_CODE_TIMEOUT_MS_PER_SOURCE_FILE,
  DEAD_CODE_WORKER_TIMEOUT_MS,
} from "../src/constants.js";
import { resolveDeadCodeTimeout } from "../src/utils/resolve-dead-code-timeout.js";

const fullCores = 10;

describe("resolveDeadCodeTimeout", () => {
  it("floors a small repo at the fixed worker timeout (deslop needs a minimum)", () => {
    const { workerTimeoutMs, phaseTimeoutMs } = resolveDeadCodeTimeout({
      sourceFileCount: 50,
      deadCodeConcurrency: fullCores,
      fullConcurrency: fullCores,
    });
    expect(workerTimeoutMs).toBe(DEAD_CODE_WORKER_TIMEOUT_MS);
    expect(phaseTimeoutMs).toBe(
      DEAD_CODE_WORKER_TIMEOUT_MS + DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS,
    );
  });

  it("scales the budget with file count for a large repo (the regression this fixes)", () => {
    // ~8.9k files (Sentry-scale) where deslop legitimately runs ~120s+ and the
    // old fixed 120s cap was tipped over by any contention, dropping findings.
    const sourceFileCount = 8866;
    const { workerTimeoutMs, phaseTimeoutMs } = resolveDeadCodeTimeout({
      sourceFileCount,
      deadCodeConcurrency: fullCores,
      fullConcurrency: fullCores,
    });
    expect(workerTimeoutMs).toBe(sourceFileCount * DEAD_CODE_TIMEOUT_MS_PER_SOURCE_FILE);
    expect(workerTimeoutMs).toBeGreaterThan(DEAD_CODE_WORKER_TIMEOUT_MS);
    expect(phaseTimeoutMs).toBe(workerTimeoutMs + DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS);
  });

  it("scales up inversely with the core share when dead-code is overlapped onto fewer cores", () => {
    const sourceFileCount = 4000;
    const fullCore = resolveDeadCodeTimeout({
      sourceFileCount,
      deadCodeConcurrency: fullCores,
      fullConcurrency: fullCores,
    });
    const halfCore = resolveDeadCodeTimeout({
      sourceFileCount,
      deadCodeConcurrency: fullCores / 2,
      fullConcurrency: fullCores,
    });
    // Half the cores ⇒ deslop is ~2x slower ⇒ ~2x the budget so it still finishes.
    expect(halfCore.workerTimeoutMs).toBe(fullCore.workerTimeoutMs * 2);
  });

  it("caps a pathologically large repo at the ceiling so a wedged worker is still reclaimed", () => {
    const { workerTimeoutMs } = resolveDeadCodeTimeout({
      sourceFileCount: 10_000_000,
      deadCodeConcurrency: fullCores,
      fullConcurrency: fullCores,
    });
    expect(workerTimeoutMs).toBe(DEAD_CODE_TIMEOUT_CEILING_MS);
  });
});
