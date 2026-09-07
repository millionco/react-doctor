import { checkSecurityScanCooperative } from "../../check-security-scan.js";
import {
  decodeSecurityScanWorkerOptions,
  parseSecurityScanWorkerRequest,
  parseSecurityScanWorkerResult,
  type SecurityScanWorkerFailure,
  type SecurityScanWorkerSuccess,
} from "./security-scan-worker-protocol.js";

export const startSecurityScanWorker = (): void => {
  if (process.send === undefined) throw new Error("Security scan worker requires an IPC channel.");
  let activeController: AbortController | null = null;
  let activeId: number | null = null;
  let shuttingDown = false;
  const shutdown = (): void => {
    shuttingDown = true;
    activeController?.abort();
    if (process.connected) process.disconnect?.();
  };
  const send = (
    message: SecurityScanWorkerSuccess | SecurityScanWorkerFailure | { readonly type: "ready" },
  ): void => {
    if (!process.connected || shuttingDown) return;
    process.send?.(message, (error) => {
      if (error) {
        process.exitCode = 1;
        shutdown();
      }
    });
  };
  process.on("disconnect", () => {
    shuttingDown = true;
    activeController?.abort();
    if (activeController === null) process.exit();
  });
  process.on("message", (value: unknown) => {
    if (shuttingDown) return;
    try {
      const request = parseSecurityScanWorkerRequest(value);
      if (request.type === "abort") {
        if (request.id === activeId) activeController?.abort();
        return;
      }
      if (activeController !== null)
        throw new Error("Security scan worker received overlapping jobs.");
      const controller = new AbortController();
      activeController = controller;
      activeId = request.id;
      void (async () => {
        let didReachDeadline = false;
        let result: SecurityScanWorkerSuccess | SecurityScanWorkerFailure;
        try {
          const diagnostics = await checkSecurityScanCooperative(request.rootDirectory, {
            ...decodeSecurityScanWorkerOptions(request.options),
            signal: controller.signal,
            onDeadlineExceeded: () => {
              didReachDeadline = true;
            },
          });
          result = parseSecurityScanWorkerResult({
            type: "result",
            id: request.id,
            ok: true,
            diagnostics,
            didReachDeadline,
          });
        } catch (error) {
          result = {
            type: "result",
            id: request.id,
            ok: false,
            didReachDeadline,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : { name: "Error", message: String(error) },
          };
        }
        activeController = null;
        activeId = null;
        if (shuttingDown) process.exit();
        send(result);
      })().catch(() => {
        process.exitCode = 1;
        shutdown();
      });
    } catch {
      process.exitCode = 1;
      shutdown();
    }
  });
  send({ type: "ready" });
};
