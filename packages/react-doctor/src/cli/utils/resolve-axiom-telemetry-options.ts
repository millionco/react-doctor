import { AXIOM_DEFAULT_DOMAIN, type AxiomTelemetryOptions } from "@react-doctor/core";
import * as Redacted from "effect/Redacted";
import { AXIOM_INGEST_TOKEN, AXIOM_METRICS_DATASET, AXIOM_TRACES_DATASET } from "./constants.js";
import { isTelemetryEnabled } from "./is-telemetry-enabled.js";
import { VERSION } from "./version.js";

/**
 * Resolves the credentials for first-party Axiom export, or `null` when this
 * process must not emit telemetry.
 *
 * Core deliberately does not read these itself — keeping the token on the CLI
 * side is what makes `@react-doctor/api` silent by construction rather than by a
 * runtime guard.
 *
 * Returning `null` for an empty token means an unconfigured build (or a
 * contributor's checkout without the token baked in) simply doesn't export,
 * instead of sending unauthenticated requests to Axiom on every run.
 */
export const resolveAxiomTelemetryOptions = (): AxiomTelemetryOptions | null => {
  if (!isTelemetryEnabled()) return null;
  const token = process.env.AXIOM_TOKEN || AXIOM_INGEST_TOKEN;
  if (!token) return null;
  return {
    token: Redacted.make(token),
    domain: process.env.AXIOM_DOMAIN || AXIOM_DEFAULT_DOMAIN,
    tracesDataset: process.env.AXIOM_DATASET || AXIOM_TRACES_DATASET,
    metricsDataset: process.env.AXIOM_METRICS_DATASET || AXIOM_METRICS_DATASET,
    serviceVersion: VERSION,
  };
};
