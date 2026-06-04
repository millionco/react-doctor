import * as Sentry from "@sentry/node";
import type {
  SessionTelemetry,
  Telemetry,
  WorkspaceScanTelemetry,
} from "@react-doctor/language-server";
import { SENTRY_DSN, SENTRY_FLUSH_TIMEOUT_MS, METRIC } from "./cli/utils/constants.js";
import { toCategoryKey } from "./cli/utils/to-category-key.js";
import { scrubSentryEvent } from "./cli/utils/scrub-sentry-event.js";
import { scrubSentryMetric } from "./cli/utils/scrub-sentry-metric.js";
import {
  resolveSentryEnvironment,
  resolveSentryRelease,
  resolveTracesSampleRate,
} from "./cli/utils/sentry-config.js";

/**
 * Sentry telemetry for the editor language server (`react-doctor
 * experimental-lsp`). Mirrors the CLI's model — a per-scan wide-event span
 * (op `lsp.scan`) plus Application Metrics counters/distributions — but with
 * an LSP-appropriate scope instead of the CLI run context, since the daemon
 * isn't a one-shot command. Shares the CLI's DSN, release, and the
 * anonymization scrubbers, so editor telemetry honors the same privacy
 * contract (no IP, no paths/secrets).
 *
 * Every emit is a guarded, swallow-on-throw no-op unless Sentry is live, so a
 * telemetry failure (or an opted-out / test run) can never disrupt the editor
 * session.
 */

let lspTracesSampleRate = 0;

const isEnvFlagEnabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

const nodeMajorVersion = (): number =>
  Number.parseInt(process.versions.node.split(".", 1)[0] ?? "", 10) || 0;

// The language server can't take a `--no-score` flag the way the CLI does, so
// opt-out is env-driven (matching the `REACT_DOCTOR_*` runtime knobs). The
// argv flags are still honored for editors configured to pass them, and this
// repo's own test runs never phone home.
const shouldEnableLspTelemetry = (): boolean => {
  if (isEnvFlagEnabled(process.env.REACT_DOCTOR_NO_TELEMETRY)) return false;
  if (process.argv.includes("--no-telemetry") || process.argv.includes("--no-score")) return false;
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return true;
};

/** Whether wide-event spans will actually be recorded (Sentry live + sampling on). */
const isLspTracingEnabled = (): boolean => Sentry.isInitialized() && lspTracesSampleRate > 0;

/**
 * Initializes Sentry for the language server. Safe to call once at startup; a
 * no-op when already initialized or when telemetry is opted out / disabled.
 */
export const initializeLspSentry = (serverVersion: string): void => {
  if (Sentry.isInitialized() || !shouldEnableLspTelemetry()) return;
  lspTracesSampleRate = resolveTracesSampleRate();
  Sentry.init({
    dsn: process.env.SENTRY_DSN || SENTRY_DSN,
    release: resolveSentryRelease(),
    environment: resolveSentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: lspTracesSampleRate,
    debug: isEnvFlagEnabled(process.env.SENTRY_DEBUG),
    initialScope: {
      tags: {
        origin: "lsp",
        command: "experimental-lsp",
        serverVersion,
        nodeMajor: nodeMajorVersion(),
        platform: process.platform,
      },
      contexts: {
        lsp: {
          serverVersion,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      },
    },
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeSendMetric: (metric) => scrubSentryMetric(metric),
  });
};

/**
 * Flat attribute set for one workspace-scan wide event. Pure and exported so
 * the projection (rule-category rollup, clean/degraded outcome) is testable
 * without a live Sentry client.
 */
export const buildLspScanEventAttributes = (
  scan: WorkspaceScanTelemetry,
): Record<string, string | number | boolean> => {
  const attributes: Record<string, string | number | boolean> = {
    trigger: scan.trigger,
    durationMs: scan.durationMs,
    projectCount: scan.projectCount,
    chunkCount: scan.chunkCount,
    filesWithDiagnostics: scan.filesWithDiagnostics,
    totalDiagnostics: scan.totalDiagnostics,
    errorCount: scan.errorCount,
    warningCount: scan.warningCount,
    scanClean: scan.totalDiagnostics === 0 && !scan.lintDegraded,
    lintDegraded: scan.lintDegraded,
    lintIncompleteChunks: scan.lintIncompleteChunks,
  };
  for (const [category, count] of Object.entries(scan.diagnosticsByCategory)) {
    attributes[`diag.category.${toCategoryKey(category)}`] = count;
  }
  return attributes;
};

const emitSessionStart = (session: SessionTelemetry): void => {
  if (!Sentry.isInitialized()) return;
  try {
    Sentry.metrics.count(METRIC.lspSessionStarted, 1, {
      attributes: {
        nodeMajor: session.nodeMajor,
        projectCount: session.projectCount,
        workspaceFolderCount: session.workspaceFolderCount,
        scanOnType: session.scanOnType,
        lintAvailable: session.lintAvailable,
      },
    });
  } catch {}
};

const emitWorkspaceScan = (scan: WorkspaceScanTelemetry): void => {
  if (!Sentry.isInitialized()) return;
  try {
    Sentry.metrics.count(METRIC.lspScanCompleted, 1, {
      attributes: { trigger: scan.trigger, lintDegraded: scan.lintDegraded },
    });
    Sentry.metrics.distribution(METRIC.lspScanDuration, scan.durationMs, {
      unit: "millisecond",
      attributes: { trigger: scan.trigger },
    });
    Sentry.metrics.distribution(METRIC.lspScanDiagnostics, scan.totalDiagnostics, {
      attributes: { trigger: scan.trigger },
    });
    // The canonical wide event: one transaction per scan, carrying the full
    // outcome as attributes for ad-hoc Trace Explorer queries. Backdated to the
    // burst's real start so the transaction duration is the scan duration.
    if (isLspTracingEnabled()) {
      const span = Sentry.startInactiveSpan({
        name: "react-doctor experimental-lsp scan",
        op: "lsp.scan",
        forceTransaction: true,
        startTime: new Date(scan.startedAtEpochMs),
        attributes: buildLspScanEventAttributes(scan),
      });
      span.end();
    }
  } catch {}
};

/** Builds the {@link Telemetry} sink the server drives. */
export const createLspTelemetry = (): Telemetry => ({
  recordSessionStart: emitSessionStart,
  recordWorkspaceScan: emitWorkspaceScan,
  flush: async () => {
    if (!Sentry.isInitialized()) return;
    try {
      await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
    } catch {}
  },
});
