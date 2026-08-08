import * as Sentry from "@sentry/node";
import type {
  SessionTelemetry,
  Telemetry,
  WorkspaceScanTelemetry,
} from "@react-doctor/language-server";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  LSP_TELEMETRY_EXPORT_INTERVAL_MS,
  METRIC,
  SENTRY_DSN,
  SENTRY_FLUSH_TIMEOUT_MS,
} from "./cli/utils/constants.js";
import { toCategoryKey } from "./cli/utils/to-category-key.js";
import { isEnvFlagEnabled } from "./cli/utils/is-env-flag-enabled.js";
import { isTelemetryEnabled } from "./cli/utils/is-telemetry-enabled.js";
import { recordCount, recordDistribution } from "./cli/utils/record-metric.js";
import { scrubSentryEvent } from "./cli/utils/scrub-sentry-event.js";
import { getTelemetryContext, shutdownTelemetry } from "./cli/utils/telemetry-runtime.js";
import { resolveSentryEnvironment, resolveSentryRelease } from "./cli/utils/sentry-config.js";

/**
 * Telemetry for the editor language server (`react-doctor experimental-lsp`).
 * Mirrors the CLI's model — a per-scan wide-event span plus counters and
 * distributions to Axiom, with crashes to Sentry — but with an LSP-appropriate
 * scope instead of the CLI run context, since the daemon isn't a one-shot
 * command. Shares the CLI's DSN, release, and the anonymization scrubbers, so
 * editor telemetry honors the same privacy contract (no IP, no paths/secrets).
 *
 * Every emit is a guarded, swallow-on-throw no-op unless telemetry is live, so a
 * telemetry failure (or an opted-out / test run) can never disrupt the editor
 * session.
 *
 * Unlike the one-shot CLI, this process can run for hours, so its exporters use
 * a short periodic interval — telemetry ships while the editor session is alive
 * rather than only when the server shuts down (which it may never cleanly do).
 */

const nodeMajorVersion = (): number =>
  Number.parseInt(process.versions.node.split(".", 1)[0] ?? "", 10) || 0;

/**
 * Initializes Sentry for the language server. Safe to call once at startup; a
 * no-op when already initialized or when telemetry is opted out / disabled.
 *
 * Performance tracing is off — the `lsp.scan` wide event is an Effect span
 * exported to Axiom, and Effect has a single `Tracer` reference.
 */
export const initializeLspSentry = (serverVersion: string): void => {
  if (Sentry.isInitialized() || !isTelemetryEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN || SENTRY_DSN,
    release: resolveSentryRelease(),
    environment: resolveSentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
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
  recordCount(METRIC.lspSessionStarted, 1, {
    nodeMajor: session.nodeMajor,
    projectCount: session.projectCount,
    workspaceFolderCount: session.workspaceFolderCount,
    scanOnType: session.scanOnType,
    lintAvailable: session.lintAvailable,
  });
};

const emitWorkspaceScan = (scan: WorkspaceScanTelemetry): void => {
  recordCount(METRIC.lspScanCompleted, 1, {
    trigger: scan.trigger,
    lintDegraded: scan.lintDegraded,
  });
  recordDistribution(METRIC.lspScanDuration, scan.durationMs, {
    unit: "millisecond",
    attributes: { trigger: scan.trigger },
  });
  recordDistribution(METRIC.lspScanDiagnostics, scan.totalDiagnostics, {
    attributes: { trigger: scan.trigger },
  });

  // The canonical wide event: one span per scan carrying the full outcome as
  // attributes. Backdated to the burst's real start so the span's duration is
  // the scan duration.
  const telemetryContext = getTelemetryContext({
    exportIntervalMs: LSP_TELEMETRY_EXPORT_INTERVAL_MS,
  });
  if (telemetryContext === null) return;
  try {
    const span = Effect.runSync(
      Effect.makeSpan("react-doctor experimental-lsp scan", {
        attributes: buildLspScanEventAttributes(scan),
      }).pipe(Effect.provideContext(telemetryContext)),
    );
    span.end(BigInt(scan.startedAtEpochMs + scan.durationMs) * 1_000_000n, Exit.void);
  } catch {}
};

/** Builds the {@link Telemetry} sink the server drives. */
export const createLspTelemetry = (): Telemetry => ({
  recordSessionStart: emitSessionStart,
  recordWorkspaceScan: emitWorkspaceScan,
  flush: async () => {
    await shutdownTelemetry();
    if (!Sentry.isInitialized()) return;
    try {
      await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
    } catch {}
  },
});
