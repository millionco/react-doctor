// How the full-scan lint pass orders its file batches. `"arrival"` (the
// default) keeps `git ls-files` discovery order; `"cost"` opts into LPT
// (largest files first). NOTE: `cost` defaults OFF because the current
// sort-desc-then-chunk-100 builds a single wave-1 batch out of the heaviest
// files — on size-skewed repos (e.g. a few large `*.test` files among many
// tiny modules) that mega-batch becomes a straggler (and can trip the
// per-batch timeout + binary-split), measurably REGRESSING the common
// full-scan case rather than helping it. LPT needs the heavy files SPREAD
// across batches (interleave/deal), not concentrated, before `cost` should be
// the default. Until then `cost` is an env opt-in for repos it demonstrably
// helps. The env var is read in one place so the `LintBatchOrdering` Reference
// (runtime behavior) and the CLI's `lintBatchOrdering` telemetry tag (cohort
// label) can never disagree.
export const resolveLintBatchOrdering = (): "cost" | "arrival" => {
  const raw = process.env["REACT_DOCTOR_LINT_BATCH_ORDERING"]?.trim().toLowerCase();
  return raw === "cost" ? "cost" : "arrival";
};
