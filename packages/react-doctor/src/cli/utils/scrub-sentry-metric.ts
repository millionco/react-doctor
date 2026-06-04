import { anonymizeInPlace } from "./anonymize-text.js";

// Structural shape rather than the SDK's exported metric type: `beforeSendMetric`
// hands us the metric and this minimal constraint keeps the scrubber resilient
// to SDK type-name churn while covering the only field that can carry user data.
interface ScrubbableMetric {
  attributes?: Record<string, unknown>;
}

/**
 * Anonymizes a Sentry metric before it leaves the machine, mirroring
 * {@link scrubSentryEvent}. Drops the `server.address` default attribute (the
 * hostname) and scrubs home-directory paths + known secrets/emails from every
 * remaining attribute value (metric names are our own constants, so they're
 * left intact to avoid splitting a series). Returns `null` on any failure so an
 * un-anonymized metric is never sent. Wired into `beforeSendMetric`.
 */
export const scrubSentryMetric = <T extends ScrubbableMetric>(metric: T): T | null => {
  try {
    if (metric.attributes) {
      // Sentry adds the server hostname as a default attribute on server-side
      // SDKs; the project treats the hostname as identifying (it also strips
      // `server_name`/device name from events), so drop it from every metric.
      delete metric.attributes["server.address"];
      anonymizeInPlace(metric.attributes);
    }
    return metric;
  } catch {
    return null;
  }
};
