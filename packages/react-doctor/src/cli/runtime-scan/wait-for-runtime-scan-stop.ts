import * as readline from "node:readline/promises";
import { assertRuntimeScanInteractive } from "./assert-runtime-scan-interactive.js";
import { RUNTIME_SCAN_MAX_RECORDING_DURATION_MS } from "./constants.js";

export const waitForRuntimeScanStop = async (): Promise<void> => {
  assertRuntimeScanInteractive();
  const interfaceHandle = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(
    () => timeoutController.abort(),
    RUNTIME_SCAN_MAX_RECORDING_DURATION_MS,
  );
  try {
    await interfaceHandle
      .question(
        "Recording runtime performance. Interact with the page, then press Enter to stop.\n",
        {
          signal: timeoutController.signal,
        },
      )
      .catch((cause: unknown) => {
        if (!timeoutController.signal.aborted) throw cause;
      });
  } finally {
    clearTimeout(timeoutHandle);
    interfaceHandle.close();
  }
};
