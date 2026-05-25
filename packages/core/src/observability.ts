import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Otlp from "effect/unstable/observability/Otlp";

const TRACER_PROJECT_NAME = "react-doctor";

const OTEL_ENDPOINT = Config.string("REACT_DOCTOR_OTLP_ENDPOINT").pipe(Config.option);
const OTEL_AUTH_HEADER = Config.redacted("REACT_DOCTOR_OTLP_AUTH_HEADER").pipe(Config.option);

/**
 * Opt-in OpenTelemetry layer. The default `Effect.fn(...)` spans
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
export const layerOtlp: Layer.Layer<never> = Layer.unwrap(
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
