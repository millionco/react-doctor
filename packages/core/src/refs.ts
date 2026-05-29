import * as Context from "effect/Context";
import { OXLINT_OUTPUT_MAX_BYTES, OXLINT_SPAWN_TIMEOUT_MS } from "./constants.js";

/**
 * Per-batch oxlint wall-clock budget. Reads from the env var on
 * startup so the eval harness can raise the budget under sandbox
 * microVMs without recompiling react-doctor. Tests override via
 * `Layer.succeed(OxlintSpawnTimeoutMs, ...)`.
 */
export class OxlintSpawnTimeoutMs extends Context.Reference<number>(
  "react-doctor/OxlintSpawnTimeoutMs",
  {
    defaultValue: () => {
      const raw = process.env["REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS"];
      if (raw === undefined) return OXLINT_SPAWN_TIMEOUT_MS;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return OXLINT_SPAWN_TIMEOUT_MS;
      return parsed;
    },
  },
) {}

/**
 * Hard cap on combined stdout+stderr bytes per oxlint batch. The
 * subprocess gets SIGKILL'd if it produces more; the recovery path
 * suggests narrowing the scan with --diff. Override via Layer in
 * tests that exercise the cap behavior.
 */
export class OxlintOutputMaxBytes extends Context.Reference<number>(
  "react-doctor/OxlintOutputMaxBytes",
  {
    defaultValue: () => OXLINT_OUTPUT_MAX_BYTES,
  },
) {}
