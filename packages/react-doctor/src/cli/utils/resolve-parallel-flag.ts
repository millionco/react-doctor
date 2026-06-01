import { MIN_SCAN_CONCURRENCY } from "@react-doctor/core";

/**
 * Maps the `--no-parallel` flag to an `InspectOptions.concurrency` value.
 * `--no-parallel` (`parallel === false`) pins serial, overriding any
 * env-enabled default; otherwise `undefined` defers to the ambient
 * `OxlintConcurrency` default (parallel, unless `REACT_DOCTOR_PARALLEL`
 * sets a worker count — the flag itself no longer takes one).
 */
export const resolveParallelFlag = (parallel: boolean | undefined): number | undefined =>
  parallel === false ? MIN_SCAN_CONCURRENCY : undefined;
