import { SIGINT_EXIT_CODE } from "./constants.js";
import { isJsonModeActive, writeJsonErrorReport } from "./json-mode.js";

export const exitGracefully = (): void => {
  try {
    if (isJsonModeActive()) {
      writeJsonErrorReport(new Error("Scan cancelled by user (SIGINT/SIGTERM)"));
    } else {
      // HACK: use raw console.log instead of the Effect-based cliLogger
      // because Effect.runSync throws when called from a SIGINT handler
      // while an async Effect fiber is running (e.g. score animation).
      console.log("\nCancelled.\n");
    }
  } catch {}
  process.exit(SIGINT_EXIT_CODE);
};
