import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeScanReport } from "../src/cli/runtime-scan/build-runtime-scan-report.js";
import { formatRuntimeScanReport } from "../src/cli/runtime-scan/format-runtime-scan-report.js";
import { resolveRuntimeScanFormat } from "../src/cli/runtime-scan/resolve-runtime-scan-format.js";
import { sanitizeRuntimeUrl } from "../src/cli/runtime-scan/sanitize-runtime-url.js";
import type { RuntimeScanProbeSnapshot } from "../src/cli/runtime-scan/types.js";
import { scrubRunArguments } from "../src/cli/utils/scrub-run-arguments.js";

const snapshot: RuntimeScanProbeSnapshot = {
  timeOrigin: 1_000,
  finalUrl: "https://example.com/dashboard?token=secret#private",
  support: {
    reactDetected: true,
    reactVersion: "19.2.0",
    reactBuildType: "development",
    nativeReactTracks: true,
    bippyComponentTracks: false,
    loaf: true,
  },
  longAnimationFrames: [
    {
      startTime: 100,
      durationMs: 120,
      blockingDurationMs: 70,
      renderStart: 150,
      styleAndLayoutStart: 180,
      firstUiEventTimestamp: 90,
      scripts: [
        {
          invoker: "BUTTON#save.onclick",
          invokerType: "event-listener",
          sourceUrl: "https://example.com/assets/app.js",
          sourceFunctionName: "save",
          sourceCharPosition: 42,
          executionStart: 110,
          durationMs: 80,
          forcedStyleAndLayoutDurationMs: 30,
          pauseDurationMs: 0,
        },
      ],
    },
  ],
  componentEvents: [
    {
      name: "SaveButton",
      startTime: 115,
      durationMs: 40,
      depth: 2,
      source: "native",
    },
    {
      name: "SaveButton",
      startTime: 160,
      durationMs: 20,
      depth: 2,
      source: "native",
    },
  ],
  interactions: [
    {
      name: "click",
      startTime: 90,
      durationMs: 130,
      processingStart: 100,
      processingEnd: 180,
      interactionId: 1,
      targetTag: "BUTTON",
    },
  ],
  cumulativeLayoutShift: 0.02,
  largestContentfulPaintMs: 800,
  droppedLongAnimationFrames: 0,
  droppedScriptTimings: 0,
  droppedComponentEvents: 0,
  droppedInteractions: 0,
};

const buildReport = (probeSnapshot: RuntimeScanProbeSnapshot = snapshot) =>
  buildRuntimeScanReport({
    requestedUrl: "https://user:password@example.com/dashboard?token=secret#private",
    tracePath: "/tmp/runtime.json.gz",
    capturedAt: "2026-08-15T00:00:00.000Z",
    durationMs: 5_000,
    snapshot: probeSnapshot,
    connection: "isolated",
  });

describe("runtime scan report", () => {
  it("aggregates script and component hotspots", () => {
    const report = buildReport();
    expect(report.summary.worstFrameDurationMs).toBe(120);
    expect(report.summary.totalBlockingDurationMs).toBe(70);
    expect(report.scriptHotspots[0]).toMatchObject({
      functionName: "save",
      totalDurationMs: 80,
      forcedStyleAndLayoutDurationMs: 30,
    });
    expect(report.componentHotspots[0]).toMatchObject({
      name: "SaveButton",
      renderCount: 2,
      totalDurationMs: 60,
    });
  });

  it("removes credentials, query strings, and fragments from report URLs", () => {
    const report = buildReport();
    expect(report.requestedUrl).toBe("https://example.com/dashboard");
    expect(report.finalUrl).toBe("https://example.com/dashboard");
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("groups browser events that belong to one interaction", () => {
    const report = buildReport({
      ...snapshot,
      interactions: [
        {
          name: "pointerdown",
          startTime: 90,
          durationMs: 130,
          processingStart: 100,
          processingEnd: 110,
          interactionId: 1,
          targetTag: "BUTTON",
        },
        {
          name: "pointerup",
          startTime: 91,
          durationMs: 130,
          processingStart: 111,
          processingEnd: 120,
          interactionId: 1,
          targetTag: "BUTTON",
        },
        {
          name: "click",
          startTime: 91,
          durationMs: 130,
          processingStart: 121,
          processingEnd: 180,
          interactionId: 1,
          targetTag: "BUTTON",
        },
      ],
    });
    expect(report.summary.interactionCount).toBe(1);
    expect(report.interactions).toEqual([
      {
        name: "click",
        startTime: 90,
        durationMs: 130,
        processingStart: 100,
        processingEnd: 180,
        interactionId: 1,
        targetTag: "BUTTON",
      },
    ]);
  });

  it("formats text, JSON, and JSONL outputs", () => {
    const report = buildReport();
    expect(formatRuntimeScanReport(report, "text")).toContain("React component hotspots");
    expect(JSON.parse(formatRuntimeScanReport(report, "json"))).toMatchObject({
      schemaVersion: 1,
      kind: "react-doctor-runtime-scan",
    });
    const jsonlRecords = formatRuntimeScanReport(report, "jsonl")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(jsonlRecords.some((record) => record.kind === "component-hotspot")).toBe(true);
    expect(jsonlRecords.some((record) => record.kind === "long-animation-frame")).toBe(true);
    expect(jsonlRecords.some((record) => record.kind === "interaction")).toBe(true);
  });
});

describe("runtime scan input", () => {
  it("validates formats and URL protocols", () => {
    expect(resolveRuntimeScanFormat(undefined)).toBe("text");
    expect(resolveRuntimeScanFormat("jsonl")).toBe("jsonl");
    expect(() => resolveRuntimeScanFormat("xml")).toThrow("--format must be one of");
    expect(() => sanitizeRuntimeUrl("file:///tmp/index.html")).toThrow("http(s)");
  });

  it("removes runtime URLs from telemetry arguments", () => {
    expect(
      scrubRunArguments([
        "scan",
        "https://example.internal/dashboard?token=secret",
        "--cdp",
        "ws://127.0.0.1:9222/devtools/browser/private",
        "--callback=https://example.internal/private",
      ]),
    ).toBe("scan <url> --cdp <url> --callback=<url>");
  });
});
