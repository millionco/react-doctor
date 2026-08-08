import { anonymizeText } from "@react-doctor/core";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { buildSentryScope } from "./build-sentry-scope.js";
import { METRIC_DISTRIBUTION_BOUNDARIES } from "./constants.js";
import { isTelemetryEnabled } from "./is-telemetry-enabled.js";
import { toSpanAttributes } from "./to-span-attributes.js";

// Metric attributes accept primitives; `null`/`undefined` denote an absent
// signal and are dropped by `toSpanAttributes`.
export interface MetricAttributes {
  [attributeName: string]: string | number | boolean | null | undefined;
}

interface MetricOptions {
  readonly unit?: string;
  readonly attributes?: MetricAttributes;
}

// Effect metric attributes are string-only (`Metric.AttributeSet`), which also
// matches Axiom's metrics store — it rejects non-string tag values. Sentry
// accepted primitives, so numbers and booleans are stringified here rather than
// dropped.
//
// Every metric carries the run snapshot (and the scanned project, once
// discovered) merged from the same lazy `buildSentryScope()` projection the
// error scope uses. Rebuilding per emit — instead of a sticky snapshot taken at
// init — means metrics track runtime state (`--json` mode, a workspace scan's
// project rolling over, the project clearing after a run). Call-specific
// attributes win on key collision.
//
// Values are anonymized here at the emit site. Sentry's `beforeSendMetric` hook
// used to be the backstop; OTLP has no equivalent interception point, so this is
// now the only place metric attributes get scrubbed.
const withRunAttributes = (attributes: MetricAttributes | undefined): Record<string, string> => {
  const merged = {
    ...toSpanAttributes(buildSentryScope().tags),
    ...toSpanAttributes(attributes ?? {}),
  };
  const stringified: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    stringified[key] = typeof value === "string" ? anonymizeText(value) : String(value);
  }
  return stringified;
};

/**
 * Emits a counter into Effect's metric registry, where the OTLP exporter picks
 * it up at flush time.
 *
 * A guarded, swallow-on-throw no-op unless telemetry is enabled, so it's inert
 * under `--no-score` / `--no-telemetry`, in tests, and for the programmatic
 * `@react-doctor/api` library. Counters are independent of trace sampling, so
 * they are still recorded when tracing is off.
 */
export const recordCount = (name: string, value = 1, attributes?: MetricAttributes): void => {
  if (!isTelemetryEnabled()) return;
  try {
    Metric.counter(name)
      .pipe(Metric.withAttributes(withRunAttributes(attributes)))
      .updateUnsafe(value, Context.empty());
  } catch {}
};

/**
 * Emits a distribution (value ranges — durations, sizes, scores). Same gating
 * and run-attribute handling as {@link recordCount}.
 *
 * `unit` is recorded as an attribute rather than as OTLP metric metadata:
 * Effect's histogram carries no unit field, and keeping the millisecond/count
 * distinction queryable matters more than where it is stored.
 */
export const recordDistribution = (
  name: string,
  value: number,
  options: MetricOptions = {},
): void => {
  if (!isTelemetryEnabled()) return;
  try {
    const attributes = withRunAttributes(options.attributes);
    if (options.unit) attributes.unit = options.unit;
    Metric.histogram(name, { boundaries: METRIC_DISTRIBUTION_BOUNDARIES })
      .pipe(Metric.withAttributes(attributes))
      .updateUnsafe(value, Context.empty());
  } catch {}
};
