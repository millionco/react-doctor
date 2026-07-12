import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeHeapProfiles } from "../../../scripts/performance/analyze-heap-profile.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const buildCallFrame = (functionName: string, url: string, lineNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
});

const writeHeapProfile = (filename: string, profile: unknown): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-heap-profile-test-"));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(profile));
  return directory;
};

describe("analyzeHeapProfiles", () => {
  it("aggregates V8 sampled allocations into self and total bytes", () => {
    const directory = writeHeapProfile("Heap.test.heapprofile", {
      head: {
        callFrame: buildCallFrame("(root)", ""),
        selfSize: 0,
        id: 1,
        children: [
          {
            callFrame: buildCallFrame("allocate", "packages/react-doctor/dist/cli.js", 9),
            selfSize: 1_024,
            id: 2,
            children: [],
          },
        ],
      },
      samples: [],
    });

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
  });

  it("rejects heap profile graphs with duplicate node IDs", () => {
    const callFrame = buildCallFrame("(root)", "");
    const directory = writeHeapProfile("Heap.cyclic.heapprofile", {
      head: {
        callFrame,
        selfSize: 0,
        id: 1,
        children: [
          {
            callFrame,
            selfSize: 1,
            id: 2,
            children: [{ callFrame, selfSize: 0, id: 1, children: [] }],
          },
        ],
      },
    });

    expect(() => analyzeHeapProfiles(directory)).toThrow("duplicate node IDs");
  });
});
