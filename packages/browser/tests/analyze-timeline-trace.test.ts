import { describe, expect, it } from "vite-plus/test";
import { analyzeTimelineTrace } from "../src/analyze-timeline-trace.js";

describe("analyzeTimelineTrace", () => {
  it("rolls up duration, count, and longest per phase (microseconds to ms)", () => {
    const timeline = analyzeTimelineTrace([
      { name: "UpdateLayoutTree", dur: 60_000 },
      { name: "UpdateLayoutTree", dur: 25_500 },
      { name: "Layout", dur: 40_000 },
      { name: "HitTest", dur: 68_000 },
      { name: "Paint", dur: 5_000 },
    ]);

    expect(timeline.styleRecalc).toEqual({ totalMs: 85.5, count: 2, longestMs: 60 });
    expect(timeline.layout).toEqual({ totalMs: 40, count: 1, longestMs: 40 });
    expect(timeline.hitTest).toEqual({ totalMs: 68, count: 1, longestMs: 68 });
    expect(timeline.paint).toEqual({ totalMs: 5, count: 1, longestMs: 5 });
  });

  it("ignores unrelated events and entries without a numeric duration", () => {
    const timeline = analyzeTimelineTrace([
      { name: "RunTask", dur: 99_000 },
      { name: "Layout" },
      { name: "Layout", dur: "nope" },
      { name: 42, dur: 10_000 },
    ]);

    expect(timeline.layout).toEqual({ totalMs: 0, count: 0, longestMs: 0 });
  });

  it("returns a fully-zeroed analysis for an empty trace", () => {
    const timeline = analyzeTimelineTrace([]);
    expect(timeline).toEqual({
      styleRecalc: { totalMs: 0, count: 0, longestMs: 0 },
      layout: { totalMs: 0, count: 0, longestMs: 0 },
      hitTest: { totalMs: 0, count: 0, longestMs: 0 },
      paint: { totalMs: 0, count: 0, longestMs: 0 },
    });
  });
});
