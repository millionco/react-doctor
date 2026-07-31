import { OxlintSpawnFailed, ReactDoctorError } from "../errors.js";
import { createWorkerSlots } from "./create-worker-slots.js";
import type { WorkerSlots } from "./create-worker-slots.js";
import { resolveScanConcurrency } from "./resolve-scan-concurrency.js";

const createLintPhaseAbortError = (): ReactDoctorError =>
  new ReactDoctorError({
    reason: new OxlintSpawnFailed({ cause: "lint phase aborted" }),
  });

export const createOxlintSpawnSlots = (concurrency: number): WorkerSlots =>
  createWorkerSlots({
    slotCount: resolveScanConcurrency(concurrency),
    createAbortError: createLintPhaseAbortError,
  });
