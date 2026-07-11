import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeCpuProfiles } from "../../../scripts/performance/analyze-cpu-profile.ts";

describe("analyzeCpuProfiles", () => {
  it("aggregates V8 sample deltas into self and total time", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-cpu-profile-test-"));
    try {
      fs.writeFileSync(
        path.join(directory, "CPU.test.cpuprofile"),
        JSON.stringify({
          nodes: [
            {
              id: 1,
              callFrame: {
                functionName: "(root)",
                url: "",
                lineNumber: 0,
                columnNumber: 0,
              },
              children: [2],
            },
            {
              id: 2,
              callFrame: {
                functionName: "runWork",
                url: "packages/react-doctor/dist/cli.js",
                lineNumber: 9,
                columnNumber: 0,
              },
            },
          ],
          samples: [2, 2],
          timeDeltas: [1_000, 2_000],
        }),
      );
      const analysis = analyzeCpuProfiles(directory);
      expect(analysis.sampledMicroseconds).toBe(3_000);
      expect(analysis.processes).toHaveLength(1);
      expect(analysis.processes[0]?.role).toBe("react-doctor");
      expect(analysis.aggregateTopFrames[0]).toMatchObject({
        functionName: "runWork",
        selfMicroseconds: 3_000,
        totalMicroseconds: 3_000,
        selfPercent: 100,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects cyclic CPU profile node graphs", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-cpu-profile-test-"));
    try {
      fs.writeFileSync(
        path.join(directory, "CPU.cyclic.cpuprofile"),
        JSON.stringify({
          nodes: [
            {
              id: 1,
              callFrame: {
                functionName: "(root)",
                url: "",
                lineNumber: 0,
                columnNumber: 0,
              },
              children: [2],
            },
            {
              id: 2,
              callFrame: {
                functionName: "runWork",
                url: "packages/react-doctor/dist/cli.js",
                lineNumber: 9,
                columnNumber: 0,
              },
              children: [1],
            },
          ],
          samples: [2],
          timeDeltas: [1_000],
        }),
      );

      expect(() => analyzeCpuProfiles(directory)).toThrow("cyclic nodes");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
