import os from "node:os";
import { MIN_PARSE_CONCURRENCY, MAX_PARSE_CONCURRENCY } from "../constants.js";

export const resolveAvailableConcurrency = (): number => {
  const available = os.availableParallelism();
  if (!Number.isFinite(available) || available < MIN_PARSE_CONCURRENCY) {
    return MIN_PARSE_CONCURRENCY;
  }
  return Math.max(MIN_PARSE_CONCURRENCY, Math.min(Math.floor(available), MAX_PARSE_CONCURRENCY));
};
