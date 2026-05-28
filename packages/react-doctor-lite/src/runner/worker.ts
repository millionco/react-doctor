import { parentPort } from "node:worker_threads";
import { loadRulesByIds } from "../rules/load-rules.js";
import { lintSourcesInProcess } from "./lint-sources-in-process.js";
import { readSource } from "./read-source.js";
import type { LiteDiagnostic, LiteSource, WorkerTask } from "../types.js";

if (!parentPort) {
  throw new Error("react-doctor-lite worker must be started inside a worker thread");
}

const port = parentPort;

// Long-lived worker: rebuild the gated rule set per task (cheap — visitor
// factories are reused references), read + lint each assigned file, and post
// the diagnostics back. The pool keeps the worker alive for the next batch.
port.on("message", (task: WorkerTask) => {
  const rules = loadRulesByIds(task.enabledRuleIds, task.severityById);
  const sources: LiteSource[] = [];
  for (const filePath of task.filePaths) {
    const source = readSource(filePath);
    if (source) sources.push(source);
  }
  const diagnostics: LiteDiagnostic[] = lintSourcesInProcess({
    sources,
    rules,
    settings: task.settings,
  });
  port.postMessage(diagnostics);
});
