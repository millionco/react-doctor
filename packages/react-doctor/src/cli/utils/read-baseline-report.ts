import fs from "node:fs";
import * as Schema from "effect/Schema";
import { JsonReport, type JsonReportV3 } from "@react-doctor/core/schemas";
import { CliInputError } from "./cli-input-error.js";

export const readBaselineReport = (file: string): JsonReportV3 => {
  try {
    const report = Schema.decodeUnknownSync(JsonReport)(JSON.parse(fs.readFileSync(file, "utf-8")));
    if (
      !report.ok ||
      report.mode === "baseline" ||
      ("baselineDegraded" in report && report.baselineDegraded) ||
      report.projects.length === 0 ||
      report.projects.some(
        (project) =>
          project.skippedChecks.length > 0 ||
          project.diagnostics.some((diagnostic) => diagnostic.fingerprint === undefined),
      ) ||
      (report.schemaVersion === 3 &&
        (report.skippedProjects?.length || report.projects.some((project) => !project.complete))) ||
      report.diagnostics.some((diagnostic) => diagnostic.fingerprint === undefined)
    ) {
      throw new Error(
        "Use a complete, non-comparison --json report from the current version, with diagnostic fingerprints.",
      );
    }
    if (
      report.schemaVersion !== 3 ||
      report.projects.some((project) => !project.sourceFilterConfigHash)
    ) {
      throw new Error(
        "Regenerate the base --json report with the current version to record its source-dependent filter settings.",
      );
    }
    return report;
  } catch (error) {
    throw new CliInputError(
      `Cannot read baseline report "${file}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
