import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CI_ENVIRONMENT_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";

// Intercept the lazy `import("@sentry/node")` inside error-tracking.ts so
// nothing is sent and we can inspect exactly what `captureException`
// receives. The static and dynamic imports resolve to the same mocked
// module object, so the spies below are the ones the module calls.
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

import * as Sentry from "@sentry/node";
import { captureCliError, initErrorTracking } from "../src/cli/utils/error-tracking.js";
import { VERSION } from "../src/cli/utils/version.js";

const ENVIRONMENT_VARIABLES = [
  "CI",
  ...CI_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  "REACT_DOCTOR_OTLP_ENDPOINT",
  "REACT_DOCTOR_OTLP_AUTH_HEADER",
] as const;

interface CaptureContext {
  tags: Record<string, unknown>;
  contexts: { "react-doctor": Record<string, unknown> };
}

const lastCapture = (): { error: unknown; context: CaptureContext } => {
  const calls = vi.mocked(Sentry.captureException).mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) throw new Error("captureException was not called");
  return { error: lastCall[0], context: lastCall[1] as unknown as CaptureContext };
};

describe("captureCliError enrichment", () => {
  let savedEnv: Record<string, string | undefined>;
  let savedArgv: string[];

  beforeAll(async () => {
    process.env.REACT_DOCTOR_ERROR_REPORTING = "1";
    await initErrorTracking();
    delete process.env.REACT_DOCTOR_ERROR_REPORTING;
  });

  beforeEach(() => {
    savedArgv = process.argv;
    savedEnv = {};
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      savedEnv[envVariable] = process.env[envVariable];
      delete process.env[envVariable];
    }
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.flush).mockClear();
  });

  afterEach(() => {
    process.argv = savedArgv;
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      const previousValue = savedEnv[envVariable];
      if (previousValue === undefined) {
        delete process.env[envVariable];
      } else {
        process.env[envVariable] = previousValue;
      }
    }
  });

  it("captures the error, flushes, and tags a local inspect run", async () => {
    process.argv = ["node", "react-doctor", "."];
    const error = new Error("boom");

    await captureCliError(error);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.flush).toHaveBeenCalledTimes(1);

    const { error: capturedError, context } = lastCapture();
    expect(capturedError).toBe(error);
    // Default origin + default (no-subcommand) action.
    expect(context.tags.origin).toBe("top-level");
    expect(context.tags.command).toBe("inspect");
    expect(context.tags.ci).toBe(false);
    expect(context.tags["ci.provider"]).toBe("none");
    expect(context.tags.coding_agent).toBe("none");
    expect(context.tags.platform).toBe(process.platform);
    expect(context.tags["node.version"]).toBe(process.version);
    expect(typeof context.tags.interactive).toBe("boolean");

    const reactDoctor = context.contexts["react-doctor"];
    expect(reactDoctor.version).toBe(VERSION);
    expect(reactDoctor.ci).toBe(false);
    expect(reactDoctor.otlpEndpointConfigured).toBe(false);
  });

  it("identifies CI provider, coding agent, command, and origin", async () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.CLAUDECODE = "1";
    process.argv = ["node", "react-doctor", "install", "--yes"];

    await captureCliError(new Error("crash in CI"), "uncaughtException");

    const { context } = lastCapture();
    expect(context.tags.origin).toBe("uncaughtException");
    expect(context.tags.command).toBe("install");
    expect(context.tags.ci).toBe(true);
    expect(context.tags["ci.provider"]).toBe("GITHUB_ACTIONS");
    expect(context.tags.coding_agent).toBe("CLAUDECODE");

    const reactDoctor = context.contexts["react-doctor"];
    expect(reactDoctor.origin).toBe("uncaughtException");
    expect(reactDoctor.command).toBe("install");
    expect(reactDoctor.argv).toBe("install --yes");
    expect(reactDoctor.ciProvider).toBe("GITHUB_ACTIONS");
    expect(reactDoctor.codingAgent).toBe("CLAUDECODE");
  });

  it("falls back to the generic CI marker and reflects OTLP config", async () => {
    process.env.CI = "true";
    process.env.REACT_DOCTOR_OTLP_ENDPOINT = "https://api.axiom.co";

    await captureCliError(new Error("generic ci"), "unhandledRejection");

    const { context } = lastCapture();
    expect(context.tags.origin).toBe("unhandledRejection");
    expect(context.tags.ci).toBe(true);
    expect(context.tags["ci.provider"]).toBe("generic");
    expect(context.contexts["react-doctor"].otlpEndpointConfigured).toBe(true);
  });
});
