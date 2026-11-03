import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";

const TELEMETRY_ENVIRONMENT_VARIABLES = [
  "VITEST",
  "NODE_ENV",
  "REACT_DOCTOR_NO_TELEMETRY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const name of TELEMETRY_ENVIRONMENT_VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TELEMETRY_ENVIRONMENT_VARIABLES) {
    const previous = saved[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

describe("resolveInspectOptions - noScore resolution", () => {
  it("defaults noScore to false when telemetry is enabled", () => {
    const options = resolveInspectOptions({}, null);
    expect(options.noScore).toBe(false);
  });

  it("sets noScore to true when REACT_DOCTOR_NO_TELEMETRY=1", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";
    const options = resolveInspectOptions({}, null);
    expect(options.noScore).toBe(true);
  });

  it("sets noScore to true when REACT_DOCTOR_NO_TELEMETRY=true", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "true";
    const options = resolveInspectOptions({}, null);
    expect(options.noScore).toBe(true);
  });

  it("respects explicit noScore flag over env var", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";
    const options = resolveInspectOptions({ noScore: false }, null);
    expect(options.noScore).toBe(false);
  });

  it("respects config noScore over env var", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";
    const options = resolveInspectOptions({}, { noScore: false });
    expect(options.noScore).toBe(false);
  });

  it("prioritizes explicit flag > config > env var", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";
    const options = resolveInspectOptions({ noScore: false }, { noScore: true });
    expect(options.noScore).toBe(false);
  });

  it("falls back to config when flag is undefined", () => {
    const options = resolveInspectOptions({}, { noScore: true });
    expect(options.noScore).toBe(true);
  });

  it("falls back to env check when both flag and config are undefined", () => {
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";
    const options = resolveInspectOptions({}, {});
    expect(options.noScore).toBe(true);
  });
});
