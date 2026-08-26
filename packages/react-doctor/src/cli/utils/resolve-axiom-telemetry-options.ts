import { AXIOM_DEFAULT_DOMAIN, type AxiomTelemetryOptions } from "@react-doctor/core";
import * as Redacted from "effect/Redacted";
import { AXIOM_METRICS_DATASET, AXIOM_TRACES_DATASET } from "./constants.js";
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
 * First-party telemetry now requires `REACT_DOCTOR_AXIOM_TOKEN` to be set
 * explicitly — no token ships in the published package. This makes first-party
 * telemetry opt-in and removes the extractable credential from the tarball.
 * Users who need first-party telemetry must provide their own scoped Axiom
 * ingest token.
 *
 * Returning `null` for an empty token means telemetry is disabled, and no
 * unauthenticated requests are sent to Axiom.
 *
 * The env vars are `REACT_DOCTOR_`-prefixed rather than the bare `AXIOM_TOKEN`
 * / `AXIOM_DATASET` names Axiom's own tooling uses. Those are common in the
 * environment of anyone who already runs Axiom, and reading them here would
 * silently redirect React Doctor's telemetry into an unrelated account — or
 * fail against a dataset that isn't shaped for it — without the user ever
 * asking for that.
 */
export const resolveAxiomTelemetryOptions = (): AxiomTelemetryOptions | null => {
  if (!isTelemetryEnabled()) return null;
  const token = process.env.REACT_DOCTOR_AXIOM_TOKEN;
  if (!token) return null;
  return {
    token: Redacted.make(token),
    domain: process.env.REACT_DOCTOR_AXIOM_DOMAIN || AXIOM_DEFAULT_DOMAIN,
    tracesDataset: process.env.REACT_DOCTOR_AXIOM_DATASET || AXIOM_TRACES_DATASET,
    metricsDataset: process.env.REACT_DOCTOR_AXIOM_METRICS_DATASET || AXIOM_METRICS_DATASET,
    serviceVersion: VERSION,
  };
};
