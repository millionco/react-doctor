import * as Sentry from "@sentry/node";
import { buildSentryScope } from "./build-sentry-scope.js";
import { toSpanAttributes } from "./to-span-attributes.js";

// Sentry metric attributes accept primitives; `null`/`undefined` denote an
// absent signal and are dropped so a missing value never becomes a misleading
// `"null"` attribute (mirrors `toSpanAttributes` for spans).
export interface MetricAttributes {
  [attributeName: string]: string | number | boolean | null | undefined;
}

interface MetricOptions {
  readonly unit?: string;
  readonly attributes?: MetricAttributes;
}

const cleanAttributes = (
  attributes: MetricAttributes | undefined,
): Record<string, string | number | boolean> => {
  const cleaned: Record<string, string | number | boolean> = {};
  if (!attributes) return cleaned;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) cleaned[key] = value;
  }
  return cleaned;
};

// Every metric carries the run snapshot (and the scanned project, once
// discovered) merged from the same lazy `buildSentryScope()` projection the
// event scope uses. Rebuilding per emit — instead of a sticky global-scope
// snapshot taken at init — means metrics track runtime state (`--json` mode, a
// workspace scan's project rolling over, the project clearing after a run)
// exactly like events do, and these attributes pass through `beforeSendMetric`
// scrubbing like any other. Call-specific attributes win on key collision.
const withRunAttributes = (
  attributes: MetricAttributes | undefined,
): Record<string, string | number | boolean> => ({
  ...toSpanAttributes(buildSentryScope().tags),
  ...cleanAttributes(attributes),
});

/**
 * Emits a Sentry counter. A guarded, swallow-on-throw no-op unless the CLI's
 * Sentry SDK is live, so it's inert under `--no-score`, tests, and the
 * programmatic `@react-doctor/api` library (none of which initialize Sentry).
 * Metrics flow independently of performance tracing, so counters are still
 * recorded when `SENTRY_TRACES_SAMPLE_RATE=0`.
 */
export const recordCount = (name: string, value = 1, attributes?: MetricAttributes): void => {
  if (!Sentry.isInitialized()) return;
  try {
    Sentry.metrics.count(name, value, { attributes: withRunAttributes(attributes) });
  } catch {}
};

/**
 * Emits a Sentry distribution (value ranges — durations, sizes, scores). Same
 * gating and run-attribute handling as {@link recordCount}.
 */
export const recordDistribution = (
  name: string,
  value: number,
  options: MetricOptions = {},
): void => {
  if (!Sentry.isInitialized()) return;
  try {
    Sentry.metrics.distribution(name, value, {
      unit: options.unit,
      attributes: withRunAttributes(options.attributes),
    });
  } catch {}
};
