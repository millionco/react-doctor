import { flushSentry } from "../../instrument.js";
import { shutdownTelemetry } from "./telemetry-runtime.js";
import { activeScanAbortRegistry } from "./active-scan-abort-registry.js";
import { preserveActiveTuiRendererOutput } from "./active-tui-renderer.js";
import { buildFooterLinkLines } from "./build-footer-link-lines.js";
import { buildSectionDivider } from "./build-section-divider.js";
import { SIGINT_EXIT_CODE } from "./constants.js";
import { isJsonModeActive, writeJsonErrorReport } from "./json-mode.js";

let didStartExiting = false;

export const exitGracefully = (): void => {
  // A repeat SIGINT during the telemetry flush terminates immediately instead
  // of printing the cancellation footer twice.
  if (didStartExiting) return process.exit(SIGINT_EXIT_CODE);
  didStartExiting = true;
  try {
    activeScanAbortRegistry.abortAll();
  } catch {}
  try {
    preserveActiveTuiRendererOutput();
  } catch {}
  try {
    if (isJsonModeActive()) {
      writeJsonErrorReport(new Error("Scan cancelled by user (SIGINT/SIGTERM)"));
    } else {
      // HACK: use raw console.log instead of the Effect-based cliLogger
      // because Effect.runSync throws when called from a SIGINT handler
      // while an async Effect fiber is running (e.g. score animation).
      console.log(
        [
          "",
          "Cancelled.",
          "",
          buildSectionDivider(),
          "",
          ...buildFooterLinkLines({ shareUrl: null }),
        ].join("\n"),
      );
    }
  } catch {}
  // HACK: process.exit drops buffered telemetry (e.g. tui.cancelled), so run
  // one bounded flush of both backends after printing and before terminating.
  void Promise.all([flushSentry(), shutdownTelemetry()]).finally(() =>
    process.exit(SIGINT_EXIT_CODE),
  );
};
