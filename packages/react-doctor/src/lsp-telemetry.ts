import * as Sentry from "@sentry/node";
import type {
  SessionTelemetry,
  Telemetry,
  WorkspaceScanTelemetry,
} from "@react-doctor/language-server";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import {
  LSP_TELEMETRY_EXPORT_INTERVAL_MS,
  METRIC,
  NANOSECONDS_PER_MILLISECOND,
  SENTRY_DSN,
  SENTRY_FLUSH_TIMEOUT_MS,
} from "./cli/utils/constants.js";
import { toCategoryKey } from "./cli/utils/to-category-key.js";
import { isEnvFlagEnabled } from "./cli/utils/is-env-flag-enabled.js";
import { isTelemetryEnabled } from "./cli/utils/is-telemetry-enabled.js";
import { recordCount, recordDistribution } from "./cli/utils/record-metric.js";
import { buildSentryScope } from "./cli/utils/build-sentry-scope.js";
import { scrubSentryEvent } from "./cli/utils/scrub-sentry-event.js";
import { toSpanAttributes } from "./cli/utils/to-span-attributes.js";
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
 * Opens the shared telemetry runtime with the daemon's periodic export
 * interval. Called at startup rather than lazily from the first scan: session
 * metrics are recorded before any scan completes, and if the editor kills the
 * server before one does, a runtime that was never built means those counters
 * are never exported.
 */
const getLspTelemetryContext = (): Context.Context<never> | null =>
  getTelemetryContext({ exportIntervalMs: LSP_TELEMETRY_EXPORT_INTERVAL_MS });

/**
 * Initializes Sentry for the language server. Safe to call once at startup; a
 * no-op when already initialized or when telemetry is opted out / disabled.
 *
 * Performance tracing is off — the `lsp.scan` wide event is an Effect span
 * exported to Axiom, and Effect has a single `Tracer` reference.
 */
export const initializeLspSentry = (serverVersion: string): void => {
  if (Sentry.isInitialized() || !isTelemetryEnabled()) return;
  // Open the exporters up front so the periodic interval starts ticking and
  // session-start counters are covered even if no scan ever completes.
  getLspTelemetryContext();
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
  // attributes.
  //
  // The span is built straight off the tracer rather than through
  // `Effect.makeSpan`, which stamps the start time from the clock. This is
  // emitted once the burst has already finished, so a clock-stamped span would
  // start and end at the same instant and report a duration of ~0 — the scan's
  // real window has to be supplied on both ends.
  const telemetryContext = getLspTelemetryContext();
  if (telemetryContext === null) return;
  try {
    const tracer = Context.get(telemetryContext, Tracer.Tracer);
    const startTime = BigInt(scan.startedAtEpochMs) * NANOSECONDS_PER_MILLISECOND;
    const span = tracer.span({
      name: "react-doctor experimental-lsp scan",
      parent: Option.none(),
      annotations: Context.empty(),
      links: [],
      startTime,
      kind: "internal",
      root: true,
      sampled: true,
    });
    // Run dimensions first, scan outcome second (so the scan wins a collision).
    // Sentry attached these automatically from `initialScope`; an Effect span
    // inherits no such scope, so without this the editor's traces would lack the
    // `origin` / `command` / `platform` dimensions that the CLI's root span
    // stamps and that LSP metrics already carry via `record-metric.ts`.
    const attributes = {
      ...toSpanAttributes(buildSentryScope().tags),
      ...buildLspScanEventAttributes(scan),
    };
    for (const [key, value] of Object.entries(attributes)) {
      span.attribute(key, value);
    }
    span.end(startTime + BigInt(scan.durationMs) * NANOSECONDS_PER_MILLISECOND, Exit.void);
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
