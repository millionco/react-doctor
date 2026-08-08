import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";
import type { RunRootSpan } from "./with-run-span.js";
import { getTelemetryContext } from "./telemetry-runtime.js";

/**
 * Installs the tracing backend for the inspect program.
 *
 * Both the run root span and this program draw their tracer from the same
 * shared telemetry context, so the scan's spans (`runInspect`, every
 * `Service.method`) nest under the run span natively — no cross-backend
 * `ExternalSpan` stitching, and one exporter with one flush.
 *
 * The backend itself is chosen inside `layerObservability`: a user-configured
 * `REACT_DOCTOR_OTLP_*` endpoint wins over first-party Axiom, since Effect has a
 * single `Tracer` reference and someone who pointed React Doctor at their own
 * collector meant it.
 *
 * A pass-through when telemetry is off, leaving Effect's native in-memory
 * tracer — identical to the prior default behavior.
 */
export const applyObservability = <A, E, R>(
  program: Effect.Effect<A, E, R>,
  rootSpan: RunRootSpan,
): Effect.Effect<A, E, R> => {
  const telemetryContext = getTelemetryContext();
  if (telemetryContext === null) return program;
  const withBackend = program.pipe(Effect.provideContext(telemetryContext));
  return rootSpan === undefined
    ? withBackend
    : withBackend.pipe(Effect.provideService(Tracer.ParentSpan, rootSpan));
};
