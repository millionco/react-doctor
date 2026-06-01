import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import {
  FORCE_ONBOARDING_ENV_VAR,
  isOnboardingForced,
  ONBOARDING_SECTION_DELAY_MS,
  onboardingSectionPause,
  shouldRecordOnboarding,
} from "../src/cli/utils/onboarding-pacing.js";

describe("isOnboardingForced", () => {
  it("is false when the flag is unset", () => {
    expect(isOnboardingForced({})).toBe(false);
  });

  it("is true for truthy values", () => {
    expect(isOnboardingForced({ [FORCE_ONBOARDING_ENV_VAR]: "1" })).toBe(true);
    expect(isOnboardingForced({ [FORCE_ONBOARDING_ENV_VAR]: "true" })).toBe(true);
  });

  it("is false for explicit falsy values", () => {
    expect(isOnboardingForced({ [FORCE_ONBOARDING_ENV_VAR]: "0" })).toBe(false);
    expect(isOnboardingForced({ [FORCE_ONBOARDING_ENV_VAR]: "false" })).toBe(false);
    expect(isOnboardingForced({ [FORCE_ONBOARDING_ENV_VAR]: "" })).toBe(false);
  });
});

describe("shouldRecordOnboarding", () => {
  const baseInput = {
    paceOnboardingSections: true,
    forceOnboarding: false,
    verbose: false,
    isNonInteractiveEnvironment: false,
  };

  it("records after an interactive onboarding reveal", () => {
    expect(shouldRecordOnboarding(baseInput)).toBe(true);
  });

  it("does not record when pacing was off (no reveal)", () => {
    expect(shouldRecordOnboarding({ ...baseInput, paceOnboardingSections: false })).toBe(false);
  });

  it("does not record a forced demo, so it stays replayable", () => {
    expect(shouldRecordOnboarding({ ...baseInput, forceOnboarding: true })).toBe(false);
  });

  it("does not record a verbose run (static review, no reveal)", () => {
    expect(shouldRecordOnboarding({ ...baseInput, verbose: true })).toBe(false);
  });

  it("does not record a non-interactive run (defensive double-check)", () => {
    expect(shouldRecordOnboarding({ ...baseInput, isNonInteractiveEnvironment: true })).toBe(false);
  });
});

describe("onboardingSectionPause", () => {
  it("is a no-op when pacing is off", async () => {
    expect(onboardingSectionPause(false)).toBe(Effect.void);

    const start = performance.now();
    await Effect.runPromise(onboardingSectionPause(false));
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("waits the configured delay when pacing is on", async () => {
    expect(ONBOARDING_SECTION_DELAY_MS).toBe(850);

    const start = performance.now();
    await Effect.runPromise(onboardingSectionPause(true));
    // Generous lower bound: a real sleep never returns early, but timer
    // granularity / CI jitter can shave a few milliseconds off the wall clock.
    expect(performance.now() - start).toBeGreaterThanOrEqual(700);
  });
});
