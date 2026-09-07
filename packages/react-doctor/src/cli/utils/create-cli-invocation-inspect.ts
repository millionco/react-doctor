import * as Effect from "effect/Effect";
import {
  createSecurityScanWorker,
  isNativeOxlintRequired,
  MIN_SCAN_CONCURRENCY,
  OxlintConcurrency,
  resolveScanConcurrency,
} from "@react-doctor/core";
import { createInvocationInspect } from "../../inspect.js";

export interface CliInvocationInspect {
  readonly inspectProject: ReturnType<typeof createInvocationInspect>;
  readonly dispose: () => Promise<void>;
}

export const createCliInvocationInspect = (
  requestedOxlintConcurrency?: number,
): CliInvocationInspect => {
  const concurrency = resolveScanConcurrency(
    requestedOxlintConcurrency ?? Effect.runSync(OxlintConcurrency),
  );
  const worker =
    isNativeOxlintRequired() && concurrency > MIN_SCAN_CONCURRENCY
      ? createSecurityScanWorker()
      : null;
  return {
    inspectProject: createInvocationInspect(concurrency, worker?.run),
    dispose: async () => {
      await worker?.dispose();
    },
  };
};
