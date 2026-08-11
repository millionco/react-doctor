import { type CliStateOptions, TELEMETRY_DISCLOSURE_EVENT } from "./cli-state-store.js";
import { type Gate, isGatePending, recordGate } from "./cli-lifecycle.js";
import { cliLogger } from "./cli-logger.js";
import { isTelemetryEnabled } from "./is-telemetry-enabled.js";

const TELEMETRY_DISCLOSURE_GATE: Gate = {
  id: TELEMETRY_DISCLOSURE_EVENT,
  scope: "global",
};

export const TELEMETRY_DISCLOSURE_LINES = [
  "React Doctor telemetry is on by default.",
  "Telemetry includes usage data and minimized, de-identified code patterns.",
  "Patterns are sent with score data, which may include repository and commit details.",
  "We use these patterns to fix false positives, which are incorrect diagnostics.",
  "We also use them to fix false negatives, which are issues that rules miss.",
  "React Doctor does not collect complete source files.",
  "Run with --no-telemetry to disable telemetry.",
];

export interface ShowTelemetryDisclosureInput {
  readonly isInteractive: boolean;
  readonly store?: CliStateOptions;
  readonly telemetryEnabled?: boolean;
  readonly writeLine?: (line: string) => void;
}

export const showTelemetryDisclosureIfNeeded = (input: ShowTelemetryDisclosureInput): boolean => {
  if (!input.isInteractive || !(input.telemetryEnabled ?? isTelemetryEnabled())) return false;
  if (!isGatePending(TELEMETRY_DISCLOSURE_GATE, {}, input.store)) return false;
  const writeLine = input.writeLine ?? cliLogger.log;
  writeLine("");
  for (const line of TELEMETRY_DISCLOSURE_LINES) writeLine(line);
  writeLine("");
  recordGate(TELEMETRY_DISCLOSURE_GATE, { outcome: "seen" }, input.store);
  return true;
};
