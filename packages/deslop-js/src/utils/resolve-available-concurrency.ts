import os from "node:os";
import { MIN_PARSE_CONCURRENCY, MAX_PARSE_CONCURRENCY } from "../constants.js";

const clampParseConcurrency = (value: number): number =>
  Math.max(MIN_PARSE_CONCURRENCY, Math.min(Math.floor(value), MAX_PARSE_CONCURRENCY));

export const resolveAvailableConcurrency = (): number => {
  // An embedding host that runs deslop alongside its own worker pool (e.g.
  // react-doctor, whose lint pass spawns one oxlint child per core) can cap
  // the parse pool via DESLOP_PARSE_CONCURRENCY so the two pools share the
  // cores instead of each claiming all of them and oversubscribing — the
  // contention that starves the parse pass past its host's phase timeout.
  const requestedConcurrency = Number(process.env["DESLOP_PARSE_CONCURRENCY"]);
  if (Number.isFinite(requestedConcurrency) && requestedConcurrency >= MIN_PARSE_CONCURRENCY) {
    return clampParseConcurrency(requestedConcurrency);
  }
  const available = os.availableParallelism();
  if (!Number.isFinite(available) || available < MIN_PARSE_CONCURRENCY) {
    return MIN_PARSE_CONCURRENCY;
  }
  return clampParseConcurrency(available);
};
