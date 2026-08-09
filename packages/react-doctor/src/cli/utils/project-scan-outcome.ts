interface CompletedProjectScanOutcome<Scan> {
  readonly status: "completed";
  readonly value: Scan;
}

interface SkippedProjectScanOutcome<SkippedScan> {
  readonly status: "skipped";
  readonly value: SkippedScan;
}

interface OmittedProjectScanOutcome {
  readonly status: "omitted";
}

export type ProjectScanOutcome<Scan, SkippedScan> =
  | CompletedProjectScanOutcome<Scan>
  | SkippedProjectScanOutcome<SkippedScan>
  | OmittedProjectScanOutcome;

interface PartitionedProjectScanOutcomes<Scan, SkippedScan> {
  readonly completedScans: Scan[];
  readonly skippedScans: SkippedScan[];
}

export const partitionProjectScanOutcomes = <Scan, SkippedScan>(
  outcomes: ReadonlyArray<ProjectScanOutcome<Scan, SkippedScan>>,
): PartitionedProjectScanOutcomes<Scan, SkippedScan> => ({
  completedScans: outcomes.flatMap((outcome) =>
    outcome.status === "completed" ? [outcome.value] : [],
  ),
  skippedScans: outcomes.flatMap((outcome) =>
    outcome.status === "skipped" ? [outcome.value] : [],
  ),
});
