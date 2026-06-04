import type { Event } from "@sentry/node";
import { anonymizeInPlace, anonymizeText } from "./anonymize-text.js";
import { scrubSensitivePaths } from "./scrub-sensitive-text.js";

/**
 * Anonymizes a Sentry event (error or transaction) before it leaves the
 * machine. Strips identity the SDK attaches automatically — the IP-bearing
 * `user`, the `server_name`, and the device `name` (all hostnames) — drops
 * captured local variables (unbounded, un-anonymizable user data), and scrubs
 * home-directory paths + known secrets/emails from every remaining string:
 * messages, stack frames, breadcrumbs, contexts/extra/tags, and span
 * attributes (e.g. the `inspect.directory` path on the bridged `runInspect`
 * span).
 *
 * Wired into both `beforeSend` and `beforeSendTransaction`. If scrubbing ever
 * throws, the event is dropped (`null`) rather than risk sending un-anonymized
 * data — telemetry is best-effort, privacy is not.
 */
export const scrubSentryEvent = <T extends Event>(event: T): T | null => {
  try {
    delete event.server_name;
    delete event.user;

    const device = event.contexts?.device;
    if (device) delete device.name;

    if (event.contexts) anonymizeInPlace(event.contexts);
    if (event.extra) anonymizeInPlace(event.extra);
    if (event.tags) anonymizeInPlace(event.tags);
    if (typeof event.message === "string") event.message = anonymizeText(event.message);

    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = anonymizeText(breadcrumb.message);
      }
      if (breadcrumb.data) anonymizeInPlace(breadcrumb.data);
    }

    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === "string") exception.value = anonymizeText(exception.value);
      for (const frame of exception.stacktrace?.frames ?? []) {
        // Local variables can hold arbitrary user data we can't reliably
        // anonymize, so drop them outright rather than risk a leak.
        delete frame.vars;
        if (typeof frame.filename === "string")
          frame.filename = scrubSensitivePaths(frame.filename);
        if (typeof frame.abs_path === "string")
          frame.abs_path = scrubSensitivePaths(frame.abs_path);
        if (typeof frame.module === "string") frame.module = scrubSensitivePaths(frame.module);
      }
    }

    // Transaction span attributes (e.g. `inspect.directory`) carry paths too.
    for (const span of event.spans ?? []) {
      if (typeof span.description === "string") span.description = anonymizeText(span.description);
      if (span.data) anonymizeInPlace(span.data);
    }

    return event;
  } catch {
    return null;
  }
};
