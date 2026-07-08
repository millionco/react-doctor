import type { Worker } from "node:worker_threads";
import type { DeslopConfig, ResolvedEntries } from "../types.js";
import { resolveEntries } from "./entries.js";
import { launchSiblingWorker } from "./launch-worker.js";

interface EntriesWorkerReadyMessage {
  readonly type: "ready";
}

interface EntriesWorkerResultMessage {
  readonly type: "result";
  readonly entries: ResolvedEntries;
}

interface EntriesWorkerErrorMessage {
  readonly type: "error";
  readonly errorMessage: string;
}

type EntriesWorkerMessage =
  | EntriesWorkerReadyMessage
  | EntriesWorkerResultMessage
  | EntriesWorkerErrorMessage;

interface EntriesWorkerInfraFailure {
  readonly kind: "infra-failure";
}

interface EntriesWorkerAnalysisError {
  readonly kind: "analysis-error";
  readonly errorMessage: string;
}

interface EntriesWorkerSuccess {
  readonly kind: "result";
  readonly entries: ResolvedEntries;
}

type EntriesWorkerOutcome =
  | EntriesWorkerSuccess
  | EntriesWorkerAnalysisError
  | EntriesWorkerInfraFailure;

/**
 * Runs `resolveEntries` on a dedicated worker thread so its ~90%-synchronous
 * fs work overlaps the main-thread analysis phases — the incremental-cache
 * warm path has no long parse `await` left to hide it behind. Entry content
 * reads stay live (fresh every run) exactly as inline. Worker infrastructure
 * failures fall back to the inline call (same result, just serialized); an
 * error thrown by `resolveEntries` itself rejects with the same message an
 * inline throw would, so the caller's fallback-to-empty-entries handling is
 * unchanged.
 */
export const resolveEntriesInWorker = async (config: DeslopConfig): Promise<ResolvedEntries> => {
  let worker: Worker;
  try {
    worker = launchSiblingWorker(import.meta.url, "entries-worker");
  } catch {
    return resolveEntries(config);
  }
  try {
    const outcome = await new Promise<EntriesWorkerOutcome>((resolveOutcome) => {
      worker.on("message", (message: EntriesWorkerMessage) => {
        if (message.type === "ready") {
          worker.postMessage({ type: "resolve-entries", config });
        } else if (message.type === "result") {
          resolveOutcome({ kind: "result", entries: message.entries });
        } else if (message.type === "error") {
          resolveOutcome({ kind: "analysis-error", errorMessage: message.errorMessage });
        }
      });
      worker.on("error", () => resolveOutcome({ kind: "infra-failure" }));
      worker.on("exit", () => resolveOutcome({ kind: "infra-failure" }));
    });
    if (outcome.kind === "result") return outcome.entries;
    if (outcome.kind === "analysis-error") throw new Error(outcome.errorMessage);
    return resolveEntries(config);
  } finally {
    void worker.terminate();
  }
};
