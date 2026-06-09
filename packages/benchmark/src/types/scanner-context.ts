// Shared, read-only input every scanner receives. Built once by the
// orchestrator so each scanner sees the same view of the graded diff.
export interface ScannerContext {
  // Absolute path to the project under test (the repo the agent edited).
  rootDirectory: string;
  // Repo-relative paths of the files the agent changed, already filtered to
  // gradable source (tests, fixtures, generated, and lockfiles removed).
  changedFiles: string[];
  // Base git ref the agent started from, used for diff-scoped scans.
  baseRef: string;
  // Total added lines across `changedFiles`, the basis for size-normalization.
  addedLineCount: number;
  // Absolute path to the React Doctor CLI entry to invoke. Lets the sandbox
  // image point at a pinned binary; falls back to `react-doctor` on PATH.
  reactDoctorBin: string;
}
