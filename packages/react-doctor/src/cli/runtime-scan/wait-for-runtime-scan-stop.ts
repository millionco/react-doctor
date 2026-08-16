import * as readline from "node:readline/promises";
import { assertRuntimeScanInteractive } from "./assert-runtime-scan-interactive.js";

export const waitForRuntimeScanStop = async (): Promise<void> => {
  assertRuntimeScanInteractive();
  const interfaceHandle = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  try {
    await interfaceHandle.question(
      "Recording runtime performance. Interact with the page, then press Enter to stop.\n",
    );
  } finally {
    interfaceHandle.close();
  }
};
