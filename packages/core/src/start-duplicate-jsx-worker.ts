import { parentPort } from "node:worker_threads";
import { createJsxSourceReader } from "./react-cleanup/create-jsx-source-reader.js";
import { detectDuplicateJsxSubtreesCooperative } from "./react-cleanup/detect-duplicate-jsx-subtrees.js";
import type {
  DuplicateJsxWorkerCommand,
  DuplicateJsxWorkerDetectMessage,
  DuplicateJsxWorkerReply,
  SerializedDuplicateJsxWorkerError,
} from "./react-cleanup/duplicate-jsx-worker-protocol.js";

const serializeError = (error: unknown): SerializedDuplicateJsxWorkerError =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

const isWorkerCommand = (value: unknown): value is DuplicateJsxWorkerCommand =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value.type === "detect" || value.type === "abort") &&
  "id" in value &&
  typeof value.id === "number";

export const startDuplicateJsxWorker = (): void => {
  if (parentPort === null) throw new Error("Duplicate JSX worker must run as a worker thread.");
  const port = parentPort;
  const abortControllersById = new Map<number, AbortController>();
  let queue: Promise<void> = Promise.resolve();

  const reply = (message: DuplicateJsxWorkerReply): void => port.postMessage(message);

  const detect = async (request: DuplicateJsxWorkerDetectMessage): Promise<void> => {
    const abortController = abortControllersById.get(request.id);
    if (abortController === undefined) return;
    try {
      const result = await detectDuplicateJsxSubtreesCooperative(
        createJsxSourceReader({
          rootDirectory: request.rootDirectory,
          sourceFiles: request.sourceFiles,
          useBlockingReads: true,
        }),
        { signal: abortController.signal },
      );
      reply({ id: request.id, ok: true, result });
    } catch (error) {
      reply({ id: request.id, ok: false, error: serializeError(error) });
    } finally {
      abortControllersById.delete(request.id);
    }
  };

  port.on("message", (message: unknown) => {
    if (!isWorkerCommand(message)) return;
    if (message.type === "abort") {
      abortControllersById.get(message.id)?.abort();
      return;
    }
    abortControllersById.set(message.id, new AbortController());
    queue = queue.then(() => detect(message));
  });
};
