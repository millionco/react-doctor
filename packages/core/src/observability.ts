import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Tracer from "effect/Tracer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Otlp from "effect/unstable/observability/Otlp";
import * as OtlpMetrics from "effect/unstable/observability/OtlpMetrics";
import * as OtlpSerialization from "effect/unstable/observability/OtlpSerialization";
import * as OtlpTracer from "effect/unstable/observability/OtlpTracer";
import {
  AXIOM_DATASET_HEADER,
  AXIOM_METRICS_DATASET_HEADER,
  AXIOM_METRICS_PATH,
  AXIOM_TRACES_PATH,
  SLASH_CHAR_CODE,
  TELEMETRY_EXPORT_INTERVAL_MS,
  TELEMETRY_SHUTDOWN_TIMEOUT_MS,
} from "./constants.js";
import type { AxiomTelemetryOptions } from "./types/observability.js";
import { makeScrubbingTracer } from "./utils/make-scrubbing-tracer.js";

const TRACER_PROJECT_NAME = "react-doctor";

/**
 * Replaces an exporter layer's `Tracer` with a scrubbing wrapper around it.
 *
 * OTLP has no `beforeSend`-style interception point, so this is the one place
 * every exported span is guaranteed to pass through. Applied to the telemetry
 * layers rather than to individual call sites so an attribute added later can't
 * quietly bypass it.
 */
