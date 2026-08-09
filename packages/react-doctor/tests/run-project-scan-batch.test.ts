import { describe, expect, it } from "vite-plus/test";
import {
  type ProjectScanOutcome,
  runProjectScanBatch,
} from "../src/cli/utils/run-project-scan-batch.js";

describe("runProjectScanBatch", () => {
  it("partitions explicit outcomes in project order", async () => {
    const scanProject = async (project: number): Promise<ProjectScanOutcome<string, string>> => {
      if (project === 2) return { status: "skipped", value: "deadline" };
      if (project === 3) return { status: "omitted" };
      return { status: "completed", value: `project-${project}` };
    };

    const result = await runProjectScanBatch({
      projects: [1, 2, 3, 4],
      isQuiet: true,
      isSilent: false,
      scanProject,
    });

    expect(result.completedScans).toEqual(["project-1", "project-4"]);
    expect(result.skippedScans).toEqual(["deadline"]);
  });
});
