import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveAxiomTelemetryOptions } from "../src/cli/utils/resolve-axiom-telemetry-options.js";

const TELEMETRY_ENVIRONMENT_VARIABLES = [
  "VITEST",
  "NODE_ENV",
  "REACT_DOCTOR_NO_TELEMETRY",
  "REACT_DOCTOR_AXIOM_TOKEN",
  "REACT_DOCTOR_AXIOM_DOMAIN",
  "REACT_DOCTOR_AXIOM_DATASET",
  "REACT_DOCTOR_AXIOM_METRICS_DATASET",
  "AXIOM_TOKEN",
  "AXIOM_DOMAIN",
  "AXIOM_DATASET",
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

describe("resolveAxiomTelemetryOptions", () => {
  it("does not enable Axiom without an explicit token", () => {
    expect(resolveAxiomTelemetryOptions()).toBeNull();
  });

  it("ignores Axiom's own unprefixed environment variables", () => {
    process.env.AXIOM_TOKEN = "someone-elses-token";
    process.env.AXIOM_DOMAIN = "https://someone-elses-host.invalid";
    process.env.AXIOM_DATASET = "someone-elses-dataset";

    expect(resolveAxiomTelemetryOptions()).toBeNull();
  });

  it("honors the REACT_DOCTOR_-prefixed overrides", () => {
    process.env.REACT_DOCTOR_AXIOM_TOKEN = "our-token";
    process.env.REACT_DOCTOR_AXIOM_DOMAIN = "https://example.invalid";
    process.env.REACT_DOCTOR_AXIOM_DATASET = "our-traces";
    process.env.REACT_DOCTOR_AXIOM_METRICS_DATASET = "our-metrics";

    const options = resolveAxiomTelemetryOptions();

    expect(options?.domain).toBe("https://example.invalid");
    expect(options?.tracesDataset).toBe("our-traces");
    expect(options?.metricsDataset).toBe("our-metrics");
    expect(Redacted.value(options?.token ?? Redacted.make(""))).toBe("our-token");
  });

  it("stays null when telemetry is opted out even with a token present", () => {
    process.env.REACT_DOCTOR_AXIOM_TOKEN = "our-token";
    process.env.REACT_DOCTOR_NO_TELEMETRY = "1";

    expect(resolveAxiomTelemetryOptions()).toBeNull();
  });
});
