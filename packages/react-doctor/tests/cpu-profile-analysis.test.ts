import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeCpuProfiles } from "../../../scripts/performance/analyze-cpu-profile.ts";

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

const writeCpuProfile = (filename: string, profile: unknown): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-cpu-profile-test-"));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, filename), JSON.stringify(profile));
  return directory;
};

describe("analyzeCpuProfiles", () => {
  it("aggregates V8 sample deltas into self and total time", () => {
    const directory = writeCpuProfile("CPU.test.cpuprofile", {
      nodes: [
        { id: 1, callFrame: buildCallFrame("(root)", ""), children: [2] },
        { id: 2, callFrame: buildCallFrame("runWork", "packages/react-doctor/dist/cli.js", 9) },
      ],
      samples: [2, 2],
      timeDeltas: [1_000, 2_000],
    });

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
  });

  it("rejects cyclic CPU profile node graphs", () => {
    const directory = writeCpuProfile("CPU.cyclic.cpuprofile", {
      nodes: [
        { id: 1, callFrame: buildCallFrame("(root)", ""), children: [2] },
        {
          id: 2,
          callFrame: buildCallFrame("runWork", "packages/react-doctor/dist/cli.js", 9),
          children: [1],
        },
      ],
      samples: [2],
      timeDeltas: [1_000],
    });

    expect(() => analyzeCpuProfiles(directory)).toThrow("cyclic nodes");
  });
});
