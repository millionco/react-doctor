import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { analyzeHeapProfiles } from "../../../scripts/performance/analyze-heap-profile.ts";

describe("analyzeHeapProfiles", () => {
  it("aggregates V8 sampled allocations into self and total bytes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-heap-profile-test-"));
    try {
      fs.writeFileSync(
        path.join(directory, "Heap.test.heapprofile"),
        JSON.stringify({
          head: {
            callFrame: {
              functionName: "(root)",
              url: "",
              lineNumber: 0,
              columnNumber: 0,
            },
            selfSize: 0,
            id: 1,
            children: [
              {
                callFrame: {
                  functionName: "allocate",
                  url: "packages/react-doctor/dist/cli.js",
                  lineNumber: 9,
                  columnNumber: 0,
                },
                selfSize: 1_024,
                id: 2,
                children: [],
              },
            ],
          },
          samples: [],
        }),
      );
      const analysis = analyzeHeapProfiles(directory);
      expect(analysis.sampledBytes).toBe(1_024);
      expect(analysis.processes).toHaveLength(1);
      expect(analysis.processes[0]?.role).toBe("react-doctor");
      expect(analysis.aggregateTopFrames[0]).toMatchObject({
        functionName: "allocate",
        selfBytes: 1_024,
        totalBytes: 1_024,
        selfPercent: 100,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
