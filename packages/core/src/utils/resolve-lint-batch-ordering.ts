// How the full-scan lint pass orders its file batches. `"cost"` (the default)
// feeds the largest files first (LPT); `"arrival"` keeps discovery order — the
// one-env-var revert for the kill-metric cohort (§ rollout). The env var is
// read in one place so the `LintBatchOrdering` Reference (which gates the
// runtime behavior) and the CLI's `lintBatchOrdering` telemetry tag (which
// labels the cohort) can never disagree.
export const resolveLintBatchOrdering = (): "cost" | "arrival" => {
  const raw = process.env["REACT_DOCTOR_LINT_BATCH_ORDERING"]?.trim().toLowerCase();
  return raw === "arrival" ? "arrival" : "cost";
};
