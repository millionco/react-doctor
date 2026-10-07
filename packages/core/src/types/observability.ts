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
}
