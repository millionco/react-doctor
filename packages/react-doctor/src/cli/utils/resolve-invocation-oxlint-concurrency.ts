import * as Effect from "effect/Effect";
import { OxlintConcurrency, resolveScanConcurrency } from "@react-doctor/core";

/**
 * The invocation-wide oxlint worker count: an explicit `--concurrency` pin
 * when given, else the env-seeded / auto-budgeted `OxlintConcurrency`, clamped
 * to the spawn ceiling. Every project of a workspace scan shares this one
 * pool, so it also sizes how many projects may be in flight at once.
 */
export const resolveInvocationOxlintConcurrency = (requestedConcurrency?: number): number =>
  resolveScanConcurrency(requestedConcurrency ?? Effect.runSync(OxlintConcurrency));
