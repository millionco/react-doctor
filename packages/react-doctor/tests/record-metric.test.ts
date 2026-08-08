import * as os from "node:os";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { recordCount, recordDistribution } from "../src/cli/utils/record-metric.js";

// `isTelemetryEnabled()` is false under VITEST, which is what keeps this repo's
// own test runs from phoning home. Emitting anything therefore requires
// deliberately lifting that guard, and every test here restores it.
const withTelemetryEnabled = (body: () => void): void => {
  const previousVitest = process.env.VITEST;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.VITEST;
  delete process.env.NODE_ENV;
  try {
    body();
  } finally {
    if (previousVitest !== undefined) process.env.VITEST = previousVitest;
    if (previousNodeEnv !== undefined) process.env.NODE_ENV = previousNodeEnv;
  }
};

const findSnapshot = (name: string) =>
  Metric.snapshotUnsafe(Context.empty()).find((snapshot) => snapshot.id === name);

afterEach(() => {
  expect(process.env.VITEST).toBeDefined();
});

describe("record-metric when telemetry is disabled", () => {
  it("recordCount is an inert no-op rather than throwing into the caller's path", () => {
    expect(recordCount("cli.invoked", 1, { command: "inspect", ciProvider: null })).toBeUndefined();
    expect(() => recordCount("scan.completed")).not.toThrow();
  });

  it("recordDistribution does not throw", () => {
    expect(() =>
      recordDistribution("scan.duration", 123.4, {
        unit: "millisecond",
        attributes: { mode: "full" },
      }),
    ).not.toThrow();
  });

  it("records nothing into the metric registry", () => {
    recordCount("test.disabled.counter");

    expect(findSnapshot("test.disabled.counter")).toBeUndefined();
  });
});

describe("record-metric when telemetry is enabled", () => {
  it("writes a counter into the registry the OTLP exporter reads", () => {
    withTelemetryEnabled(() => {
      recordCount("test.enabled.counter", 3);
    });

    const snapshot = findSnapshot("test.enabled.counter");
    expect(snapshot?.type).toBe("Counter");
  });

  it("records a distribution as a histogram", () => {
    withTelemetryEnabled(() => {
      recordDistribution("test.enabled.duration", 42, { unit: "millisecond" });
    });

    expect(findSnapshot("test.enabled.duration")?.type).toBe("Histogram");
  });

  it("stringifies non-string attribute values, which Effect and Axiom both require", () => {
    withTelemetryEnabled(() => {
      recordCount("test.attribute.types", 1, { count: 7, enabled: true });
    });

    const attributes = findSnapshot("test.attribute.types")?.attributes;
    expect(attributes?.count).toBe("7");
    expect(attributes?.enabled).toBe("true");
  });

  it("drops null and undefined attributes instead of coercing them to strings", () => {
    withTelemetryEnabled(() => {
      recordCount("test.absent.attributes", 1, {
        present: "yes",
        absentSignal: null,
        alsoAbsent: undefined,
      });
    });

    // Deliberately not a run-scope key like `ciProvider`: those are supplied by
    // `buildSentryScope()` and a null passed at the call site is dropped rather
    // than clearing them, so such an assertion would pass locally and fail in CI.
    const attributes = findSnapshot("test.absent.attributes")?.attributes;
    expect(attributes?.present).toBe("yes");
    expect(attributes && "absentSignal" in attributes).toBe(false);
    expect(attributes && "alsoAbsent" in attributes).toBe(false);
  });

  it("anonymizes paths in attribute values now that no beforeSendMetric hook exists", () => {
    const homeDirectory = os.homedir();
    withTelemetryEnabled(() => {
      recordCount("test.scrubbed.attributes", 1, { directory: `${homeDirectory}/app` });
    });

    expect(findSnapshot("test.scrubbed.attributes")?.attributes?.directory).toBe("~/app");
  });

  it("records the distribution unit as an attribute", () => {
    withTelemetryEnabled(() => {
      recordDistribution("test.unit.attribute", 5, { unit: "millisecond" });
    });

    expect(findSnapshot("test.unit.attribute")?.attributes?.unit).toBe("millisecond");
  });
});
