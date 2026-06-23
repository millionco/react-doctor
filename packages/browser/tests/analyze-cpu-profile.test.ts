import { describe, expect, it } from "vite-plus/test";
import { analyzeCpuProfile, type CdpCpuProfile } from "../src/analyze-cpu-profile.js";

const frame = (
  functionName: string,
  url = "",
  lineNumber = 0,
): CdpCpuProfile["nodes"][number]["callFrame"] => ({
  functionName,
  url,
  lineNumber,
});

describe("analyzeCpuProfile", () => {
  it("attributes self time per function from samples and time deltas", () => {
    const profile: CdpCpuProfile = {
      startTime: 0,
      endTime: 10_000,
      nodes: [
        { id: 1, callFrame: frame("(root)") },
        { id: 2, callFrame: frame("render", "app.js", 41) },
        { id: 3, callFrame: frame("parse", "lib.js", 9) },
      ],
      samples: [2, 3, 2],
      timeDeltas: [4000, 3000, 3000],
    };

    const analysis = analyzeCpuProfile(profile);
    expect(analysis.durationMs).toBe(10);
    expect(analysis.sampleCount).toBe(3);

    const render = analysis.topFunctions[0];
    expect(render?.functionName).toBe("render");
    expect(render?.url).toBe("app.js:42");
    expect(render?.selfMs).toBe(7); // 4000us + 3000us
    expect(render?.selfPercent).toBe(70);

    const parse = analysis.topFunctions[1];
    expect(parse?.functionName).toBe("parse");
    expect(parse?.selfMs).toBe(3);
  });

  it("labels anonymous functions and null urls for synthetic frames", () => {
    const profile: CdpCpuProfile = {
      startTime: 0,
      endTime: 2000,
      nodes: [
        { id: 1, callFrame: frame("") },
        { id: 2, callFrame: frame("(idle)") },
      ],
      samples: [1, 2],
      timeDeltas: [1000, 1000],
    };
    const analysis = analyzeCpuProfile(profile);
    const anon = analysis.topFunctions.find((stat) => stat.functionName === "(anonymous)");
    const idle = analysis.topFunctions.find((stat) => stat.functionName === "(idle)");
    expect(anon?.url).toBeNull();
    expect(idle?.url).toBeNull();
  });

  it("falls back to hitCount when no sample stream is present", () => {
    const profile: CdpCpuProfile = {
      startTime: 0,
      endTime: 4000,
      nodes: [
        { id: 1, callFrame: frame("a", "a.js", 0), hitCount: 3 },
        { id: 2, callFrame: frame("b", "b.js", 0), hitCount: 1 },
      ],
    };
    const analysis = analyzeCpuProfile(profile);
    expect(analysis.sampleCount).toBe(0);
    expect(analysis.topFunctions[0]?.functionName).toBe("a");
    expect(analysis.topFunctions[0]?.selfMs).toBe(3); // 3/4 of 4ms
  });
});
