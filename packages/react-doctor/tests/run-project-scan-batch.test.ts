import { PROJECT_SCANS_IN_FLIGHT_PER_OXLINT_WORKER } from "@react-doctor/core";
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

  it("keeps several projects in flight per oxlint worker", async () => {
    const oxlintConcurrency = 2;
    const projectCount = oxlintConcurrency * PROJECT_SCANS_IN_FLIGHT_PER_OXLINT_WORKER * 2;
    let inFlight = 0;
    let peakInFlight = 0;
    const scanProject = async (project: number): Promise<ProjectScanOutcome<number, never>> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { status: "completed", value: project };
    };

    const result = await runProjectScanBatch({
      projects: Array.from({ length: projectCount }, (_, index) => index),
      isQuiet: true,
      isSilent: false,
      oxlintConcurrency,
      scanProject,
    });

    expect(peakInFlight).toBe(oxlintConcurrency * PROJECT_SCANS_IN_FLIGHT_PER_OXLINT_WORKER);
    expect(result.completedScans).toEqual(
      Array.from({ length: projectCount }, (_, index) => index),
    );
  });
});
