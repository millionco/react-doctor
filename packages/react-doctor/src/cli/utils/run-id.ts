import { randomUUID } from "node:crypto";

// One random id per CLI run (process), generated lazily and memoized on first
// read. It rides the Sentry `run` context (and thus the per-scan root spans /
// wide events).
//
// A workspace invocation that scans several projects shares one `runId` across
// them by design: it's a single CLI run, and the per-project span attributes
// disambiguate which project a given span belongs to.
//
// Deliberately never used as a Sentry tag or metric attribute: a per-run unique
// value there would explode tag/counter cardinality. It belongs only on
// events/spans via `contexts.run`.
let cachedRunId: string | undefined;

export const getRunId = (): string => {
  cachedRunId ??= randomUUID();
  return cachedRunId;
};