const withScrubbedSpans = <A, E, R>(exporter: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
  Layer.effect(Tracer.Tracer, Effect.map(Effect.service(Tracer.Tracer), makeScrubbingTracer)).pipe(
    Layer.provideMerge(exporter),
  ) as Layer.Layer<A, E, R>;

const OTEL_ENDPOINT = Config.string("REACT_DOCTOR_OTLP_ENDPOINT").pipe(Config.option);
const OTEL_AUTH_HEADER = Config.redacted("REACT_DOCTOR_OTLP_AUTH_HEADER").pipe(Config.option);

/**
 * Bring-your-own OpenTelemetry layer. The default `Effect.fn(...)` spans
 * already populate the in-process tracer; this layer plugs an OTLP
 * HTTP exporter into the runtime when the user opts in via:
 *
 *   REACT_DOCTOR_OTLP_ENDPOINT      e.g. https://api.axiom.co
 *   REACT_DOCTOR_OTLP_AUTH_HEADER   e.g. "Bearer <token>"
 *
 * Both env vars are required to enable export — if either is
 * missing, the layer is a no-op (matches the pattern from
 * `react-doctor-evals/src/Observability.ts`, where the equivalent
 * absent-env path returns `Layer.empty`).
 *
 * No setup is required for users who don't care about tracing — the
 * inspect / diagnose orchestrators always run, this layer just
 * dictates whether the spans they emit get shipped to a backend.
 */
export const layerUserOtlp: Layer.Layer<never> = Layer.unwrap(
  Effect.gen(function* () {
    const endpoint = yield* OTEL_ENDPOINT;
    const authHeader = yield* OTEL_AUTH_HEADER;
    if (endpoint._tag === "None" || authHeader._tag === "None") {
      return Layer.empty;
    }
    const headers: Record<string, string> = {
      Authorization: Redacted.value(authHeader.value),
    };
    return Otlp.layerJson({
      baseUrl: endpoint.value,
      resource: { serviceName: TRACER_PROJECT_NAME },
      headers,
    }).pipe(Layer.provide(FetchHttpClient.layer));
  }).pipe(Effect.orDie),
);

/**
 * First-party telemetry export to Axiom.
 *
 * Composes the tracer and metrics exporters by hand rather than using
 * `Otlp.layer`, because Axiom routes each signal to a different dataset via a
 * different header (see `AXIOM_DATASET_HEADER` / `AXIOM_METRICS_DATASET_HEADER`)
 * and `Otlp.layer` passes one `headers` object to every signal. Logs are
 * deliberately not wired up — nothing in the engine emits `Effect.log` as
 * telemetry today.
 *
 * Serialization is protobuf, not JSON: Axiom's `/v1/metrics` accepts
 * `application/x-protobuf` only. `layerProtobuf` ships with Effect and pulls in
 * no extra dependency.
 *
 * Traces and metrics are exposed as separate layers so each signal's exporter
 * can be reasoned about on its own, and `layerObservability` merges them for the
 * normal case. Whichever you use, build it **exactly once per process**:
 * Effect's delta-temporality bookkeeping lives on the metrics exporter
 * instance, so a second one starts with no previous state and re-reports every
 * counter's full value as its delta — double-counting everything.
 */
const buildResource = (options: AxiomTelemetryOptions) => ({
  serviceName: TRACER_PROJECT_NAME,
  serviceVersion: options.serviceVersion,
});

const buildAuthorization = (options: AxiomTelemetryOptions): string =>
  `Bearer ${Redacted.value(options.token)}`;

// Trailing slashes are trimmed by scanning backwards rather than with a
// `/\/+$/` replace: that pattern backtracks quadratically on a domain made
// mostly of slashes, which CodeQL flags as a polynomial-regex denial of service
// since the value comes in from the caller.
const normalizeDomain = (domain: string): string => {
  let end = domain.length;
  while (end > 0 && domain.charCodeAt(end - 1) === SLASH_CHAR_CODE) end -= 1;
  return domain.slice(0, end);
};

export const layerAxiomTraces = (options: AxiomTelemetryOptions): Layer.Layer<never> =>
  OtlpTracer.layer({
    url: `${normalizeDomain(options.domain)}${AXIOM_TRACES_PATH}`,
    resource: buildResource(options),
    headers: {
      Authorization: buildAuthorization(options),
      [AXIOM_DATASET_HEADER]: options.tracesDataset,
    },
    exportInterval: options.exportIntervalMs ?? TELEMETRY_EXPORT_INTERVAL_MS,
    shutdownTimeout: TELEMETRY_SHUTDOWN_TIMEOUT_MS,
  }).pipe(
    Layer.provide(OtlpSerialization.layerProtobuf),
    Layer.provide(FetchHttpClient.layer),
    withScrubbedSpans,
  );

/**
 * Metrics exporter. Instantiate **once per process** — see the double-counting
 * note above. Delta temporality is still the right choice for a short-lived CLI:
 * cumulative reports totals since a fixed start time, which for a process that
 * lives a few seconds is just the run total reported against a meaningless
 * window.
 */
export const layerAxiomMetrics = (options: AxiomTelemetryOptions): Layer.Layer<never> =>
  OtlpMetrics.layer({
    url: `${normalizeDomain(options.domain)}${AXIOM_METRICS_PATH}`,
    resource: buildResource(options),
    headers: {
      Authorization: buildAuthorization(options),
      [AXIOM_METRICS_DATASET_HEADER]: options.metricsDataset,
    },
    exportInterval: options.exportIntervalMs ?? TELEMETRY_EXPORT_INTERVAL_MS,
    shutdownTimeout: TELEMETRY_SHUTDOWN_TIMEOUT_MS,
    temporality: "delta",
  }).pipe(Layer.provide(OtlpSerialization.layerProtobuf), Layer.provide(FetchHttpClient.layer));

/**
 * The first-party telemetry layer: spans and metrics together.
 *
 * A user-configured OTLP endpoint wins over first-party Axiom: Effect has one
 * `Tracer` reference, so the two are mutually exclusive, and someone who went to
 * the trouble of pointing React Doctor at their own collector meant it.
 * Passing `null` (or omitting options) disables first-party export entirely,
 * which is how `--no-telemetry` and every library consumer stay silent.
 *
 * Build this **once per process** and share the resulting context — see
 * `telemetry-runtime.ts`. Effect keeps delta-temporality state on the metrics
 * exporter instance, so a second build starts with no previous snapshot and
 * re-reports every counter's full value, doubling every metric.
 */
export const layerObservability = (
  options: AxiomTelemetryOptions | null = null,
): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const endpoint = yield* OTEL_ENDPOINT;
      const authHeader = yield* OTEL_AUTH_HEADER;
      if (endpoint._tag !== "None" && authHeader._tag !== "None") {
        return layerUserOtlp;
      }
      return options === null
        ? Layer.empty
        : Layer.merge(layerAxiomTraces(options), layerAxiomMetrics(options));
    }).pipe(Effect.orDie),
  );
