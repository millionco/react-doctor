import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import { isRecord } from "./is-record-with-fields.ts";
import type { ReadBenchmarkReportInput, ValidatedBenchmarkReport } from "./types.ts";

const projectSourceFileCount = (project: unknown): number => {
  if (isRecord(project) && typeof project.sourceFileCount === "number") {
    return project.sourceFileCount;
  }
  throw new Error("Benchmark report project has no sourceFileCount");
};

export const readBenchmarkReport = (input: ReadBenchmarkReportInput): ValidatedBenchmarkReport => {
  const report = Schema.decodeUnknownSync(JsonReport)(
    JSON.parse(fs.readFileSync(input.reportPath, "utf8")),
  );
  if (!report.ok || report.error !== null) {
    throw new Error(
      `Benchmark scan reported an error: ${report.error?.message ?? "unknown error"}`,
    );
  }
  if (report.projects.length === 0) throw new Error("Benchmark scan reported no projects");
  if (path.resolve(report.directory) !== path.resolve(input.targetDirectory)) {
    throw new Error(
      `Benchmark report target mismatch: expected ${input.targetDirectory}, received ${report.directory}`,
    );
  }
  const skippedChecks = report.projects.flatMap((project) => project.skippedChecks);
  if (skippedChecks.length > 0) {
    throw new Error(`Benchmark scan degraded: ${skippedChecks.join(", ")}`);
  }
  const scannedFileCount = report.projects.reduce(
    (total, project) =>
      total + (project.scannedFileCount ?? projectSourceFileCount(project.project)),
    0,
  );
  return {
    elapsedMilliseconds: report.elapsedMilliseconds,
    diagnosticCount: report.diagnostics.length,
    diagnosticHash: createHash("sha256").update(JSON.stringify(report.diagnostics)).digest("hex"),
    scannedFileCount,
  };
};
