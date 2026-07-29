import { describe, expect, it } from "vite-plus/test";
import { buildDeadCodePlan } from "../src/build-dead-code-plan.js";
import type { ReactDoctorConfig } from "../src/types/index.js";

interface PlanOverrides {
  readonly runDeadCode?: boolean;
  readonly isDiffMode?: boolean;
  readonly showWarnings?: boolean;
  readonly userConfig?: ReactDoctorConfig | null;
  readonly overlapMode?: "auto" | "on" | "off";
  readonly scanConcurrency?: number;
}

const buildPlan = (overrides: PlanOverrides = {}) =>
  buildDeadCodePlan({
    runDeadCode: overrides.runDeadCode ?? true,
    isDiffMode: overrides.isDiffMode ?? false,
    showWarnings: overrides.showWarnings ?? true,
    userConfig: overrides.userConfig ?? null,
    overlapMode: overrides.overlapMode ?? "off",
    scanConcurrency: overrides.scanConcurrency ?? 10,
  });

describe("buildDeadCodePlan", () => {
  it("keeps disabled, diff, and hidden-warning scans out of the analyzer", () => {
    expect(buildPlan({ runDeadCode: false, overlapMode: "on" })).toEqual({
      shouldRun: false,
      shouldOverlap: false,
      parseConcurrency: undefined,
      lintConcurrency: 10,
    });
    expect(buildPlan({ isDiffMode: true, overlapMode: "on" })).toEqual({
      shouldRun: false,
      shouldOverlap: false,
      parseConcurrency: undefined,
      lintConcurrency: 10,
    });
    expect(buildPlan({ showWarnings: false, overlapMode: "on" })).toEqual({
      shouldRun: false,
      shouldOverlap: false,
      parseConcurrency: undefined,
      lintConcurrency: 10,
    });
  });

  it("runs hidden warnings when a dead-code severity override can surface them", () => {
    expect(
      buildPlan({
        showWarnings: false,
        userConfig: { categories: { Maintainability: "error" } },
      }),
    ).toEqual({
      shouldRun: true,
      shouldOverlap: false,
      parseConcurrency: undefined,
      lintConcurrency: 10,
    });
    expect(
      buildPlan({
        showWarnings: false,
        userConfig: { rules: { "deslop/unused-export": "warn" } },
      }),
    ).toEqual({
      shouldRun: true,
      shouldOverlap: false,
      parseConcurrency: undefined,
      lintConcurrency: 10,
    });
  });

  it("keeps auto and off modes sequential at the full lint concurrency", () => {
    for (const overlapMode of ["auto", "off"] as const) {
      expect(buildPlan({ overlapMode, scanConcurrency: 32 })).toEqual({
        shouldRun: true,
        shouldOverlap: false,
        parseConcurrency: undefined,
        lintConcurrency: 32,
      });
    }
  });

  it("preserves the overlap concurrency split at small and large worker counts", () => {
    expect(buildPlan({ overlapMode: "on", scanConcurrency: 1 })).toEqual({
      shouldRun: true,
      shouldOverlap: true,
      parseConcurrency: 1,
      lintConcurrency: 1,
    });
    expect(buildPlan({ overlapMode: "on", scanConcurrency: 2 })).toEqual({
      shouldRun: true,
      shouldOverlap: true,
      parseConcurrency: 1,
      lintConcurrency: 1,
    });
    expect(buildPlan({ overlapMode: "on", scanConcurrency: 10 })).toEqual({
      shouldRun: true,
      shouldOverlap: true,
      parseConcurrency: 4,
      lintConcurrency: 6,
    });
    expect(buildPlan({ overlapMode: "on", scanConcurrency: 32 })).toEqual({
      shouldRun: true,
      shouldOverlap: true,
      parseConcurrency: 12,
      lintConcurrency: 20,
    });
  });
});
