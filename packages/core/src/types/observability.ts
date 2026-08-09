import type * as Redacted from "effect/Redacted";

/**
 * Credentials and dataset routing for first-party Axiom telemetry.
 *
 * Core never reads these from the environment — the CLI owns the embedded
 * ingest token and passes it in. That keeps `@react-doctor/api` and any other
 * programmatic consumer silent by construction: a library that never supplies
 * options can never ship first-party telemetry.
 */
export interface AxiomTelemetryOptions {
  token: Redacted.Redacted<string>;
  /** OTLP root, e.g. `https://api.axiom.co`. Signal paths are appended. */
  domain: string;
  /** Events-type dataset receiving spans. */
  tracesDataset: string;
  /** Metrics-type dataset receiving counters and distributions. */
  metricsDataset: string;
  serviceVersion: string;
  /**
   * Periodic export interval. Defaults to `TELEMETRY_EXPORT_INTERVAL_MS`, which
   * is deliberately longer than any realistic CLI run so the single export is
   * the one triggered when the scope closes at exit. A long-running process —
   * the language server — overrides it so telemetry ships while the daemon is
   * still alive rather than only at shutdown.
   */
  exportIntervalMs?: number;
}
