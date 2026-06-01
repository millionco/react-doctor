import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  flushSentry,
  initializeSentry,
  isSentryTracingEnabled,
  resolveSentryEnvironment,
  resolveSentryRelease,
  resolveTracesSampleRate,
} from "../src/instrument.js";
import { SENTRY_DEFAULT_TRACES_SAMPLE_RATE } from "../src/cli/utils/constants.js";

const SENTRY_ENVIRONMENT_VARIABLES = [
  "SENTRY_RELEASE",
  "SENTRY_ENVIRONMENT",
  "SENTRY_TRACES_SAMPLE_RATE",
] as const;

describe("instrument config resolvers", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const name of SENTRY_ENVIRONMENT_VARIABLES) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of SENTRY_ENVIRONMENT_VARIABLES) {
      const previous = savedEnv[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  describe("resolveSentryRelease", () => {
    it("defaults to the `react-doctor@<version>` form", () => {
      expect(resolveSentryRelease()).toMatch(/^react-doctor@/);
    });

    it("honors the SENTRY_RELEASE override", () => {
      process.env.SENTRY_RELEASE = "react-doctor@9.9.9";
      expect(resolveSentryRelease()).toBe("react-doctor@9.9.9");
    });
  });

  describe("resolveSentryEnvironment", () => {
    it("defaults to a known deployment environment", () => {
      expect(["production", "development"]).toContain(resolveSentryEnvironment());
    });

    it("honors the SENTRY_ENVIRONMENT override", () => {
      process.env.SENTRY_ENVIRONMENT = "staging";
      expect(resolveSentryEnvironment()).toBe("staging");
    });
  });

  describe("resolveTracesSampleRate", () => {
    it("defaults when unset", () => {
      expect(resolveTracesSampleRate()).toBe(SENTRY_DEFAULT_TRACES_SAMPLE_RATE);
    });

    it("reads a valid in-range rate", () => {
      process.env.SENTRY_TRACES_SAMPLE_RATE = "0";
      expect(resolveTracesSampleRate()).toBe(0);
      process.env.SENTRY_TRACES_SAMPLE_RATE = "0.25";
      expect(resolveTracesSampleRate()).toBe(0.25);
      process.env.SENTRY_TRACES_SAMPLE_RATE = "1";
      expect(resolveTracesSampleRate()).toBe(1);
    });

    it("falls back to the default for out-of-range or non-numeric values", () => {
      for (const invalid of ["2", "-1", "abc", ""]) {
        process.env.SENTRY_TRACES_SAMPLE_RATE = invalid;
        expect(resolveTracesSampleRate()).toBe(SENTRY_DEFAULT_TRACES_SAMPLE_RATE);
      }
    });
  });

  describe("tracing/flush gating without an active client", () => {
    it("initializeSentry is a no-op under tests (VITEST), leaving the SDK uninitialized", () => {
      expect(() => initializeSentry()).not.toThrow();
      expect(isSentryTracingEnabled()).toBe(false);
    });

    it("flushSentry resolves without throwing when Sentry is not initialized", async () => {
      await expect(flushSentry()).resolves.toBeUndefined();
    });
  });
});
