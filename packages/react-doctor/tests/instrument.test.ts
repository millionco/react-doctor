import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Sentry from "@sentry/node";
import {
  flushSentry,
  initializeSentry,
  resolveSentryEnvironment,
  resolveSentryRelease,
} from "../src/instrument.js";

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

  describe("init/flush gating without an active client", () => {
    it("initializeSentry is a no-op under tests (VITEST), leaving the SDK uninitialized", () => {
      expect(() => initializeSentry()).not.toThrow();
      expect(Sentry.isInitialized()).toBe(false);
    });

    it("flushSentry resolves without throwing when Sentry is not initialized", async () => {
      await expect(flushSentry()).resolves.toBeUndefined();
    });
  });
});
