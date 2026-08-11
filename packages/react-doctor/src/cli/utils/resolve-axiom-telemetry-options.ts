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
 *
 * The overrides are `REACT_DOCTOR_`-prefixed rather than the bare `AXIOM_TOKEN`
 * / `AXIOM_DATASET` names Axiom's own tooling uses. Those are common in the
 * environment of anyone who already runs Axiom, and reading them here would
 * silently redirect React Doctor's telemetry into an unrelated account — or
 * fail against a dataset that isn't shaped for it — without the user ever
 * asking for that.
 */
export const resolveAxiomTelemetryOptions = (): AxiomTelemetryOptions | null => {
  if (!isTelemetryEnabled()) return null;
  const token = process.env.REACT_DOCTOR_AXIOM_TOKEN || AXIOM_INGEST_TOKEN;
  if (!token) return null;
  return {
    token: Redacted.make(token),
    domain: process.env.REACT_DOCTOR_AXIOM_DOMAIN || AXIOM_DEFAULT_DOMAIN,
    tracesDataset: process.env.REACT_DOCTOR_AXIOM_DATASET || AXIOM_TRACES_DATASET,
    metricsDataset: process.env.REACT_DOCTOR_AXIOM_METRICS_DATASET || AXIOM_METRICS_DATASET,
    serviceVersion: VERSION,
  };
};
