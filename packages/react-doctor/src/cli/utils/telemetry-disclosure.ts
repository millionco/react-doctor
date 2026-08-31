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
  "Telemetry includes usage data, crash reports, and minimized, identifier-redacted token patterns.",
  "Patterns contain no identifier names, literal contents, comments, or file paths.",
  "Score submissions also include scrubbed diagnostic paths, locations, messages, and help text.",
  "Score data may include repository and commit details.",
  "The score service logs the request IP address and user agent.",
  "We use these patterns to fix false positives, which are incorrect diagnostics.",
  "We also use them to fix false negatives, which are issues that rules miss.",
  "React Doctor does not collect complete source files.",
  "Run with --no-telemetry to disable telemetry and skip the score API and share URL.",
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
