import { layerObservability } from "@react-doctor/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { isTelemetryEnabled } from "./is-telemetry-enabled.js";
import { resolveAxiomTelemetryOptions } from "./resolve-axiom-telemetry-options.js";

// Both env vars are required for the user's own exporter to be active — mirror
// `core/src/observability.ts`'s gating so this only counts OTLP as configured
// when it would actually export.
const isUserOtlpConfigured = (): boolean =>
  Boolean(process.env.REACT_DOCTOR_OTLP_ENDPOINT) &&
  Boolean(process.env.REACT_DOCTOR_OTLP_AUTH_HEADER);

let telemetryScope: Scope.Closeable | null = null;
let telemetryContext: Context.Context<never> | null = null;
let isBuilt = false;
let pendingShutdown: Promise<void> | null = null;

/**
 * Builds the telemetry layer once and hands back its context.
 *
 * The CLI is an imperative shell around several separate `Effect.runPromise`
 * calls — the scan program, the renderer, and the run root span all run
 * independently. Providing a fresh layer to each would create a separate set of
 * OTLP exporters per program: each holds its own span buffer and its own
 * shutdown flush, so exit latency would multiply, the root span would land in a
 * different export than its children, and — because Effect tracks
 * delta-temporality state per exporter instance — every counter would be
 * re-reported in full by each new metrics exporter.
 *
 * Building into a long-lived scope instead means one tracer and one metrics
 * exporter shared by all of them: child spans nest under the run span natively,
 * with no `ExternalSpan` stitching, and one flush at exit ships both signals.
 *
 * Returns `null` when telemetry is disabled or unconfigured, which is what keeps
 * `--no-telemetry` and unconfigured builds from opening a scope at all.
 *
 * `exportIntervalMs` lets a long-running process (the language server) ship
 * telemetry periodically instead of only at shutdown.
 */
export const getTelemetryContext = (
  overrides: { exportIntervalMs?: number } = {},
): Context.Context<never> | null => {
  if (isBuilt) return telemetryContext;
  isBuilt = true;
  if (!isTelemetryEnabled()) return null;
  const options = resolveAxiomTelemetryOptions();
  // A user who pointed React Doctor at their own collector must keep getting
  // spans even when no first-party Axiom token is configured — `options` is
  // null in that case, and `layerObservability(null)` resolves to the BYO
  // exporter. Without this check an unconfigured build would silently stop
  // exporting to their backend too.
  if (options === null && !isUserOtlpConfigured()) return null;
  try {
    const scope = Scope.makeUnsafe();
    telemetryContext = Effect.runSync(
      Layer.buildWithScope(
        layerObservability(options === null ? null : { ...options, ...overrides }),
        scope,
      ) as Effect.Effect<Context.Context<never>>,
    );
    telemetryScope = scope;
  } catch {
    telemetryContext = null;
    telemetryScope = null;
  }
  return telemetryContext;
};

/**
 * Closes the telemetry scope, which is what ships buffered spans and metrics.
 *
 * Both exporters flush during scope finalization, bounded by
 * `TELEMETRY_SHUTDOWN_TIMEOUT_MS`. Because the scope is built once and shared,
 * there is exactly one of each exporter per process — which is what keeps
 * metrics honest: Effect tracks delta-temporality state on the exporter
 * instance, so a second one would start with no previous snapshot and re-report
 * every counter's full value, doubling every metric.
 *
 * Memoized for the same reason: several exit paths can fire (a `--debug` user
 * error flushes, then the top-level catch flushes again), and repeat callers
 * must await the original shutdown rather than start a second one.
 *
 * Swallows failures so telemetry can never mask the user's result.
 */
export const shutdownTelemetry = async (): Promise<void> => {
  if (pendingShutdown !== null) return pendingShutdown;
  // Commands that never run a scan — `version`, `install`, `ci`, `rules`, and
  // any early `inspect` exit — still record counters like `cli.invoked` into
  // Effect's registry, but nothing on those paths builds the exporter. Building
  // here means the registry is drained on exit rather than dropped; when a scan
  // did run this is a no-op that returns the scope it already opened.
  getTelemetryContext();
  const scope = telemetryScope;
  if (scope === null) return;
  telemetryScope = null;
  telemetryContext = null;
  pendingShutdown = Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => {});
  return pendingShutdown;
};
