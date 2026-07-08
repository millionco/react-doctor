import { parentPort } from "node:worker_threads";
import type { DeslopConfig, ResolvedEntries } from "../types.js";
import { resolveEntries } from "./entries.js";

interface ResolveEntriesTaskMessage {
  readonly type: "resolve-entries";
  readonly config: DeslopConfig;
}

interface EntriesResultMessage {
  readonly type: "result";
  readonly entries: ResolvedEntries;
}

interface EntriesErrorMessage {
  readonly type: "error";
  readonly errorMessage: string;
}

const port = parentPort!;

port.on("message", (message: ResolveEntriesTaskMessage) => {
  if (message.type !== "resolve-entries") return;
  void resolveEntries(message.config).then(
    (entries) => {
      const response: EntriesResultMessage = { type: "result", entries };
      port.postMessage(response);
    },
    (taskError: unknown) => {
      const response: EntriesErrorMessage = {
        type: "error",
        errorMessage: taskError instanceof Error ? taskError.message : String(taskError),
      };
      port.postMessage(response);
    },
  );
});

port.postMessage({ type: "ready" });
