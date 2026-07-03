// How the full-scan lint pass plans its file batches. `"cost"` (the default)
// builds worker-count-aware, size-balanced LPT batches via `planLintBatches`
// — the heavy files are SPREAD across batches (the precondition that kept the
// old sort-desc-then-chunk-100 `cost` mode from earning the default; that
// mode packed the heaviest files into one wave-1 straggler batch). Set
// `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to roll back to plain greedy
// 100-file chunking in discovery order. The env var is read in one place so
// the `LintBatchOrdering` Reference (runtime behavior) and the CLI's
// `lintBatchOrdering` telemetry tag (cohort label) can never disagree.
export const resolveLintBatchOrdering = (): "cost" | "arrival" => {
  const raw = process.env["REACT_DOCTOR_LINT_BATCH_ORDERING"]?.trim().toLowerCase();
  return raw === "arrival" ? "arrival" : "cost";
};
