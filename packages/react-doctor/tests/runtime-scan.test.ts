import { describe, expect, it } from "vite-plus/test";
import { runtimeScanAction } from "../src/cli/commands/runtime-scan.js";
import { assertRuntimeScanCdpProfile } from "../src/cli/runtime-scan/assert-runtime-scan-cdp-profile.js";
import { buildRuntimeScanReport } from "../src/cli/runtime-scan/build-runtime-scan-report.js";
import {
  RUNTIME_SCAN_MAX_COMPONENT_EVENTS,
  RUNTIME_SCAN_MAX_LOAF_ENTRIES,
  RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES,
  RUNTIME_SCAN_MAX_STRING_LENGTH,
} from "../src/cli/runtime-scan/constants.js";
import { formatRuntimeScanReport } from "../src/cli/runtime-scan/format-runtime-scan-report.js";
import { mergeRuntimeScanProbeSnapshots } from "../src/cli/runtime-scan/merge-runtime-scan-probe-snapshots.js";
import {
  isRuntimeScanProbeSnapshot,
  parseRuntimeScanSnapshotPayload,
} from "../src/cli/runtime-scan/parse-runtime-scan-snapshot-payload.js";
import { resolveRuntimeScanFormat } from "../src/cli/runtime-scan/resolve-runtime-scan-format.js";
import { resolveRuntimeTracePath } from "../src/cli/runtime-scan/resolve-runtime-trace-path.js";
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
    expect(report.timeOrigin).toBe(1_000);
    expect(report.scriptHotspots[0]).toMatchObject({
      functionName: "save",
      sourceCharPosition: 42,
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

  it("keeps script hotspots at different source positions separate", () => {
    const report = buildReport({
      ...snapshot,
      longAnimationFrames: [
        snapshot.longAnimationFrames[0],
        {
          ...snapshot.longAnimationFrames[0],
          scripts: [
            {
              ...snapshot.longAnimationFrames[0].scripts[0],
              sourceCharPosition: 84,
            },
          ],
        },
      ],
    });
    expect(report.scriptHotspots).toHaveLength(2);
    expect(report.scriptHotspots.map((hotspot) => hotspot.sourceCharPosition)).toEqual([42, 84]);
  });

  it("counts distinct long frames for repeated script invocations", () => {
    const repeatedScript = snapshot.longAnimationFrames[0].scripts[0];
    const report = buildReport({
      ...snapshot,
      longAnimationFrames: [
        {
          ...snapshot.longAnimationFrames[0],
          scripts: [repeatedScript, repeatedScript],
        },
      ],
    });
    expect(report.scriptHotspots[0].frameCount).toBe(1);
  });

  it("counts frames separately when normalized timestamps collide", () => {
    const mergedSnapshot = mergeRuntimeScanProbeSnapshots([
      snapshot,
      {
        ...snapshot,
        timeOrigin: 1_100,
        longAnimationFrames: [
          {
            ...snapshot.longAnimationFrames[0],
            startTime: 0,
          },
        ],
      },
    ]);
    expect(buildReport(mergedSnapshot).scriptHotspots[0].frameCount).toBe(2);
  });

  it("merges probe evidence across document navigations", () => {
    const mergedSnapshot = mergeRuntimeScanProbeSnapshots([
      snapshot,
      {
        ...snapshot,
        timeOrigin: 2_000,
        finalUrl: "https://example.com/settings",
        longAnimationFrames: [
          {
            ...snapshot.longAnimationFrames[0],
            startTime: 10,
          },
        ],
        componentEvents: [
          {
            ...snapshot.componentEvents[0],
            startTime: 20,
          },
        ],
        interactions: [
          {
            ...snapshot.interactions[0],
            startTime: 30,
            interactionId: 1,
          },
        ],
      },
      {
        ...snapshot,
        finalUrl: "https://example.com/dashboard-returned",
        componentEvents: [
          ...snapshot.componentEvents,
          {
            ...snapshot.componentEvents[0],
            startTime: 200,
          },
        ],
      },
    ]);
    expect(mergedSnapshot.finalUrl).toBe("https://example.com/dashboard-returned");
    expect(
      mergedSnapshot.longAnimationFrames.some(
        (longAnimationFrame) => longAnimationFrame.startTime === 1_010,
      ),
    ).toBe(true);
    expect(mergedSnapshot.componentEvents).toHaveLength(4);
    expect(
      mergedSnapshot.componentEvents.some((componentEvent) => componentEvent.startTime === 1_020),
    ).toBe(true);
    expect(mergedSnapshot.interactions.map((interaction) => interaction.documentIndex)).toEqual([
      0, 1,
    ]);
    expect(mergedSnapshot.cumulativeLayoutShift).toBe(0.02);
    expect(buildReport(mergedSnapshot).summary.interactionCount).toBe(2);
  });

  it("retains the latest long animation frames when navigation exceeds the limit", () => {
    const earliestFrames = Array.from(
      { length: RUNTIME_SCAN_MAX_LOAF_ENTRIES },
      (_unusedValue, index) => ({
        ...snapshot.longAnimationFrames[0],
        startTime: index,
      }),
    );
    const mergedSnapshot = mergeRuntimeScanProbeSnapshots([
      {
        ...snapshot,
        longAnimationFrames: earliestFrames,
      },
      {
        ...snapshot,
        timeOrigin: 2_000,
        longAnimationFrames: [
          {
            ...snapshot.longAnimationFrames[0],
            startTime: 100,
          },
        ],
      },
    ]);
    expect(mergedSnapshot.longAnimationFrames).toHaveLength(RUNTIME_SCAN_MAX_LOAF_ENTRIES);
    expect(
      mergedSnapshot.longAnimationFrames.some(
        (longAnimationFrame) => longAnimationFrame.startTime === 0,
      ),
    ).toBe(false);
    expect(mergedSnapshot.longAnimationFrames.at(-1)?.startTime).toBe(1_100);
    expect(mergedSnapshot.droppedLongAnimationFrames).toBe(1);
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

  it("removes terminal control characters from text output", () => {
    const report = buildReport({
      ...snapshot,
      componentEvents: [
        {
          ...snapshot.componentEvents[0],
          name: "Save\u001B]52;c;clipboard\u0007Button",
        },
      ],
    });
    const textReport = formatRuntimeScanReport(report, "text");
    expect(textReport).not.toContain("\u001B]52");
    expect(textReport).not.toContain("\u0007");
    expect(formatRuntimeScanReport(report, "json")).toContain("\\u001b");
  });
});

describe("runtime scan input", () => {
  it("requires an explicit URL outside an interactive terminal", async () => {
    await expect(runtimeScanAction(undefined, { format: "text" })).rejects.toThrow(
      "A URL is required outside an interactive terminal",
    );
  });

  it("validates formats and URL protocols", () => {
    expect(resolveRuntimeScanFormat(undefined)).toBe("text");
    expect(resolveRuntimeScanFormat("jsonl")).toBe("jsonl");
    expect(() => resolveRuntimeScanFormat("xml")).toThrow("--format must be one of");
    expect(() => sanitizeRuntimeUrl("file:///tmp/index.html")).toThrow("http(s)");
  });

  it("requires a dedicated blank CDP profile", () => {
    expect(() => assertRuntimeScanCdpProfile(["about:blank", "chrome://newtab/"])).not.toThrow();
    expect(() =>
      assertRuntimeScanCdpProfile(["about:blank", "https://example.com/private"]),
    ).toThrow("includes every open tab");
  });

  it("creates unpredictable default trace paths", () => {
    const capturedAt = new Date("2026-08-15T00:00:00.000Z");
    const firstPath = resolveRuntimeTracePath(undefined, capturedAt);
    const secondPath = resolveRuntimeTracePath(undefined, capturedAt);
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath.endsWith(".json.gz")).toBe(true);
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

  it("rejects malformed and oversized browser snapshot payloads", () => {
    const token = "expected-token";
    const validPayloadSnapshot = {
      ...snapshot,
      finalUrl: "https://example.com/dashboard",
    };
    expect(
      parseRuntimeScanSnapshotPayload(
        JSON.stringify({ token, snapshot: validPayloadSnapshot }),
        token,
      ),
    ).toEqual(validPayloadSnapshot);
    expect(
      parseRuntimeScanSnapshotPayload(
        JSON.stringify({
          token,
          snapshot: {
            ...validPayloadSnapshot,
            droppedInteractions: -1,
          },
        }),
        token,
      ),
    ).toBeNull();
    expect(
      parseRuntimeScanSnapshotPayload(
        JSON.stringify({ token: "wrong-token", snapshot: validPayloadSnapshot }),
        token,
      ),
    ).toBeNull();
    expect(
      parseRuntimeScanSnapshotPayload(
        "x".repeat(RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES + 1),
        token,
      ),
    ).toBeNull();
    expect(
      isRuntimeScanProbeSnapshot({
        ...validPayloadSnapshot,
        timeOrigin: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
    expect(
      isRuntimeScanProbeSnapshot({
        ...validPayloadSnapshot,
        longAnimationFrames: [
          {
            ...snapshot.longAnimationFrames[0],
            scripts: [
              {
                ...snapshot.longAnimationFrames[0].scripts[0],
                sourceCharPosition: -1,
              },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      isRuntimeScanProbeSnapshot({
        ...validPayloadSnapshot,
        componentEvents: Array.from(
          { length: RUNTIME_SCAN_MAX_COMPONENT_EVENTS },
          (_unusedValue, index) => ({
            name: `${index}${"x".repeat(RUNTIME_SCAN_MAX_STRING_LENGTH - String(index).length)}`,
            startTime: index,
            durationMs: 1,
            depth: 0,
            source: "native",
          }),
        ),
      }),
    ).toBe(false);
  });
});
