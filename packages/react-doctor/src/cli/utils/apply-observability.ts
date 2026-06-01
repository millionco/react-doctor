import * as Sentry from "@sentry/node";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import { layerOtlp } from "@react-doctor/core";
import { TRACE_FLAG_SAMPLED } from "./constants.js";
import { makeSentryTracer } from "./sentry-tracer.js";

type SentrySpan = ReturnType<typeof Sentry.startInactiveSpan>;

// Both OTLP env vars are required for the user's exporter to be active — mirror
// `core/src/observability.ts`'s gating so we only treat OTLP as "configured"
// when it would actually export.
const isOtlpExportConfigured = (): boolean =>
  Boolean(process.env.REACT_DOCTOR_OTLP_ENDPOINT) &&
  Boolean(process.env.REACT_DOCTOR_OTLP_AUTH_HEADER);

const externalSpanFrom = (sentrySpan: SentrySpan): Tracer.ExternalSpan => {
  const { traceId, spanId, traceFlags } = sentrySpan.spanContext();
  return Tracer.externalSpan({
    traceId,
    spanId,
    sampled: (traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED,
  });
};

/**
 * Installs the tracing backend for the inspect program. Effect's tracer is a
 * single reference, so the backends are mutually exclusive — we pick by
 * precedence:
 *
 * 1. **User OTLP backend** (`REACT_DOCTOR_OTLP_*` set) wins; we additionally
 *    parent the Effect trace under the active Sentry trace via an
 *    `ExternalSpan` so a trace exported to the user's backend shares its
 *    `trace_id` with the corresponding Sentry trace.
 * 2. **Sentry tracing active** (and no user OTLP): route Effect's existing
 *    span instrumentation straight into Sentry as one unified per-run trace.
 * 3. **Neither**: provide the (no-op) OTLP layer, leaving Effect's native
 *    in-memory tracer — identical to the prior default behavior.
 */
export const applyObservability = <A, E, R>(
  program: Effect.Effect<A, E, R>,
  rootSentrySpan: SentrySpan | undefined,
): Effect.Effect<A, E, R> => {
  if (isOtlpExportConfigured()) {
    const correlated = rootSentrySpan
      ? program.pipe(Effect.provideService(Tracer.ParentSpan, externalSpanFrom(rootSentrySpan)))
      : program;
    return correlated.pipe(Effect.provide(layerOtlp));
  }
  if (rootSentrySpan) {
    return program.pipe(Effect.withTracer(makeSentryTracer(rootSentrySpan)));
  }
  return program.pipe(Effect.provide(layerOtlp));
};
