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
): PartitionedProjectScanOutcomes<Scan, SkippedScan> => {
  const completedScans: Scan[] = [];
  const skippedScans: SkippedScan[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "completed") {
      completedScans.push(outcome.value);
      continue;
    }
    if (outcome.status === "skipped") skippedScans.push(outcome.value);
  }
  return { completedScans, skippedScans };
};
